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
  `lib/url.js`, `lib/groups.js`, `lib/overview.js`, `lib/stats.js`,
  `lib/overview-view.js`, `lib/stats-view.js`, `lib/tour.js` **before**
  `content.js` (classic scripts, shared via `globalThis`).
- `src/lib/config.js` — all tunables (labels, API host, type slugs, cache TTL).
- `src/lib/url.js` — booking URL parsing/rewriting; used by both worlds.
- `src/lib/groups.js` — API payload → menu model (grouping, ordering, labels).
- `src/lib/overview.js` — bookings/events/Luma payloads → pinned-overview model
  and personal-bookings model (day sections, timestamp parsing, icons); loaded
  by the page and the tests.
- `src/lib/stats.js` — bookings → resource-statistics model (periods, month
  keys, day/hour buckets, colour bands, heatmap weeks) and the single-resource
  day grid (`dayGrid`, `dayGridRange`); pure, loaded by the content script and
  the tests.
- `src/lib/luma.js` — Luma public API helpers (source parsing, list/event URLs,
  ProseMirror description flattening); loaded by the background worker and the
  tests, never by the page.
- `src/lib/overview-view.js` — the overview UI (shell, fetching, rendering) as
  `OneJobOverviewView.mount(root, { variant: "page" | "panel" })`; shared by the
  standalone page and the in-portal overlay.
- `src/lib/stats-view.js` — the resource-statistics UI (periods, month fetching,
  cache, heatmap, charts, resource grid) as `OneJobStatsView.mount(root)`; only
  mounted in the in-portal overlay.
- `src/lib/tour.js` — the first-run feature tour's card, steps and geometry
  (`OneJobTour.start` / `place` / `center`); loaded by the content script and the
  tests, never by the page.
- `src/content.js` — isolated world: initial list→calendar rewrite, nav menu,
  group/resource fetching and caching, pins (the strip and the menu's pin
  buttons), the pins strip, the day grid under it, settings, the shared overlay
  shell and both overlays (pinned overview and resource statistics).
- `src/page.js` — page world: `history.pushState`/`replaceState` patch, the
  explicit-list detection, the single-resource calendar (XHR payload filter
  + group-filter bypass), and the `navigator.geolocation` block.
- `src/background.js` — service worker that proxies Luma's public API (CORS and
  caching); the only place that talks to `api.luma.com`. Also reconciles the
  portal registrations with their host permissions on install/startup.
- `src/overview.html` / `overview.js` — standalone pinned resources page; the
  body is empty and `overview.js` mounts the shared view into it.
- `src/overview.css` — stylesheet for both overview variants (page and overlay).
- `src/stats.css` — the statistics screen's own styles, loaded after
  `overview.css` in the same shadow root so it can reuse the palette, header,
  buttons, notices and footer.
- `src/popup.*` — toolbar settings UI (six toggles, the tour replay row, group
  cache status, link to the pinned overview).
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
  calendar, so `lumaAvailable()` disables the overview's event fetching on any
  other origin. `.button[hidden]` in `overview.css` stays because `.button`'s
  `display: inline-flex` outranks the UA `[hidden]` rule.

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
- The group row is the toggle: clicking the group name opens its resources. It
  used to navigate to the group's calendar, which is what testers clicked
  instead of the chevron. The group's own calendar is the *Show all* row at the
  end of the expanded list (a group with no resources keeps the plain link). The pin button is always visible (dimmed at `opacity: 0.55`,
  full on hover/focus and when pinned) because hover-only hid the one
  affordance people needed to find.
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

## Booking from the overview

- Hovering a row in the overview reveals a **+** on each side of its title
  (`titleWithGaps` / `gapButton` in `overview-view.js`). Left books a slot
  **ending** at that row's start, right one **starting** at its end. They appear
  on real bookings, workshop reservations and the **My bookings** rows, but not
  on Luma events (space-wide, so "before" and "after" would not mean the
  resource).
- **A `+` is only rendered where the resource is free.** `lib/overview.js::rowGap`
  returns the free time to that edge (Infinity when nothing is in the way) and
  the view drops the button at `<= 0`. The frontier is taken over every row that
  starts earlier (before) or ends later (after), not the neighbouring row in the
  list: a longer booking that overlaps this one and runs past it removes the
  button too. Rows of another resource and Luma events are ignored, and a
  started booking never gets the left button, since the portal refuses bookings
  that end in the past. The dialog's preview is still the authority — the model
  only covers the lookahead window and the card's own resource.
- The buttons keep their 1.15rem slots at all times and only animate
  `opacity`, so a row does not jump under the pointer. They are `0` until
  `.booking:hover`/`:focus-within`, `0.45` under `@media (hover: none)`. The
  size lives in `--gap-button`, because the slot has to be reproduced: a row
  with no before-button (a Luma event, no gap, or already started) gets
  `booking-main no-before`, whose left padding reserves it — otherwise its title
  starts ~22px left of every other row's. The trailing slot is not reserved,
  because a badge follows the title rather than a column.
  `.booking-event`'s negative margin carries an extra `-2px` for its left
  border, or the border shifts the time and title 2px right.
- `lib/overview.js` owns the pure parts: `bookingWindow(booking, side, minutes)`
  (epoch stamps, crosses midnight), `rowGap`, `basketBody`, `defaultProfile`,
  `resourceInterval`, `durationLabel`, `bookingError`. The view owns the HTTP.
- **There is no plain create-booking endpoint.** The portal's own booking form
  posts a basket item, so this is the write path (all on the space host, which
  the existing host permission covers — no manifest change):
  - `GET /api/public/coworkers/profiles?f=1` → `{ Profiles: [{ Id,
    IsDefaultProfile, FullName }] }`; the default (else first) profile's `Id` is
    the `CoworkerId`. The portal's auth context resolves the same way. Fallback:
    the first `CoworkerId` in `/api/public/bookings/my`, which
    `normalizeMyBooking` now keeps.
  - `GET /api/public/resources/published/<id>` → `IntervalLimit`, the duration
    field's `min`/`step` (15 when the request fails). `/published/details` is a
    different URL — match the numeric id, or the groups payload is returned.
  - `POST /api/public/checkout/basket/preview`, then
    `POST /api/public/checkout/basket/invoice`, both with
    `{ Basket: [{ Type: "booking", Booking: { ResourceId, FromTime, ToTime,
    FloorPlanDeskId: null, CoworkerId, CoworkerFullName, ChargeNow: false,
    BookingVisitors: [], BookingProducts: [], CustomFields: { Data: [] }, Id: 0
    } }], agreedTermsAndConditions: true, createZeroValueInvoice: true }`.
    `FromTime`/`ToTime` are `Date#toISOString()` instants, exactly what the
    portal's axios sends. Both need `Content-Type: application/json` and the
    `X-Nexudus-Client-Session` header (8–64 chars; the portal keeps one per tab
    in `sessionStorage`, we keep `onejob:checkout-session`).
  - `/api/spaces/bookings` (what `nexuml-py create` uses) is **not** the path:
    it needs a REST token and the `Booking-Create` role, not the portal session.
- The preview answers `{ checkout: { Errors, TransactionTotalAmount }, preview:
  { TotalAmount, Currency: { Code }, Errors, Message } }`. Refusals are
  **200s with `Errors[0].PropertyName`**, not HTTP failures, so `fetchJson`
  takes `allowErrorBody` (it returns `{ status, data }` and tolerates an empty
  or non-JSON body); the codes (`BOOKING_CONFLICT`, `EVENT_CONFLICT`,
  `INVALID_INTERVAL` with the block size in `AttemptedValue`,
  `NO_PAST_BOOKINGS`, `TOO_SHORT`, `TOO_LONG`, `INVALID_TARIFF`, `NO_CREDIT`,
  `CHECKOUT TC MISSING`, …) are translated by `bookingError`, mirroring the
  portal's own table in `PublicResources-*.js`. Unknown codes show the server's
  message or the code itself.
- **The invoice's success body is not a fixed envelope.** The portal only reads
  `WasSuccessful === false`, `TransactionTotalAmount` and `Id` from it, and the
  live endpoint answered with something else entirely (the created record),
  which an earlier `isBasketResponse` check reported as "unexpected response"
  *after* the booking had been created. Treat any 2xx that does not say
  `WasSuccessful: false` as created; `basketTotal`/`invoiceId` read the fields
  tolerantly and default to 0/no payment. Keep the shape guard on the preview
  only, where a bogus body would otherwise enable Confirm with a fake "Free".
- A positive `TransactionTotalAmount` is the portal's "Proceed to Payment"
  case: the dialog closes, the panel closes and the tab goes to
  `/<webAddress>/checkout/payment?invoice_id=<Id>` (the standalone page opens
  that in a new tab). That is what the portal does; do not invent a different
  flow. The dialog shows the price from the preview either way.
- The dialog is a native `<dialog>` appended to the view root (the standalone
  page's body or the overlay's shadow root). The top layer beats
  `.onejob-overview-overlay`'s `z-index: 2000` and `::backdrop` covers the whole
  window, so do not build a div modal. `mount()` returns `hasOpenModal()`, and
  `content.js::onOverlayKeydown` returns early while it is true — the document
  capture handler runs before the shadow root, so this is the only way to let
  Escape close the dialog first.
- Durations are validated locally before any request: a positive multiple of
  the resource interval, at least one interval, at most
  `config.overview.booking.maxDurationMinutes`. Presets come from
  `config.overview.booking.presets`; a preset that is not a multiple of the
  live interval is hidden. Previews are debounced 350 ms and aborted on every
  change, so typing a duration does not queue requests.
- After a successful create the dialog closes, `load()` refetches and
  `showSuccess` renders a **fixed** `.notice.success` toast at the bottom of the
  window (`SUCCESS_MS`, 8 s). It floats on purpose: the confirmation arrives
  after a refresh that can leave the member scrolled past the top of the list,
  where an in-flow notice was invisible. `load()` clears it and its timer, so a
  refresh removes it early; do not render it in `renderNotice` (that one is for
  failures).
- **Cancelling is a DELETE with a reason body.** A row that is `mine` also gets
  a `×` (`gap-cancel`, red hover) that opens the cancel dialog. It posts
  `DELETE /api/public/bookings/<id>` with
  `{ id, cancellationReason, cancellationReasonDetails }` — the same body the
  portal's edit page sends — after `GET /api/public/bookings/<id>/cancellationFee`
  (`{ hasCancellationFee, cancellationFee }`, only used for the warning; a failed
  lookup must not block cancelling). The reasons are
  `config`-free in `lib/overview.js::CANCEL_REASONS`: `NoLongerNeeded`,
  `TooExpensive`, `BadPreviousExperience`, `RebookedForADifferentTime` and
  `Other` (which needs the ≤1024-char detail, sent only for *Other*; every other
  reason sends an empty string). The API rejects a cancellation without a
  reason, so Confirm stays disabled until one is picked.
- Cancellation refusals come back as `Message` (or `Errors[0].PropertyName`) and
  are mapped by `cancelError`: `ALREADY_INVOICED`, `NO_ACCESS`,
  `CHANGE_NOT_ALLOWED`, `CANNOT_CANCEL_IF_STARTED` and
  `BREAKS_CANCELLATION_POLICY|<minutes>`. The dialog stays open on a refusal so
  the reason can be changed; the row is only removed by the `load()` that follows
  a success. A row that already started gets a disabled `×` — the API refuses
  those anyway.
- Both dialogs share `dialogShell` and one `closeDialog()`, which tears down
  whichever is open (and bumps both tokens); `hasOpenModal()` checks both, so
  Escape ordering keeps working for either. Do not add a third dialog without
  going through the shell.
- `tests/fixture.html` mocks the four endpoints and appends created bookings to
  `window.__fixtureBookings`; its invoice answer is the bare `{ Id }` the live
  endpoint actually returns, not the preview's envelope. `window.__fixtureBasket`
  holds the last body, and `window.__fixtureCancelled`/`__fixtureCancelBody` the
  last cancellation. The preview there refuses overlaps with
  `BOOKING_CONFLICT` and slots that start in the past, which is how the error
  path is exercised without the real portal; the `cancellationFee` mock answers
  "no fee" and the `DELETE` removes the booking from both fixture feeds.

## Resource statistics

- **Entry point:** the bottom of the Resources menu (`renderMenuContent`), so it
  is mirrored in the mobile sheet. `openStatsOverlay()` in `content.js` closes
  the menu and mounts `OneJobStatsView` into the shared overlay shell. **Alt+S**
  (`config.stats.shortcut`) opens it even when the Resources menu is switched
  off. There is deliberately no separate nav item or popup link.
- **Group scope:** each expanded group's resource list ends with a `Statistics`
  row under `Show all`; it calls `openStatsOverlay({ scope: { type, group, label } })`.
  `OneJobStatsView.mount` stores the scope and `lib/stats.js::filterResources`
  narrows the resource list before `aggregate`, so the heatmap, charts, totals
  and tiles only cover that group. The type filter chips are hidden while
  scoped and the type summary drops the "share of booked hours" (it would always
  be 100%).
- **Data:** bookings from
  `GET /en/bookings/fullCalendarBookings?showAll=&start=…&end=…`, one request per
  **whole calendar month** (the current month ends at `now`). Resources come
  from `/api/public/resources/published/details` (fetched by the view itself,
  because `onejob:groups` is only written while the Resources menu is enabled);
  `onejob:groups.resources` is the fallback when that fetch fails. Only bookings
  whose `resourceId` is in the published list are counted; workshop
  reservations (`fullCalendarEvents`) and Luma events are not.
- **Periods:** 4 weeks, 3 months and 12 months, ending today. `lib/stats.js`
  returns the month keys, and `stats-view.js` fetches the missing/stale months
  with `config.stats.concurrency` workers. Records are deduped by `id` because
  the feed returns bookings that overlap the range, so a booking can appear in
  two month chunks.
- **Model:** `lib/stats.js::aggregate` clips each booking to the period, splits
  its hours across local days and hours, and returns totals, day buckets,
  weekday/hour buckets, booking-length buckets, per-resource bookings/hours/
  `rate`/`share`/`activeDays`/`band`, and the busiest day/weekday/hour. A
  booking that spans midnight counts on each day it touches, so the heatmap's
  daily counts can sum to more than the period total. The resource `rate` is
  booked hours per calendar day of the period; the colour bands are `0`,
  `≤0.5`, `≤1.5`, `≤3`, `>3 h/day` (`config.stats.bands`). `heatmap()` aligns
  weeks to Monday and uses the 95th percentile of daily hours as its intensity
  scale.
- **Cache:** `onejob:stats-cache` is
  `{ version, webAddress, months: { "YYYY-MM": { fetchedAt, records: [[id, resourceId, start, end], …] } } }`.
  `config.cache.statsVersion` invalidates the shape; the current month is fresh
  for `config.stats.cacheTtlMs` (15 min), past months for
  `config.stats.pastCacheTtlMs` (24 h). Refresh forces the selected period. The
  cache is pruned to the newest 13 months and capped at
  `config.stats.maxCacheBytes` (~2 MB); it stores no member names.
- **Overlay shell:** `openOverlay()` in `content.js` builds the same
  `.onejob-overview-overlay` shell for both screens, loads the stylesheet text
  once per file (`overview.css`, plus `stats.css` for statistics) and mounts the
  view with `onClose`. `activeOverlay.kind` stops the same screen from opening
  twice; opening the other closes the first. `stats.css` must stay in
  `web_accessible_resources` so the content script can fetch it.
- **Layout:** the stats root also carries `.overview` (palette, header, buttons,
  notices, footer) and `.is-panel`. `stats.css` adds the period pills, summary
  tiles, heatmap, charts, length bars, resource tiles and band colours. The
  heatmap scrolls inside `.stats-heatmap`; `min-width: 0` on `.stats`, the
  overlay panel and the host stops the year grid from widening the whole
  overlay on narrow windows.
- **Tests:** `tests/stats.test.mjs` covers periods (including month-end), month
  keys, normalisation/dedupe, clipping, midnight/day/hour splits, length
  buckets, bands, zero-booking resources, heatmap alignment/levels and empty
  data. `tests/fixture.html` filters the fixture bookings by the requested
  range; `tests/screenshots.html` generates a deterministic year of invented
  bookings when `window.__statsMode` is set by clicking the stats menu row.

## Calendar day grid

- **Placement:** `ensureDayGrid()` runs from `ensureNav()` right after
  `ensurePinsBar()`, so the grid's `.container` wrapper can be mounted under the
  pins wrap with `mountStrip(wrap, main, pinsWrap)`. `mountStrip` is the old
  `mountPinsBar` generalised: a block `<main>` gets the strip as a child, a
  flex/grid `<main>` (the personal pages) gets it just above `<main>`, and the
  optional `after` keeps the day grid below the pins.
- **Scope:** only a *single-resource calendar* — a bookings `calendar` route
  while `currentPinnedId()` is set. It is deliberately not shown on group, type
  or `/all` calendars: the booking feed has no resource filter, so a multi-
  resource grid would need the resource list and an average that is not what
  "bookedness" means here. `dayGridPin()` also returns the name/group/type for
  the pin marker.
- **Setting:** the popup's *Bookings heatmap* toggle writes `settings.dayGrid`
  (default `config.dayGrid.enabled`). `ensureDayGrid()` treats it like having no
  pin and removes the card, so the toggle takes effect on the next ensure pass
  without a reload. *Luma events in heatmap* writes
  `settings.dayGridEvents` (default `config.dayGrid.events`); off means no
  fetch, no dots, heatmap unchanged.
- **Window:** `lib/stats.js::dayGridRange` aligns to the Monday of the current
  week, goes `config.dayGrid.daysBack` days back and `daysAhead` days forward
  (7 + 21 = 28 columns). The window is anchored to today, not to the week the
  calendar shows, so browsing weeks does not move or refetch the grid.
- **Model:** `lib/stats.js::dayGrid` clips each booking to the window, splits it
  across local days and then across the configured hour blocks, and measures
  `share` against the block's own length. With the default 6-hour blocks a
  23:00–05:00 booking counts one hour in the first day's *evening* row and five
  in the next day's *night* row; the night row is 00–06 of the same calendar
  day, not "the night after". Levels come from `bandForRate(share, bands)`, so
  `config.dayGrid.bands` is a share, not booked hours. The rows are top to
  bottom in `config.dayGrid.buckets` order (morning, afternoon, evening, night).
- **Data:** one `GET /en/bookings/fullCalendarBookings?showAll=&start=…&end=…`
  per page, with the `AUTH_TOKEN` bearer token and the same headers as
  `fetchGroups`; records go through `S.normalizeRecords(payload,
  O.parseTimestamp)`. Everything stays in memory (`state.dayGrid`); no new
  storage key. A failed fetch renders an empty grid with a "Bookings
  unavailable" note and retries after 60 s; responses for a superseded key are
  dropped.
- **Linked bookings:** the feed repeats one booking once per linked resource,
  with the same `id` and `isLinked: true`. The heatmap therefore calls
  `S.normalizeRecords(payload, O.parseTimestamp, { perResource: true })`, and
  `S.dayGrid` filters by the pinned resource *before* deduping by id. Without
  that order the primary record (another resource) wins the dedupe and the
  pinned resource's time looks free. The tooltip says "(linked)" for such a
  booking. The statistics screen keeps the default global dedupe.
- **Luma events:** `loadDayGridLuma()` asks the background worker for
  `onejob:luma-events` (the same message the overview uses), normalises the
  entries with `O.normalizeLumaEvent` and passes `{ start, end, name }` into
  `S.dayGrid({ events })`. A cell they overlap gets `has-event` (a 4 px black
  dot with a 1 px `--onejob-daygrid-line` ring) and the tooltip gives the
  event's start time and name
  (`eventNames`/`eventStarts` are parallel arrays); they never change the
  booked share. Gated by `settings.dayGridEvents` alone (the popup's *Luma
  events in heatmap*), so turning the overview's events off leaves the dots in
  place; content.js only runs on the portal, so the origin check the overview
  needs (`lumaAvailable()`) is not repeated here. The list is space-wide, so it
  is fetched once per document and cached by the worker for 5 minutes.
- **Own bookings:** `loadDayGridMine(pin)` fetches `/api/public/bookings/my` for
  the same window (paged; naive local `FromTime`/`ToTime` via
  `O.toQueryTimestamp`) and passes the records' `{ id, resourceId, start, end }`
  into `S.dayGrid({ mine })`. A cell gets `is-mine` — a 3 px `--bs-success` bar
  along the bottom (`::before`; the Luma dot is `::after`) — and the tooltip
  says "your booking". No extra setting: it follows the session token, and the
  endpoint is the same one the overview's My bookings card uses.
- **Finished bookings are not in that endpoint.** Nexudus documents it as
  returning the member's *active* bookings, so a booking that ended yesterday is
  never in the response and the bar could only ever appear on today and later.
  The heatmap therefore also recognises the member's own rows in the calendar
  feed it already fetches (`normalizeRecords` keeps `coworkerId`/
  `coworkerName`): the first `/api/public/bookings/my` record that names its
  coworker tells it who the member is (`state.dayGrid.me`, passed as
  `S.dayGrid({ me })`), and a record of the pinned resource whose
  `coworkerId`/`coworkerFullName` matches is marked. A booking id in the `mine`
  list marks the record too, which is what covers a *linked* booking: the feed
  repeats it once per resource under the same id while `my` names the primary
  resource only. If `my` is empty (no active bookings) there is no identity to
  learn and finished bookings stay unmarked — the tooltip then shows the
  booking without "your booking".
- **Rebuild key:** `dayGridKey()` = pin id + window start day + data revision +
  visible week. The `MutationObserver` schedules an ensure pass for every DOM
  mutation, so the grid must not be rebuilt unconditionally; `revision` only
  changes when a fetch lands.
- **Click:** every square links to that day's week — the current query with
  `start`/`end` set to Monday 00:00 → +7 days and `onejob-resource` re-added —
  so middle-click/new-tab work. A plain click writes the full pin marker
  (`rememberPinnedResource`) and does `history.pushState` + a `PopStateEvent`,
  the same mechanism `page.js` uses for the ◀ ▶ buttons; `page.js`'s patched
  `pushState` is not involved (the content script has its own `history`
  wrapper), but the URL stays a calendar URL of the pinned type, so nothing is
  rewritten. If a future portal stops reacting to the dispatched event, switch
  the handler to `location.assign(cell.href)`.
- **Rendering:** one CSS grid,
  `max-content repeat(28, minmax(18px, 28px))` with `justify-content:
  space-between`: week labels span seven columns, then a weekday row (`Mon` …
  `Sun` from one `en-GB` short-weekday formatter), then the four rows with a
  label column plus square anchors, then the day-of-month row at the bottom
  under the night row. 18px is the narrowest column that still fits a
  three-letter weekday (the labels are `0.55rem`, the numbers `0.6rem`). The
  weekday and date spans share `headerCell()` in `renderDayGrid()` (so
  `is-today`, `is-weekend` and the full-date `title` stay in step) and the same
  `.onejob-daygrid-weekday` / `.onejob-daygrid-daynum` styles. Cells before
  today get `is-past` (`opacity: 0.35`), so last week and the elapsed part of
  this week read as history — but only an *empty* past square is dimmed
  (`is-past.level-0` without `is-mine`, `has-reserved` or `has-event`): the
  opacity applies to the whole square, markers included, so dimming a past
  booking hid its level colour and its green bar and a booking made yesterday
  looked unmarked. Saturday and Sunday get `is-weekend` and today
  gets `is-today`, but only their weekday labels and day numbers change: the
  weekend ones are bold and today's are bold and `--bs-primary`. The squares
  carry no outline and there is no rule between weeks — rings on the weekend
  columns, on today and a hairline on every Monday all competed with the level
  colour, which is what the grid is for; the only edge a cell has is the
  hover/focus ring. Empty weekend squares keep only 55% of their level-0 fill
  and mix the rest back into `--bs-body-bg` (Apple Calendar's quieter weekend
  columns), so the weekend recedes without a line; a booked weekend block keeps
  its level colour.
  `pointerover`/`pointerleave`
  toggle `is-hover` on the four cells of a day with a 1 px
  `--bs-primary-border-subtle` ring; only `:focus-visible` uses the full 2 px
  primary outline. The card scrolls
  horizontally instead of wrapping when 28 columns no longer fit.
- **Colours:** `.onejob-daygrid-level-0…4` in `portal.css`; level 0 is
  `--bs-tertiary-bg`, levels 1–4 mix 12/28/48/72% of `--bs-primary` into
  `--bs-body-bg` with `color-mix` (the manifest's minimum Chrome 111 has it).
  `[data-bs-theme="dark"]` overrides them: level 0 sits on `--bs-secondary-bg`
  and levels 1–4 mix 30/48/66/84%, because a 12% tint disappears into `#212529`.
  The dark hover ring uses a 60% primary mix for the same reason. No hardcoded
  `#0d6efd`.
- **Tests:** `tests/stats.test.mjs` covers the 28-day Monday alignment, the
  four rows and their `from`/`to`, midnight and block splits, the share bands,
  empty data and the `daysBack`/`daysAhead` overrides. `tests/fixture.html`
  keeps an incoming `?onejob-resource=<id>` when it rewrites the URL, so the
  pinned calendar (and the grid) can be opened directly.

## First-run onboarding

- The tour is a **feature tour**, not a menu tour: intro → pin one machine →
  the pinned calendar's 4 × 28 heatmap → Booking Overview → the toolbar settings
  → Resource statistics. `src/lib/tour.js` is the card; `content.js::tourSteps`
  owns the six steps. The pin step is **blocking**: `step.blocked` disables
  *Next* (and ArrowRight) until `state.pins` is non-empty, so the heatmap step
  always has a machine to follow. `togglePin` records the machine pinned during
  that step in `state.tourPinId` and advances; `tourPin()` prefers it over the
  active or first pin. The pin step stays in the array even when a pin already
  exists, so the "n of 6" counter survives the page change, and it then adapts:
  `tourPin()` makes it point at that chip (never at a menu pin button, which
  would unpin) and *Next* is enabled. The tour always starts at step 1; only a
  resumed tour starts further in, and `tour.js` hides Back up to `startedAt` so
  the steps before it cannot be reached. The pin step is dropped when
  `tourGroup()` finds nothing to pin, and the heatmap step when *Bookings
  heatmap* is off.
- No backdrop. The targets sit inside the portal's navbar, our dropdown and the
  overlays' shadow roots, so darkening the page needs z-index surgery on
  React-rendered ancestors. The card floats next to the target and the target
  gets `.onejob-tour-target` (outline + pulse, which respects
  `prefers-reduced-motion`). `tour.js` **also sets an inline outline**, because
  `portal.css` does not reach a target inside the overlay's shadow root; the
  class is kept for the pulse. Restore the previous inline values on clear.
- Step targets are **getters**, called on every 250 ms position tick: `fillMenu`
  rebuilds the rows whenever pins or the route change, and the overlays
  re-render, so a stored element reference goes stale.
  `lib/tour.js::place()` and `center()` are pure and covered by
  `tests/tour.test.mjs`.
- The heatmap step is **one step with two states**. Without `#onejob-day-grid`
  it points at the active pin chip, says only where the tour is going ("Next
  stop: <machine>'s calendar…") and its primary button writes
  `onejob:tour-resume` (`sessionStorage`, `{ version, step, at }`), calls
  `rememberPinnedResource(pin)` and `location.assign(tourPinHref(pin))`. The
  full legend (dot, green bar, orange bar) is only shown once the grid is on
  screen — explaining it before the page change read as if it had already
  happened. The next page consumes the marker in `maybeStartTour` and starts at
  the same step index (`startIndex`), so the tour counts "3 of 6" and Back still
  works. The marker is ignored after 30 s or when the step no longer exists;
  clicking the chip by hand during the step also writes it. The pin's href is
  built from `state.pins`, **not** from the chip element, so pinning a machine
  in step 2 does not race the strip's re-render.
- `tourPinHref()` mirrors `renderPinsBar`'s link (`U.bookingHref` with the pin's
  own type/group and the current `start`/`end`). Menu rows carry
  `data-resource-id` so the pin step can find its row without parsing
  `onejob-resource` out of the link (the page world patches `URLSearchParams`,
  and the fixture runs content.js in the page world).
- A step's `enter` runs before its target is looked up. `openTourMenu()` prefers
  the navbar item only when `isVisible()` — below 1200 px the portal hides the
  navbar but leaves the DOM in place, and the tour must use the dock's sheet
  instead. The sheet renders the same `renderMenuContent`, so the selectors
  carry over.
- Overlay steps call `openOverviewOverlay({ fromTour: true })` /
  `openStatsOverlay({ fromTour: true })`: the `fromTour` flag skips their
  `state.tour?.end(...)` and sets `aria-modal="false"` on the panel, because the
  tour card lives outside it and there is no focus trap. `onEnd` restores
  `aria-modal="true"`. Both overlay steps' `leave` closes their screen on every
  exit (Got it, Back, Skip), so the tour always ends back on the calendar.
- `openOverlay` is a promise queue with a generation counter. The tour can ask
  for the statistics screen while the overview's stylesheet is still loading,
  and a queued or in-flight open must not resurrect a screen the member closed
  (`closeOverlay(true)` bumps the generation; the replacement path inside
  `openOverlayNow` passes `false`).
- `missingMs` per step: 1 s by default, 4 s for the overview, 10 s for the
  statistics screen (13 months of fetches). While a target is missing the card
  stays up, centred, instead of ending the tour; `centered: true` steps (the
  settings preview) skip target lookup entirely. `step.render(container)` fills
  `.onejob-tour-figure` — that is how the settings preview shows
  `config.onboarding.settings` with the live `state.settings` values. Keep that
  row list in step with `popup.html`; `tests/popup.test.mjs` checks the labels.
- `settings.onboardingVersion` (`onejob:settings`, default 0) is the seen marker;
  `config.onboarding.version` is the current tour. Bump the config value to show
  the tour again after a rewrite. It is written **when the intro is shown**, not
  when the tour ends: clicking a resource name mid-tour navigates away, and that
  is the exact habit the tour is about, so it must not make the tour restart on
  every page. A resumed tour bypasses the seen check but still consumes the
  marker once.
- There is one way back in: *Replay* in the popup, which writes
  `onejob:tour-request` (`Date.now()`). `content.js` consumes the request on load
  and on `chrome.storage.onChanged` (reset to 0, so it runs once) and forces the
  tour even when it was already seen. The popup refuses with a hint while the
  Resources menu is switched off, since the pin step opens it.
- A normal start waits (without marking itself seen) until groups have loaded and
  the navigation is on screen; a resumed start waits for `#onejob-day-grid`
  instead, and `start()` schedules it before the group fetch so the calendar page
  does not wait on the menu. Someone with pins already is marked seen without a
  tour.
- Escape, Skip and a click outside the card end it; `onDocumentClick` ignores
  clicks on the card, and the card's `ignore` selector covers the nav item, the
  menu, the sheet, the dock, the overview items, the strip **and
  `.onejob-overview-overlay`** (shadow-root clicks retarget to the host inside
  it). Pinning during the pin step advances to the heatmap step.
- `tests/fixture.html?tour=1` forces the tour; without the parameter the fixture
  store counts it as seen. The dev server cannot answer the portal route the
  heatmap step navigates to, so `?onejob-resource=<id>` is how the post-resume
  state is checked. `tests/screenshots.html` always marks it seen.

## Luma events

- Mirrors the Django app's `Space.luma_source` + `SpaceMembership.show_luma_events`.
  `config.luma.source` is a public Luma user (`usr-…`) or calendar (`cal-…`)
  API ID, or any luma.com URL containing one; `config.luma.enabled` only seeds
  the popup toggle (`settings.lumaEvents` in `onejob:settings`).
- The popup's *Luma events in overview* row (`settings.lumaEvents`) is
  the only switch for the overview's event cards; the overview header has no
  toggle. `onStorageChanged` re-reads the setting, so changing the popup updates
  an open overview without a reload.
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
