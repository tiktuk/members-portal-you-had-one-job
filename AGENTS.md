# Agent notes — Members portal, you had one job extension

Browser extension (MV3) for the MotionLab.Berlin Nexudus members portal. No
build step for the extension itself: `src/` is the unpacked extension.

## Commands

```bash
npm test                       # node --test tests/*.test.mjs  (no dependencies)
python3 scripts/make-icons.py  # regenerate src/icons/*.png
npm run build                  # dist/chrome, dist/*.zip, dist/safari Xcode project
python3 -m http.server 8765    # then open /tests/fixture.html
```

Run `npm test` after changing anything in `src/lib/`. After changing
`content.js` behaviour, also check the fixture in a browser. The script passes
the test files explicitly because Node 22 (what CI runs) resolves a bare
directory argument as a module path instead of discovering tests in it.

## Versioning

- The version lives in `package.json` and `src/manifest.json`; `npm test` fails
  if they differ or if `CHANGELOG.md` has no released entry matching it.
- Every user-visible change adds a bullet under `## [Unreleased]` in
  `CHANGELOG.md` (Added / Changed / Fixed / Removed, Keep a Changelog format).
- To release, move those bullets into a new `## [x.y.z] - YYYY-MM-DD` section
  and bump both files. Semver: patch = fix, minor = new feature or setting,
  major = something that breaks existing installs (renamed storage keys, new
  host permissions, a different manifest identity).
- Then push a `v<version>` tag. `.github/workflows/release.yml` fails when the
  tag disagrees with `src/manifest.json`, runs `npm test`, builds on Linux and
  attaches `dist/members-portal-you-had-one-job.zip` to a GitHub release, with the
  matching changelog section as the body. That zip is the *load unpacked*
  channel; the Web Store (public or unlisted) stays the only auto-updating one
  for Windows and macOS.
- Upload the release asset to the Web Store, not a local `dist/*.zip` (that is
  gitignored and rebuilt on every `npm run build`). The dashboard has no
  version control of its own: a submission must be a version above the
  published one, so the tag has to exist before the upload.

## Chrome Web Store

`CHROMEWEBSTORE.md` is the source of truth for the store presence: listing copy,
single purpose, screenshots, per-permission justifications, the data use
disclosure, the reviewer notes and the version history. Update it in the same
commit as any change it describes:

- manifest `name` / `description` → the listing copy (description ≤ 132 chars,
  and it must match the store short description);
- `permissions`, `host_permissions` or `optional_host_permissions` → the
  justification table, one specific reason per entry;
- data handling (new storage key, new endpoint, new stored field) → the privacy
  table *and* `docs/privacy.md`, which is the page the policy URL points at;
- new version → a row in the version history.

`docs/privacy.md` is published by GitHub Pages from `docs/`; the URL in
`CHROMEWEBSTORE.md` must load before a submission, since a 404 there is an
automatic rejection. The extension itself stays out of the zip — `scripts/build.sh`
copies `src/` only, so store docs and screenshots never ship.

`CHROMEWEBSTORE.md` is committed (it is the record of what was submitted and
why), but the repo is public: never write the reviewer test account's password
into it or into any other tracked file. Credentials are typed into the
dashboard's notes field and, if they need to live on disk, into
`CHROMEWEBSTORE.local.md`, which is gitignored.

## Layout

- `src/manifest.json` — MV3 manifest; content scripts load `lib/config.js`,
  `lib/url.js`, `lib/groups.js`, `lib/overview.js`, `lib/overview-view.js`
  **before** `content.js` (classic scripts, shared via `globalThis`).
- `src/lib/config.js` — all tunables (labels, API host, type slugs, cache TTL).
- `src/lib/url.js` — booking URL parsing/rewriting; used by both worlds.
- `src/lib/groups.js` — API payload → menu model (grouping, ordering, labels).
- `src/lib/overview.js` — bookings/events/Luma payloads → pinned-overview model
  and personal-bookings model (day sections, timestamp parsing, icons); loaded
  by the page and the tests.
- `src/lib/luma.js` — Luma public API helpers (source parsing, list/event URLs,
  ProseMirror description flattening); loaded by the background worker and the
  tests, never by the page.
- `src/lib/overview-view.js` — the overview UI (shell, fetching, rendering) as
  `OneJobOverviewView.mount(root, { variant: "page" | "panel" })`; shared by the
  standalone page and the in-portal overlay.
- `src/content.js` — isolated world: initial list→calendar rewrite, nav menu,
  group/resource fetching and caching, pins (the strip and the menu's pin
  buttons), the pins strip, settings, and the overview overlay.
- `src/page.js` — page world: `history.pushState`/`replaceState` patch, the
  explicit-list detection, the single-resource calendar (XHR payload filter
  + group-filter bypass), and the `navigator.geolocation` block.
- `src/background.js` — service worker that proxies Luma's public API (CORS and
  caching); the only place that talks to `api.luma.com`. Also reconciles the
  portal registrations with their host permissions on install/startup.
- `src/overview.html` / `overview.js` — standalone pinned resources page; the
  body is empty and `overview.js` mounts the shared view into it.
- `src/overview.css` — stylesheet for both variants (page and overlay).
- `src/popup.*` — toolbar settings UI (four toggles, group cache status, link to
  the pinned overview).
- `tests/` — `node --test` suites plus two browser harnesses: `fixture.html`
  (debugging the content script) and `screenshots.html` (the README and store
  images, with invented members, machines and bookings). Both run from
  `python3 -m http.server 8765`; the screenshots are 1280×800 and live in
  `docs/screenshots/`.

## One portal per build

- Nexudus gives every space its own domain, so the manifest can only name one:
  `config.portal.origin` in `content_scripts.matches`, and
  `https://<config.portal.webAddress>.spaces.nexudus.com/*` in `host_permissions`
  for that space's API. `tests/manifest.test.mjs` asserts both, so a retarget
  that misses one fails the tests.
- There is deliberately no runtime portal switching. Doing it needed `scripting`,
  an optional `https://*/*` host permission and a wildcard
  `https://*.spaces.nexudus.com/*`; the Web Store flags exactly that as overly
  broad, and a niche extension asking for every site is a review liability. The
  implementation is preserved on the `runtime-portals` branch — if a second space
  wants the same build, fork that branch rather than re-deriving it.
- `web_accessible_resources.matches` is the same portal origin: `page.js` and
  `overview.html` only have to be loadable from the portal they run in.
- The mirrored session carries `origin` (`onejob:session`), and
  `overview-view.js::portalOrigin()` uses it for every absolute link. The
  in-portal overlay reads its own `location.origin` instead, which is always the
  portal it is mounted in.
- Luma is gated to `config.portal.origin`: `config.luma.source` is one space's
  calendar, so `lumaAvailable()` hides the overview's *Show events* checkbox on
  any other origin. `.button[hidden]` in `overview.css` exists because
  `.button`'s `display: inline-flex` outranks the UA `[hidden]` rule.

## Portal facts this relies on

- The portal is Bootstrap 5.3 with `data-bs-theme` switching (dark `--bs-body-bg`
  is `#212529`) and overrides the palette to the brand orange: `--bs-primary`
  is `#ff5b13` in both themes, with matching `--bs-primary-bg-subtle`
  (`#ffdecf` light, `#331207` dark) and `--bs-primary-border-subtle`
  (`#ffbd9f` / `#993608`). Injected CSS therefore takes every colour from
  `--bs-*` (with a fallback) and never hardcodes `#0d6efd`: Bootstrap's stock
  blue is not in the portal's palette, and a solid fill with white text is the
  one treatment nothing else on the page uses. `tests/screenshots.html` loads
  the stock Bootstrap theme, so it shows blue — to judge colours against the
  real portal, set those variables on `<html>` (and `data-bs-theme="dark"` for
  dark mode) before looking.
- Routes: `/<webAddress>/bookings/<type>/<view>`, views
  `list|calendar|floorplan|map`, type slugs like `machines`, `labs`.
- The bookings calendar is FullCalendar, and the portal fixes the view durations
  in `BookingCalendar-*.js`: `day: resourceTimeGrid/1`, `week:
  resourceTimeGrid/7`, `month: dayGridMonth`, `list: listDay/1`, with
  `dayMinWidth: 150` for the week. The URL's `start`/`end` only decide which
  bookings are fetched, so **the number of day columns cannot be changed from
  the URL** — widening the range gives one week of columns and no second week.
  Two weeks would need the live instance (reachable from the `.fc` element's
  React fiber), a mutation of the cached view spec's `duration` plus a
  `changeView` round-trip — verified working on 6.1.15, but unsupported, and the
  header is printed from `start + 6 days`, so it would still name one week. Not
  done: the week stays 7 days and the ◀ ▶ buttons jump a week instead.
- Filters are query params: `group=<exact GroupName>`, `type=<id>`,
  `Allocation`, `customFields`. Both the list and the calendar filter by them.
  There is no per-resource query param; the extension adds
  `onejob-resource=<Resource.Id>` and handles it in `page.js`.
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
  (`.onejob-sheet-*`) appended to `<body>`.

## Pinned resources

- Pins live in `chrome.storage.local` (`onejob:pins`) as
  `[{ id, name, group, type }]`; the menu mirrors the raw `group` string so a
  pinned link still works if the cache is stale.
- The per-tab marker `onejob:pinned-resource` is in `sessionStorage` and holds
  `{ id, name, group, type }`. The content script writes it on click; `page.js`
  also writes it from a shared `?onejob-resource=<id>` URL. The portal strips
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
  `onejob-resource` (the View links can even copy the current parameter), and
  React Router ignores a navigation to the URL already in the address bar. A
  capture-phase click handler therefore clears the marker for any normal
  calendar/list link of the pinned type and navigates in full. The View
  dropdown handler strips the parameter before navigating. Without this, the
  single-resource view stuck around and hid every other booking.
- `pinnedActive` (in-memory) says whether the pinned view is live for this
  document. The marker alone is not enough: the portal normalises the URL to
  drop `onejob-resource`. On boot the marker is only kept for a `reload`
  (`performance.getEntriesByType("navigation")`); a fresh navigation to a plain
  calendar URL clears it. SPA date changes keep it. The Previous/Next handler
  re-adds `onejob-resource` to its `pushState` URL for the same reason.
- The strip's *Show all* link and the unpin navigation keep the resource's group
  (`pinnedGroup()` in `content.js`), so the calendar returns to the same category
  instead of the first resource of the whole type. The group comes from the
  session pin, then the cached resource list, then the URL.
- Pins are shown in a strip at the top of `<main>`, not in the menu:
  `ensurePinsBar()` builds `onejob-pins-bar` inside a `.container` wrapper
  (`onejob-pins-bar-wrap`) on every portal page. Each chip links to the
  single-resource calendar and carries its own unpin button. While a pin is the
  only resource on screen the strip also ends with the *Show all …* link, which
  replaced the separate banner that used to sit above the calendar — one row of
  pin state instead of two saying the same thing. The strip is rebuilt only when
  `pinsBarKey()` changes: the `MutationObserver` schedules an ensure pass for
  every DOM mutation, so rebuilding unconditionally would loop.
- Where the strip is mounted depends on `<main>`'s own display
  (`mountPinsBar()`): booking pages have a plain block `<main>` and the strip is
  its first child, but the personal pages (`/user/dashboard/*`) render
  `<main class="d-lg-flex gap-4 mobile-padding">` — a 200px left menu next to the
  content — so a child of it becomes a column of its own and reflows the page.
  For a flex/grid `<main>` the strip is inserted immediately before `<main>`
  instead. The check runs on every ensure pass, and `resize` schedules one,
  because the portal only adds `d-lg-flex` from 992px up.
- The menu exposes individual resources through the group chevron; the pin
  button is hover/focus-visible on desktop and always visible on touch.
- The calendar's Previous/Next buttons are horizontal scrollers for
  `.fc-scroller`, not week navigation. A single pinned resource fits, so the
  clicks are no-ops; `page.js` intercepts them in the capture phase and shifts
  the URL's `start`/`end` by the visible day count (7 for week, 1 for day),
  then dispatches `popstate` because React Router ignores raw `pushState`.
- `cache.groupsVersion` is 3 (v2 caches are still used as a fallback while the
  resource list is fetched).

## Pinned resources overview

- `overview.html` is a standalone extension page (opened from the popup's
  **Overview →** link). In the portal, **Booking Overview** is its own nav item
  (`ensureOverviewEntry()` / `overviewLabel` in `config.nav`) right after
  Resources, and a second dock button (`overviewShortLabel`) on narrow windows;
  both open the same view as an overlay. It is not a row inside the Resources
  menu any more, and it is shown even when that menu is switched off — it has no
  pins requirement either, since the overview still lists the member's own
  bookings. Both render one card per pin, mirroring the Django web app's
  dashboard widgets: icon, name, group, day-grouped bookings and resource
  events. The card title links to the single-resource calendar; the × button
  unpins it.
- The overview markup, fetching and styles live in `src/lib/overview-view.js` and
  `src/overview.css`, which are shared by the standalone page and the in-portal
  overlay. The overlay mounts the same module into a shadow root, so its generic
  class names (`.card`, `.notice`, `.button`) cannot collide with the portal's
  Bootstrap styles in either direction.
- The overlay injects `overview.css` as a `<style>` (fetched once per page via
  `chrome.runtime.getURL`) rather than a `<link>`: a link inside a shadow root
  loads after first paint, which showed the panel unstyled for a frame.
- `.onejob-overview-panel` fills the window up to `min(1700px, 100%)` (`94dvh`
  as a bottom sheet on phones) instead of sizing to its content, so the panel
  never grows as bookings arrive — a content-sized panel visibly jumps on open.
  Below the cap the width is fluid so the card grid reflows on resize. The cap
  matters: full-width on an ultrawide strands the cards in one corner.
- The card grid uses `auto-fit`, not `auto-fill`: with auto-fill a short pin
  list leaves a blank track (and a big gap) to the right of the last card.
  `minmax(300px, 1fr)` in the panel (340px on the page) gives 5 columns at
  1920px, 4 at 1440, 3 at 1100, 2 at 820 and 1 on phones. Do not raise that
  minimum back to 320px — a 1440px window leaves 1316px of content and four
  320px cards need 1328px, so it silently fell back to three columns.
- `.my-bookings` holds a single card, so it is a fixed `minmax(0, 420px)` track;
  auto-fit would stretch it across the whole row.
- **Alt+O** (`config.overview.shortcut`) opens the overlay from anywhere on the
  portal. `matchesShortcut` compares `event.code`, because Option+O reports
  `key: "ø"` on macOS; the handler ignores keystrokes in inputs, textareas,
  selects and contenteditable elements.
- Extension pages cannot read the portal's `AUTH_TOKEN` cookie. `content.js`
  therefore mirrors a live session into `chrome.storage.local`
  (`onejob:session`, `{ accessToken, webAddress, expiresAt, savedAt }`) on every
  portal load. If the page says "Connect to the members portal", the portal has
  not been opened since install; if it says the session expired, open the
  portal to renew it.
- Bookings come from `GET https://<webAddress>.spaces.nexudus.com/en/bookings/fullCalendarBookings?showAll=&start=…&end=…`
  and resource events from `/en/bookings/fullCalendarEvents?start=…&end=…`, both
  with the bearer token, `x-nx-app-name: portal` and `X-Use-Timezone: true`.
  The endpoints return every record in the range; the page filters by pinned
  `resourceId`. Do not add `resourceType` unless you also handle pins whose
  type is missing.
- Events include space-wide happenings with `resourceId: 0`; only events whose
  `resourceId` matches a pin are merged. Their `shortDescription` and
  portal-relative `url` feed the expandable *Reserved* row.
- Both `/en/...` feeds return UTC instants: `lib/overview.js::parseTimestamp`
  converts them to the browser timezone. An `08:00Z` booking shows at 09:00 and
  a `10:00Z` workshop at 11:00 in Berlin, matching the portal calendar and the
  web app. Do not trust the `ignoreTimezone: true` flag on these payloads.
- The REST `/api/bookings/fullCalendarEvents` endpoint used by the web app/CLI
  returns a different wall-clock value (`11:00Z` for that workshop). The CLI's
  `calendar_event_time` converts it again and prints 10:00, an hour early. This
  page uses the portal's `/en/...` endpoint instead.
- The **My bookings** card fetches `/api/public/bookings/my` with the same
  session and window (`from_Booking_FromTime`/`to_Booking_FromTime` in
  `YYYY-MM-DDTHH:MM` local, `orderBy=FromTime`, `dir=0`, `size=100`), following
  `HasNextPage`. It skips `Cancelled` bookings. Rows show `ResourceName`. It
  never merges Nexudus resource events (they are not the member's bookings) but
  does merge Luma events when the Luma toggle is on.
- `FromTime`/`ToTime` from `/api/public/bookings/my` are naive local wall-clock
  strings (no `Z`), unlike the `/en/...` feeds. `parseTimestamp` parses them as
  local, so no conversion is needed.
- The widget loads independently of pins, so the page still shows personal
  bookings when there are no pinned resources.
- `markOwnedBookings` marks pinned rows that also appear in
  `/api/public/bookings/my` (`mine: true`). Only those titles link to
  `/<webAddress>/public/bookings/edit?id=<bookingId>&resource_id=<resourceId>`;
  the portal fills in `booking`, `start` and `end` from the id. Do not link
  other members' bookings: the edit page cannot fetch them and falls back to a
  new-booking form (`Id: 0`), which is misleading.
- The **My bookings** card title links to
  `/<webAddress>/user/activity/bookings` (the portal's My Bookings page).
- Extension pages bypass CORS through the manifest host permission. The space
  host only allows `https://members.motionlab.berlin` as a CORS origin, so a
  plain web page could not call these endpoints.
- The lookahead is 14 days, like the web app. Day labels mirror
  `short_day_label`: `Today`, then a short weekday for 1–6 days ahead, then
  `2 Nov`. Auto-refresh is 60 s while the page is visible.
- `overview.html` and `overview.css` are listed in `web_accessible_resources`
  so the portal's content script can load them from the page's origin. The
  overlay only needs `overview.css` there (it injects the text as a `<style>`);
  `overview.html` stays listed for the popup's standalone tab and future use.
  Its scripts do not need to be listed (they load from the extension origin).
- Unpinning from the page writes the same `onejob:pins` array, so the portal
  menu and the popup update through their `chrome.storage.onChanged` listeners.

## Luma events

- Mirrors the Django app's `Space.luma_source` + `SpaceMembership.show_luma_events`.
  `config.luma.source` is a public Luma user (`usr-…`) or calendar (`cal-…`)
  API ID, or any luma.com URL containing one; `config.luma.enabled` only seeds
  the popup toggle (`settings.lumaEvents` in `onejob:settings`).
- The overview header also has a *Show events* checkbox (`ui.lumaToggle` +
  `ui.lumaInput`, only when `config.luma.source` is set) that writes the same
  `settings.lumaEvents`. It is a real `<input type="checkbox">` inside the
  button pill, not a pressed button: the pill alone gave no hint that it toggles
  anything, and the tick is the affordance people look for. `render()` keeps its
  `checked`/`is-active` state in sync, so changing the popup updates an open
  overview through `onStorageChanged`.
- `lib/luma.js::parseSource` extracts the ID. The list endpoints are
  `/user/profile/events-hosting?user_api_id=…&period=future` and
  `/calendar/get-items?calendar_api_id=…&period=future`, with
  `pagination_limit` + `pagination_cursor`, following `has_more`. No API key.
  The documented `public-api.luma.com` is calendar-scoped and needs Luma Plus,
  so do not switch to it.
- **Only `background.js` may fetch Luma.** `api.luma.com` only allows
  `https://luma.com` as a CORS origin (`vary: Origin`, no `*`), and content
  scripts are subject to CORS, so the in-portal overlay could not call it. The
  service worker uses the `https://api.luma.com/*` host permission instead.
  Both the page and the overlay ask it via `chrome.runtime.sendMessage`
  (`onejob:luma-events`, `onejob:luma-description`).
- List responses are cached in the worker for 5 minutes (`config.luma.cacheTtlMs`),
  descriptions for 1 hour (`detailCacheTtlMs`), mirroring the Django cache.
  The overview's *Refresh* button passes `force: true`; the 60 s auto-refresh
  reuses the cached list.
- Luma entries are `{ api_id, event: { api_id, name, start_at, end_at, url,
  geo_address_info } }`. `start_at`/`end_at` are UTC instants and go through
  `parseTimestamp` like the portal feeds. `event.url` is a slug, not a full URL.
- Luma events are **space-wide**, not tied to a resource, so `buildModel` merges
  them into every pinned card and `buildMyBookings` merges them into the
  My bookings card. `MAX_LUMA_EVENTS = 10` per card mirrors the web app's
  `MAX_EVENTS`; `lumaCount` counts unique events (they repeat across cards).
  `markOwnedBookings` never links them.
- They render with a purple *Event* badge (`badge-luma` / `booking-luma`) to
  stay distinct from the orange *Reserved* resource events, like the web app's
  `.badge-event-luma`. The description is fetched on first expand and flattened
  with `lib/luma.js::flattenDescription` (ProseMirror/TipTap), matching the
  Django `_rich_text_to_plain`; the *View event on Luma ↗* link is absolute.
- `background.js` only describes event IDs present in its last list cache (when
  one exists), like the web app's description endpoint, and rejects IDs that do
  not match `[A-Za-z0-9_-]+`.
- A Luma failure is non-blocking: `state.lumaError` adds "Luma events" to the
  overview warning while bookings keep rendering.
- Safari supports `background.service_worker` in MV3, and `importScripts` is
  fine because the worker is a classic script (no `"type": "module"`).

## Gotchas

- The initial rewrite must be synchronous in `content.js` (`document_start`,
  before the SPA reads the URL). `page.js` covers everything after boot.
- Settings are mirrored into the page's `localStorage` (`onejob:settings-cache`)
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
