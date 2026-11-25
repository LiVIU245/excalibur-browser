// Runs against the built bundle: `npm test` builds first.
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Excalibur, CLIENT_VERSION, WindowHooks, parseStackTrace } from '../dist/esm/index.mjs';

const GLOBALS = ['sessionStorage', 'localStorage', 'location', 'document', 'addEventListener', 'removeEventListener'];
let saved;
let warnings;

beforeEach(() => {
  saved = GLOBALS.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  warnings = [];
  mock.method(console, 'warn', (message) => warnings.push(String(message)));
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  GLOBALS.forEach((name, i) => {
    delete globalThis[name];
    if (saved[i]) Object.defineProperty(globalThis, name, saved[i]);
  });
  mock.restoreAll();
  mock.timers.reset();
});

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

// Client whose requests land in `sent`; `respond` picks the HTTP status
function client(options = {}, respond = () => new Response('{}', { status: 202 })) {
  const sent = [];
  const instance = new Excalibur({
    apiKey: 'exc_test',
    fetch: async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body), bytes: Buffer.byteLength(init.body) });
      return respond();
    },
    ...options,
  });
  return { instance, sent };
}

describe('storage', () => {
  it('constructs and sends when reading sessionStorage throws', async () => {
    const securityError = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    Object.defineProperty(globalThis, 'sessionStorage', { get: securityError, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { get: securityError, configurable: true });

    const { instance, sent } = client();
    await instance.send(new Error('boom'));

    assert.equal(sent.length, 1);
    assert.match(sent[0].body.Details.SessionId, /^[0-9a-f-]{36}$/);
  });

  it('anonymousId: false stores nothing and sends no user', async () => {
    const storage = memoryStorage();
    setGlobal('localStorage', storage);

    const { instance, sent } = client({ anonymousId: false });
    await instance.send(new Error('boom'));

    assert.equal(sent[0].body.Details.User, undefined);
    assert.equal(storage.items.size, 0);

    instance.setUser({ identifier: 'user-1' });
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 5_000 });
    await instance.send(new Error('boom again'));
    assert.equal(sent[1].body.Details.User.Identifier, 'user-1');
  });

  it('keeps a stable anonymous id by default', async () => {
    setGlobal('localStorage', memoryStorage());
    const { instance, sent } = client();
    await instance.send(new Error('one'));
    await instance.send(new Error('two'));

    assert.equal(sent[0].body.Details.User.IsAnonymous, true);
    assert.equal(sent[0].body.Details.User.Identifier, sent[1].body.Details.User.Identifier);
  });
});

describe('without a window (workers, extension service workers)', () => {
  it('attach() hooks the global scope and reports its errors', async () => {
    const listeners = {};
    setGlobal('addEventListener', (type, fn) => (listeners[type] = fn));
    setGlobal('removeEventListener', (type) => delete listeners[type]);

    const { instance, sent } = client();
    instance.attach();
    assert.deepEqual(Object.keys(listeners).sort(), ['error', 'unhandledrejection']);

    listeners.unhandledrejection({ reason: new Error('background sync failed') });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent[0].body.Details.Error.Message, 'background sync failed');

    instance.detach();
    assert.deepEqual(Object.keys(listeners), []);
  });

  it('keeps one anonymous id across events when localStorage is missing', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { instance, sent } = client();
    await instance.send(new Error('one'));
    await instance.send(new Error('two'));

    const ids = sent.map((s) => s.body.Details.User.Identifier);
    assert.match(ids[0], /^[0-9a-f-]{36}$/);
    assert.equal(ids[0], ids[1]);
  });
});

describe('query string redaction', () => {
  it('redacts credential-looking parameters in the URL and the referrer', async () => {
    setGlobal('location', new URL('https://app.test/reset-password?token=SECRET123&email=a%40b.co&postcode=1234&code=OAUTH&myField=x'));
    setGlobal('document', { referrer: 'https://app.test/login?access_token=REF_SECRET&next=%2Fhome#frag' });

    const { instance, sent } = client({ redactParams: ['myField'] });
    await instance.send(new Error('boom'));

    const request = sent[0].body.Details.Request;
    assert.deepEqual(request.QueryString, {
      token: '[redacted]',
      email: 'a@b.co',
      postcode: '1234',
      code: '[redacted]',
      myField: '[redacted]',
    });
    assert.equal(request.Url, 'https://app.test/reset-password');
    assert.equal(request.Headers.Referer, 'https://app.test/login?access_token=%5Bredacted%5D&next=%2Fhome');
    assert.ok(!JSON.stringify(sent[0].body).includes('SECRET'));
  });
});

describe('flood protection', () => {
  it('caps events per minute even when every message differs', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { instance, sent } = client();

    for (let i = 0; i < 500; i++) await instance.send(new Error(`row ${i} failed`));
    assert.equal(sent.length, 10);
    assert.equal(warnings.filter((w) => w.includes('a minute')).length, 1);

    mock.timers.tick(61_000);
    await instance.send(new Error('after the window'));
    assert.equal(sent.length, 11);
  });

  it('has no lifetime cap: a long-running script keeps reporting', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { instance, sent } = client();

    // 5 errors a minute for 24 hours
    for (let minute = 0; minute < 1_440; minute++) {
      for (let i = 0; i < 5; i++) await instance.send(new Error(`minute ${minute} error ${i}`));
      mock.timers.tick(60_000);
    }

    assert.equal(sent.length, 7_200);
  });

  it('still drops an identical error repeated within a second', async () => {
    const { instance, sent } = client();
    const make = () => new Error('same');
    for (let i = 0; i < 50; i++) await instance.send(make());
    assert.equal(sent.length, 1);
  });

  it('stops for good after a 401', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { instance, sent } = client({}, () => new Response('{"error":"Invalid API key"}', { status: 401 }));

    await instance.send(new Error('first'));
    mock.timers.tick(120_000);
    await instance.send(new Error('second'));
    await instance.send(new Error('third'));

    assert.equal(sent.length, 1);
    assert.equal(warnings.filter((w) => w.includes('check the apiKey')).length, 1);
  });

  it('pauses on 429 and resumes after Retry-After', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    let status = 429;
    const { instance, sent } = client({}, () => new Response('{}', { status, headers: { 'Retry-After': '30' } }));

    await instance.send(new Error('first'));
    await instance.send(new Error('second'));
    assert.equal(sent.length, 1);

    status = 202;
    mock.timers.tick(31_000);
    await instance.send(new Error('third'));
    assert.equal(sent.length, 2);
  });
});

describe('non-Error values', () => {
  it('send() never rejects on unserializable values', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { instance, sent } = client();
    const circular = { name: 'loop' };
    circular.self = circular;

    await instance.send(circular);
    await instance.send({ amount: 10n });
    await instance.send(undefined);
    await instance.send({ message: 'plain object', name: 'CustomError' });

    const errors = sent.map((s) => s.body.Details.Error);
    assert.match(errors[0].Message, /\[Circular\]/);
    assert.equal(errors[1].Message, '{"amount":"10n"}');
    assert.equal(errors[2].Message, 'undefined');
    assert.deepEqual([errors[3].ClassName, errors[3].Message], ['CustomError', 'plain object']);
  });

  it('reports the real reason of an odd unhandled rejection', () => {
    const captured = [];
    const listeners = {};
    const hooks = new WindowHooks((error, extras) => captured.push({ error, extras }));
    hooks.attach({ addEventListener: (type, fn) => (listeners[type] = fn), removeEventListener() {} });

    const circular = { reason: 'payment declined' };
    circular.self = circular;
    listeners.unhandledrejection({ reason: circular });
    listeners.unhandledrejection({ reason: undefined });

    assert.equal(captured[0].error.name, 'UnhandledRejection');
    assert.match(captured[0].error.message, /payment declined/);
    assert.equal(captured[1].error.message, 'Promise rejected with undefined');
    assert.deepEqual(captured[0].extras.tags, ['UnhandledPromiseRejection']);
  });
});

describe('payload limits', () => {
  it('truncates oversized fields instead of losing the event', async () => {
    const { instance, sent } = client({ environment: 'e'.repeat(200), tags: [1, 't'.repeat(500)] });
    await instance.send(new Error('m'.repeat(50_000)));

    const details = sent[0].body.Details;
    assert.equal(details.DeploymentEnvironment.length, 64);
    assert.ok(details.Error.Message.length < 10_100);
    assert.deepEqual([details.Tags[0], details.Tags[1].length], ['1', 200]);
  });

  it('sheds customData to stay under the 1MB body limit', async () => {
    const { instance, sent } = client();
    await instance.send(new Error('big'), { customData: { blob: 'é'.repeat(600_000) } });

    assert.equal(sent.length, 1);
    assert.ok(sent[0].bytes < 1_000_000);
    assert.deepEqual(sent[0].body.Details.UserCustomData, { _truncated: true });
    assert.equal(sent[0].body.Details.Error.Message, 'big');
  });

  it('survives customData that JSON cannot serialize', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { instance, sent } = client();
    const circular = {};
    circular.self = circular;
    await instance.send(new Error('circular'), { customData: circular });
    await instance.send(new Error('bigint'), { customData: { amount: 10n } });

    // The depth limit catches the cycle before serialization does
    assert.deepEqual(sent[0].body.Details.UserCustomData, { _truncated: true });
    assert.deepEqual(sent[1].body.Details.UserCustomData, { _unserializable: true });
  });
});

describe('noise and parsing', () => {
  it('ignores built-in and configured noise', async () => {
    const { instance, sent } = client({ ignoreErrors: ['Script error', /^Network/] });
    await instance.send(new Error('ResizeObserver loop completed with undelivered notifications.'));
    await instance.send(new Error('Script error.'));
    await instance.send(new Error('NetworkError when attempting to fetch resource.'));
    await instance.send(new Error('real bug'));

    assert.deepEqual(sent.map((s) => s.body.Details.Error.Message), ['real bug']);
  });

  it('parses a pathological 200KB stack line quickly', () => {
    const started = performance.now();
    const frames = parseStackTrace(`Error: boom\n${'a@b:'.repeat(50_000)}\n    at run (https://app.test/x.js:1:2)`);
    assert.ok(performance.now() - started < 100);
    assert.deepEqual(frames.map((f) => f.fileName), ['https://app.test/x.js']);
  });

  it('reports the package.json version', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const { instance, sent } = client();
    await instance.send(new Error('boom'));

    assert.equal(CLIENT_VERSION, version);
    assert.equal(sent[0].body.Details.Client.Version, version);
  });
});
