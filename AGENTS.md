# Agent notes — Nexudus Portal+ extension

Browser extension (MV3) for the MotionLab.Berlin Nexudus members portal. No
build step for the extension itself: `src/` is the unpacked extension.

## Commands

```bash
npm test                       # node --test tests/  (no dependencies)
python3 scripts/make-icons.py  # regenerate src/icons/*.png
npm run build                  # dist/chrome, dist/*.zip, dist/safari Xcode project
python3 -m http.server 8765    # then open /tests/fixture.html
```

Run `npm test` after changing anything in `src/lib/`. After changing
`content.js` behaviour, also check the fixture in a browser.

## Layout

- `src/manifest.json` — MV3 manifest; content scripts load `lib/config.js`,
  `lib/url.js`, `lib/groups.js` **before** `content.js` (classic scripts, shared
  via `globalThis`).
- `src/lib/config.js` — all tunables (labels, API host, type slugs, cache TTL).
- `src/lib/url.js` — booking URL parsing/rewriting; used by both worlds.
- `src/lib/groups.js` — API payload → menu model (grouping, ordering, labels).
- `src/content.js` — isolated world: initial list→calendar rewrite, nav menu,
  group fetching/caching, settings.
- `src/page.js` — page world: `history.pushState`/`replaceState` patch and the
  explicit-list detection.
- `src/popup.*` — toolbar settings UI (two toggles, group cache status).
- `tests/` — `node --test` suites plus the browser fixture.

## Portal facts this relies on

- Routes: `/<webAddress>/bookings/<type>/<view>`, views
  `list|calendar|floorplan|map`, type slugs like `machines`, `labs`.
- Filters are query params: `group=<exact GroupName>`, `type=<id>`,
  `Allocation`, `customFields`. Both the list and the calendar filter by them.
- `GroupName` values frequently end with a space (`"Machines: CNC Machining "`).
  The portal compares the query value with `!==`, so keep the raw string for
  links and only trim it for display — trimming the URL value silently returns
  no resources.
- Resource groups come from `GET https://<webAddress>.spaces.nexudus.com/api/public/resources/published/details`
  (`{ Resources: [{ SystemResourceType, GroupName, ... }] }`), authorised with
  the `AUTH_TOKEN` cookie the portal itself sets (readable JS cookie).
- `SystemResourceType` → slug mapping mirrors the portal's own table (10 =
  machines, 5 = labs, 1 = meeting-rooms, 4 = event-spaces, …); keep
  `config.resourceTypeSlugs` in sync.
- The portal's *View* dropdown toggle has `id="resourceViewDropdown"`; its menu
  links end in `/list` or `/calendar`.

## Gotchas

- The initial rewrite must be synchronous in `content.js` (`document_start`,
  before the SPA reads the URL). `page.js` covers everything after boot.
- Settings are mirrored into the page's `localStorage` (`nxplus:settings-cache`)
  so the synchronous rewrite can respect the toggle; `chrome.storage` is the
  source of truth.
- Never fetch the resources endpoint with `credentials: "include"`: the API
  allows the portal origin via CORS and the bearer token is enough.
- The API host is per space (`<webAddress>.spaces.nexudus.com`); the manifest
  host permission is the wildcard `https://*.spaces.nexudus.com/*`.
- The injected `<li>` lives inside a React-rendered `<ul>`; a MutationObserver
  re-inserts it if React removes it. Keep `ensureNav()` idempotent and cheap —
  it runs on every DOM mutation (debounced) and on a 1 s fallback timer.
- `src/lib/*.js` must stay dependency-free and side-effect free (they are
  loaded in both worlds and in the tests).
- Safari support comes from `safari-web-extension-converter`; avoid APIs that
  Safari's MV3 does not implement (no `world` in content scripts, no
  `declarativeNetRequest` tricks). The page-world injection uses a plain
  `<script src>` tag for this reason.
