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
  group/resource fetching and caching, pins, pinned banner, settings.
- `src/page.js` — page world: `history.pushState`/`replaceState` patch, the
  explicit-list detection, the single-resource calendar (XHR payload filter
  + group-filter bypass), and the `navigator.geolocation` block.
- `src/popup.*` — toolbar settings UI (three toggles, group cache status).
- `tests/` — `node --test` suites plus the browser fixture.

## Portal facts this relies on

- Routes: `/<webAddress>/bookings/<type>/<view>`, views
  `list|calendar|floorplan|map`, type slugs like `machines`, `labs`.
- Filters are query params: `group=<exact GroupName>`, `type=<id>`,
  `Allocation`, `customFields`. Both the list and the calendar filter by them.
  There is no per-resource query param; the extension adds
  `nxplus-resource=<Resource.Id>` and handles it in `page.js`.
- `GroupName` values frequently end with a space (`"Machines: CNC Machining "`).
  The portal compares the query value with `!==`, so keep the raw string for
  links and only trim it for display — trimming the URL value silently returns
  no resources.
- The portal wraps the whole app in a geolocation provider that calls
  `navigator.geolocation.getCurrentPosition()` on mount (location context for
  the AI assistant, not the map/filters). Safari only keeps a denial for a day,
  so it prompts on every visit. `page.js` replaces
  `Navigator.prototype.geolocation` with an `undefined` getter before the app
  boots, which sends the provider down its "not supported" branch; the portal
  has no CSP header, and nothing else in its bundle touches the API. Controlled
  by the popup's *Block location prompt* toggle (`settings.geoBlockPrompt`,
  default `config.geo.blockPrompt`); `page.js` keeps the original
  `Navigator.prototype` descriptor so turning it off restores the real API.
- Resource groups come from `GET https://<webAddress>.spaces.nexudus.com/api/public/resources/published/details`
  (`{ Resources: [{ SystemResourceType, GroupName, ... }] }`), authorised with
  the `AUTH_TOKEN` cookie the portal itself sets (readable JS cookie).
- `SystemResourceType` → slug mapping mirrors the portal's own table (10 =
  machines, 5 = labs, 1 = meeting-rooms, 4 = event-spaces, …); keep
  `config.resourceTypeSlugs` in sync.
- The portal's *View* dropdown toggle has `id="resourceViewDropdown"`; its menu
  links end in `/list` or `/calendar`.
- Below 1200 px the portal hides the navbar and shows a bottom dock
  (`nav[aria-label="Main navigation"]`, CSS-module classes like `_dockBtn_…`).
  The dock button copies the class names of an existing dock button at runtime,
  so hashed class renames do not break it; its sheet is our own markup
  (`.nxplus-sheet-*`) appended to `<body>`.

## Pinned resources

- Pins live in `chrome.storage.local` (`nxplus:pins`) as
  `[{ id, name, group, type }]`; the menu mirrors the raw `group` string so a
  pinned link still works if the cache is stale.
- The per-tab marker `nxplus:pinned-resource` is in `sessionStorage` and holds
  `{ id, name, group, type }`. The content script writes it on click; `page.js`
  also writes it from a shared `?nxplus-resource=<id>` URL. The portal strips
  unknown query params while normalising the bookings URL, so the marker is what
  keeps the view alive after boot.
- `page.js` filters the `/api/public/resources/published/details` XHR response
  down to the pinned `Id`. The portal fetches that endpoint with axios (XHR),
  not `fetch`. The override defines `responseText` (and `response` when
  `responseType === "json"`) on the XHR instance; the `load` listener runs
  before axios's `loadend`.
- While pinned, `page.js` overrides `URLSearchParams.prototype.get` to return
  `null` for every key except `start`, `end` and `view`: a leftover portal
  category/capacity/amenity filter would hide the pinned resource. It calls the
  saved original `get` internally to avoid recursion.
- Leaving the pinned view (different type, non-calendar view, non-bookings page)
  clears the marker and forces `location.assign(...)` from the history patch:
  the portal caches the filtered resources in React Query, so an SPA-only
  navigation would keep the one-resource payload.
- The portal's own *Bookings* menu and *View* dropdown links carry no
  `nxplus-resource` (the View links can even copy the current parameter), and
  React Router ignores a navigation to the URL already in the address bar. A
  capture-phase click handler therefore clears the marker for any normal
  calendar/list link of the pinned type and navigates in full. The View
  dropdown handler strips the parameter before navigating. Without this, the
  single-resource view stuck around and hid every other booking.
- `pinnedActive` (in-memory) says whether the pinned view is live for this
  document. The marker alone is not enough: the portal normalises the URL to
  drop `nxplus-resource`. On boot the marker is only kept for a `reload`
  (`performance.getEntriesByType("navigation")`); a fresh navigation to a plain
  calendar URL clears it. SPA date changes keep it. The Previous/Next handler
  re-adds `nxplus-resource` to its `pushState` URL for the same reason.
- The pinned banner's *Show all* link and the unpin navigation keep the
  resource's group (`pinnedGroup()` in `content.js`), so the calendar returns to
  the same category instead of the first resource of the whole type. The group
  comes from the session pin, then the cached resource list, then the URL.
- The calendar's Previous/Next buttons are horizontal scrollers for
  `.fc-scroller`, not week navigation. A single pinned resource fits, so the
  clicks are no-ops; `page.js` intercepts them in the capture phase and shifts
  the URL's `start`/`end` by the visible day count (7 for week, 1 for day),
  then dispatches `popstate` because React Router ignores raw `pushState`.
- The menu exposes individual resources through the group chevron; the pin
  button is hover/focus-visible on desktop and always visible on touch.
- `cache.groupsVersion` is 3 (v2 caches are still used as a fallback while the
  resource list is fetched).

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
- `renderMenuContent()` feeds both the desktop dropdown and the mobile sheet;
  only the dropdown sets an explicit grid track count (its width is
  content-driven). Sheet columns use the CSS `auto-fill` fallback.
- `src/lib/*.js` must stay dependency-free and side-effect free (they are
  loaded in both worlds and in the tests).
- `page.js`'s `URLSearchParams` override only affects the page world. In the
  real extension `content.js` is isolated, so its group highlighting is
  unaffected; in `tests/fixture.html` both run in the page world, so the active
  group may show as “All …” while a resource is pinned.
- Safari support comes from `safari-web-extension-converter`; avoid APIs that
  Safari's MV3 does not implement (no `world` in content scripts, no
  `declarativeNetRequest` tricks). The page-world injection uses a plain
  `<script src>` tag for this reason.
