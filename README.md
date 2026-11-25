# @excalibur-js/browser

Browser SDK for the Excalibur logging platform. Captures uncaught errors and
unhandled promise rejections, attaches user/session/environment context, and
ships entries to the ingest API.

## Install

```sh
npm install @excalibur-js/browser
```

## Quick start

```ts
import { Excalibur } from '@excalibur-js/browser';

const excalibur = new Excalibur({
  apiKey: 'exc_xxxxxxxxxxxxxxxx',
  version: '1.4.2',
  environment: 'staging',
});

// Capture uncaught errors + unhandled promise rejections
excalibur.attach();
```

## Workers and browser extensions

`attach()` hooks whichever global scope it runs in: `window` in a page, `self` in a web worker or an extension's background service worker. There is no cap on how many events a long-running script can report over its lifetime, only the per-minute limit below.

Where `sessionStorage` / `localStorage` do not exist (service workers), the session and anonymous ids live in memory, so they last until the worker is restarted.

## Registering a user

Entries are attributed to a persisted anonymous identity until a user is
registered:

```ts
excalibur.setUser({
  identifier: 'user-123',
  email: 'arthur@camelot.io',
  fullName: 'Arthur Pendragon',
  firstName: 'Arthur',
});

// On logout
excalibur.clearUser();
```

## Sessions

A session id is generated lazily on the first entry and persists for the
lifetime of the tab (sessionStorage). Manage it explicitly around auth
boundaries:

```ts
const id = excalibur.startSession(); // fresh session, e.g. after login
excalibur.sessionId;                 // current id, or null
excalibur.endSession();              // e.g. after logout
```

## Manual sends and breadcrumbs

```ts
excalibur.recordBreadcrumb('Checkout opened', { level: 'info', type: 'navigation' });

try {
  await checkout(cart);
} catch (error) {
  await excalibur.send(error, {
    tags: ['checkout'],
    customData: { cartSize: cart.items.length },
  });
}
```

## Options

| Option            | Default        | Description                                          |
| ----------------- | -------------- | ---------------------------------------------------- |
| `apiKey`          | — (required)   | SDK key minted with the application (`exc_...`)      |
| `endpoint`        | `https://excalibur.codes/api/entries` | Absolute URL or path relative to the current origin (self-hosted servers) |
| `version`         | —              | Application version reported with every entry        |
| `environment`     | `production`   | Deployment environment reported with every entry     |
| `tags`            | `[]`           | Tags appended to every entry                         |
| `fetch`           | global fetch   | Alternative fetch (edge workers, tests)              |
| `beforeSend`      | —              | Mutate a payload before sending; return null to drop |
| `breadcrumbLimit` | `32`           | Maximum breadcrumbs attached to an entry             |
| `redactParams`    | `[]`           | Extra query parameter names (strings or RegExps) to redact, on top of the built-in list |
| `ignoreErrors`    | `[]`           | Errors to drop by message (substring or RegExp), on top of the built-in list |
| `maxPerMinute`    | `10`           | Most events sent per minute; the rest are dropped    |
| `anonymousId`     | `true`         | Keep a random visitor id in `localStorage` until `setUser()` is called |

## What is sent, and what is not

- **URL.** The page's origin and path, and its query parameters. Values of parameters that look like credentials are replaced with `[redacted]`: any name containing `token`, `secret`, `passw`, `pwd`, `auth`, `session`, `signature`, `credential`, `jwt`, `otp` or `apikey`, and the exact names `code`, `key`, `sig` and `pin`. Add your own with `redactParams: ['invite', /^utm_/]`. The referrer gets the same treatment; URL fragments are never sent.
- **Visitor id.** Until you call `setUser()`, entries carry a random id stored in `localStorage` (`excalibur:anonymous-id`) so one visitor's errors can be counted together. If you need consent before storing identifiers, pass `anonymousId: false`: nothing is stored and anonymous entries carry no user.
- **Anything else** (messages, custom data, breadcrumbs) is what your code passes in. Use `beforeSend` to scrub or drop entries.

## Limits

The client protects your quota and your users' network:

- The same error repeated within a second is sent once.
- At most `maxPerMinute` events a minute, whatever their messages. There is no lifetime cap, so long-lived tabs and extension background scripts keep reporting.
- A `429` or `503` pauses sending for the `Retry-After` period; a `401` or `403` (wrong or revoked key) turns reporting off until the page reloads.
- Oversized fields are truncated (message 10k characters, stack 50k, tags 50 × 200, environment 64) and custom data and breadcrumbs are dropped if the event would exceed the server's 1MB limit, so the error itself still arrives.
- `ResizeObserver loop…` browser noise is ignored. To also drop errors from cross-origin scripts, add `ignoreErrors: ['Script error']`.

## Build

```sh
npm run build      # rollup: ESM + CJS + type declarations into dist/
npm run typecheck  # tsc --noEmit
npm test           # builds, then runs test/ with node --test
```
