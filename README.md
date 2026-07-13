# @excalibur/browser

Browser SDK for the Excalibur logging platform. Captures uncaught errors and
unhandled promise rejections, attaches user/session/environment context, and
ships entries to the ingest API.

## Install

From git (the `prepare` script builds `dist/` on install):

```sh
npm install git+https://github.com/LiVIU245/excalibur-browser.git
```

Or pinned to a commit in package.json:

```json
"@excalibur/browser": "git+https://github.com/LiVIU245/excalibur-browser.git#<sha>"
```

Once published to npm:

```sh
npm install @excalibur/browser
```

## Quick start

```ts
import { ExcaliburClient } from '@excalibur/browser';

const excalibur = new ExcaliburClient({
  apiKey: 'exc_xxxxxxxxxxxxxxxx',
  endpoint: 'https://excalibur.example.com/api/entries',
  version: '1.4.2',
});

// Capture uncaught errors + unhandled promise rejections
excalibur.attach();
```

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
| `endpoint`        | `/api/entries` | Absolute URL or path relative to the current origin  |
| `version`         | —              | Application version reported with every entry        |
| `tags`            | `[]`           | Tags appended to every entry                         |
| `fetch`           | global fetch   | Alternative fetch (edge workers, tests)              |
| `beforeSend`      | —              | Mutate a payload before sending; return null to drop |
| `breadcrumbLimit` | `32`           | Maximum breadcrumbs attached to an entry             |

## Build

```sh
npm run build      # rollup: ESM + CJS + type declarations into dist/
npm run typecheck  # tsc --noEmit
```
