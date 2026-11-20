# Changelog

All notable changes to this extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version lives in `package.json` and `src/manifest.json` and must match the
newest release below; `tests/manifest.test.mjs` fails when they drift.

## [Unreleased]

### Added

- Press `p` for a quick-open chooser (fuzzy search, pinned resources first)
  that jumps straight to a resource's calendar, a whole category ("All 3D
  printing" or "All machines"), the booking overview or the portal's My
  bookings page. While Caro Week View is open, the chooser instead switches
  the view to the picked resource or category without leaving it.
- Shortcut help now includes a short guide to the extension's other features.
- Put shortcut help beside Statistics in the portal strip and beside Refresh
  in the overview, Statistics, and Caro Week View headers; strengthen keycap
  contrast in the portal's dark theme.
- Keep the shortcut help button visible within extension overlays, and
  route `,` / `.` to Caro Week View while it is open instead of the calendar
  behind it.
- Single-key shortcuts: open Booking Overview / Statistics / Caro Week View
  with `o` / `s` / `c`, and use `,` / `.` for calendar navigation. Caro Week
  View and Statistics pills also have one-key controls; `h` or the help button
  lists the active keys. The toolbar popup can turn these character shortcuts
  off; Alt+O and Alt+S continue to work.
- The booking dialog shows start and end times alongside duration. Editing the
  free endpoint recalculates duration, and editing duration recalculates that
  endpoint; the selected slot or adjacent booking edge stays fixed.
- Category week view: every machine of a category side by side for the week.
  Seven days run across and each day holds one narrow column per resource on a
  shared hour axis, so you can compare machines at the same hour. A "Week view"
  link sits at the right end of the pins strip on category calendars (next to
  Statistics, and Show all while a pin is open), and each
  group in the Resources menu has a "Week view" row under Statistics. Your own
  bookings are green, workshop reservations are hatched and Luma events tint the
  day. Click a free time to book it (the same dialog as the overview, capped to
  the free gap) or one of your own bookings to cancel it. The toolbar popup's
  "Category week view" toggle hides both entry points. On a pinned
  single-resource calendar the button shows just that machine, one wide column
  per day, and overlapping bookings (a tentative one next to a firm one) sit
  side by side instead of hiding each other.
- The week view's tooltips name the member behind each booking, and the name is
  printed inside the block after the booking's start time, vertically from the top in narrow columns and horizontally when a
  day has one or two columns.
- The week view draws several bookings of one member on the same machine in
  the same slot once, with a "×2" after the name, like the portal's own calendar
  does. The feed holds one record per booking, and a machine that allows
  multiple bookings can hold the same member's booking twice.
- In the week view a booking that the portal links to several machines (for
  example the Prusa MK4 enclosure variants) is drawn on each of them, and the
  copies on the linked machines are lighter with a dashed outline; the tooltip
  says it was booked on a connected machine.
- The week view's machine-name header grows to fit the longest name (up to
  14rem), so similarly named machines ("Prusa - MK4 Enclosure 1" / "… 2") no
  longer end up with the same truncated label; a resource listed twice by the
  portal is shown once.
- The week view has a switch in its header between the pinned machine it was
  opened from, all your pinned machines of that type, the whole category and
  one button per other category you have pins in (viewing a laser with a CNC
  pinned adds "CNC Machining"), and "My bookings" (every machine you have a booking on in the visible week, in any
  category).

### Changed

- Renamed the category week view to “Caro Week View” throughout the interface and
  store and privacy copy.
- The week-view popup fits its calendar content, sits slightly higher, and
  remains bounded on short screens.
- The original calendar page labels the type/category shown after using
  *Show all*, rather than leaving the scope implicit in the first resource.
- The in-portal overview, statistics and week-view panels use much smaller
  viewport insets and expand to the available screen space.
- The category week view can switch between a full week and a single-day view;
  day navigation moves one date at a time.
- Booking durations can be entered as hours and minutes. Durations use
  one-minute precision unless Nexudus provides a resource `IntervalLimit`.
- The booking and cancel dialogs moved out of the overview into
  `lib/booking-dialog.js` so the overview and the week view share them. No
  change in behaviour.
- The week view shows each resource's peak concurrent usage per day plus one
  spare lane for new bookings, up to its Nexudus `Allocation`. The lane count
  grows after a booking when capacity permits, while lanes remain shared
  capacity rather than numbered physical units. The dashed booking preview is
  confined to the free lane under the pointer.
- The category week view uses Nexudus resource `Allocation` to show concurrent
  capacity lanes. Remaining lanes stay bookable even while another unit is
  reserved; the portal feed does not identify the numbered physical machine.
- The week view lightly distinguishes weekends, hides elapsed days in the
  current week, and gives each day header its own shade and divider. Related
  machines share a hue with a different shade per machine; machine colours are
  on by default and can be turned off in the toolbar popup.

### Fixed

- The resource chooser no longer stays painted behind the page after Escape:
  its `display: grid` had overridden the browser's `dialog:not([open])` rule,
  so a closed palette kept rendering in normal flow under the navbar and grid.
- The resource chooser stays on top and closable even when the portal breaks
  dialog modality: `showModal()` now falls back to the picker's own
  full-screen backdrop and layer, and Escape closes the chooser and shortcut
  help explicitly instead of relying on the dialog's native close.

## [1.1.1] - 2026-11-17

### Changed

- The store description no longer promises "one click": the manifest's
  description now says "so you reach the right machine fast", and the detailed
  description opens without a click count. How many clicks a booking takes
  depends on how you count.
- The release zip is named with its version, `members-portal-you-had-one-job-<version>.zip`,
  in `scripts/build.sh` and on the GitHub release, so downloads from different
  releases no longer look alike.

## [1.1.0] - 2026-11-17

### Added

- Hovering a booking or a workshop reservation in the overview shows a small
  **+** before and after its title, and only where the resource is actually
  free: nothing on a side where another booking starts exactly when this one
  ends (or overlaps it), and nothing before a booking that already started. The
  left one books the resource for a slot that ends when that row starts, the
  right one for a slot that starts when it ends, so a 30-minute gap next to your
  own session is one click instead of a trip through the portal's booking form.
  The dialog asks only for the duration (30 min / 1 h / 2 h, or any multiple of
  the resource's own booking interval), opens on the free time itself — an hour,
  or 30 min when that is all the gap holds — and hides the lengths that do not
  fit. It shows the exact times, the member it books for and the price the
  portal quotes; confirming creates the booking
  through the portal's own checkout, and a paid slot opens the portal's payment
  page as the portal itself does. A refused slot says why — already booked,
  outside the opening hours, not on the right plan — with a link to the
  portal's prefilled booking form.
- Your own bookings in the overview can be cancelled from the row itself: a
  small **×** next to the title asks for the portal's cancellation reason (with
  the free-text field its *Other* option needs), warns when the portal quotes a
  cancellation fee, and reports a refusal — already invoiced, inside the
  cancellation window, already started — without leaving the page. Only rows
  that are yours carry it.
- A **Resource statistics** screen at the bottom of the Resources menu (and
  **Alt+S**): a 12-month daily heatmap, every published resource colour-coded
  by booked hours per day, weekday and time-of-day charts, a booking-length
  distribution and summary tiles. Periods switch between 4 weeks, 3 months and
  12 months; resource tiles link to the single-resource calendar.
- The statistics screen caches compact booking times per month in
  `chrome.storage.local` (`onejob:stats-cache`; the current month for 15
  minutes, past months for 24 hours, no member names), so reopening it does not
  refetch the year.
- Each group's expanded list has a **Statistics** row under *Show all* that opens
  the statistics screen scoped to that group: its heatmap, charts, totals and
  resource tiles only cover the group's resources.
- A 4 × 28 heatmap at the top of a single-resource calendar, under the pins:
  28 days from last week to the week in two weeks, with morning, afternoon,
  evening and night rows. Each square is coloured by how much of that six-hour
  block is booked; clicking one opens that day's week in the calendar. Workshop
  reservations count as occupied and get an orange bar, the member's own
  bookings a green one, and a dot marks a Luma event (when *Luma events in
  heatmap* is on). Bookings linked to the resource from another resource's
  booking count too and are marked "(linked)". The tooltip gives the times and
  names. The popup's *Bookings heatmap* toggle hides the heatmap and *Luma
  events in heatmap* hides the dots.
- Pins sit in a strip at the top of every portal page, below the navigation, so
  a pinned resource is one click away without opening the menu. Each chip links
  to that resource's calendar and carries its own unpin button.
- A one-time feature tour on the first portal visit. It starts by asking for a
  pin — the step's *Next* stays disabled until one is made — and then follows
  that machine to its calendar to show the 4 × 28 heatmap, with the dot, the
  green bar and the orange bar explained once the grid is on screen. From there
  it points at the Booking Overview nav item before opening the screen it
  leads to — and at the menu's *Resource statistics* row before that one — so
  an overlay never takes over the window unannounced, previews the six toolbar
  settings with their
  current state and finishes on the Resource statistics screen, closing it
  again so the tour ends back on the machine's calendar. The page change
  is bridged by a `sessionStorage` marker, so the tour continues on the calendar,
  and quitting early leaves the member on that page. From the overview it rings
  a real **+** gap button where one of the member's pins has a free slot —
  falling back to a booking row when nothing is free — to show the one-click
  booking it makes. Escape, *Skip* or a click outside ends it, and skipping
  closes the screen it opened. *Replay* in the toolbar popup starts it again;
  with a pin already in place that step points at the existing chip instead of
  asking for another pin.

### Fixed

- The tour's last step no longer throws `Cannot read properties of undefined
  (reading 'ctrl')`, which stopped the tour from starting at all. The step asked
  for the shortcut label without the shortcut, so it now names the overview
  shortcut it was meant to mention.
- The pins strip no longer breaks the personal pages. Their `<main>` is a flex
  row (a 200px activity menu next to the content), so the strip became a column
  of its own; it now sits just above `<main>` wherever that is a flex or grid
  container.
- The heatmap's green *your booking* bar was invisible on days that are already
  past. The square's `is-past` opacity covered the bar too, so a booking made
  yesterday looked like it had never been marked. Only an empty past square is
  dimmed now; one with a booking, a reservation or a Luma event keeps its full
  colour and its bars.
- A booking of your own that has already finished never got the green bar at
  all. The marker came from `/api/public/bookings/my`, which only lists *active*
  bookings, so the bar could only ever appear from today onwards. The heatmap
  now also recognises your rows in the calendar feed it already fetches, by the
  member the feed names and by booking id (which covers a booking of yours that
  is linked to the pinned resource), so yesterday's booking is marked too.

### Changed

- The 4 × 28 heatmap is quieter about its frame: no ring on today, none on the
  weekend columns, and no hairline between the four weeks. Those edges competed
  with the level colour, which is the point of the grid. Empty weekend squares
  now fade back into the card instead, the way Apple Calendar keeps its weekend
  columns quiet, so the weekend still reads without a line; the bold weekday
  and date labels keep marking today and the weekend.
- Clicking a group name in the Resources menu opens that group's machines
  instead of jumping to its calendar; the whole row is the toggle now, and the
  arrow is only its affordance. The group's own calendar is a *Show all* row at
  the end of the expanded list. Clicking names was what people did instead of
  finding the small chevron, and it took them away from the list.
- Pin icons are visible in the Resources menu without hovering a row. On
  hover-only they were the one affordance nobody found; the hover background now
  carries the emphasis instead.
- The injected menu is called **Resources** instead of **Filters**. The label
  still comes from `config.nav.label`, and the popup rows and the overview's
  empty state now read it from there too instead of repeating it in prose.
- The Resources menu no longer repeats the pinned resources; the strip above it
  is the only place they appear.
- The *Pinned — Showing only …* banner is gone. Its *Show all* link now sits at
  the end of the strip while a single resource is shown, so the pin state is one
  row instead of two.
- The Resources menu no longer has *Show me how pinning works*; replay the tour
  from the toolbar popup.
- The overview's *Events* pill is gone, along with the *Show events* checkbox
  that briefly replaced it: the toolbar popup's **Luma events in Booking
  Overview** row is the only switch for merging the space's events into the
  cards. A pill gave no hint that it toggled anything, and a second control in
  the header duplicated the popup.
- The popup's two event rows are named *Luma events in overview* and
  *Luma events in heatmap*, so it is clear which view each one affects.
  Both default to on, and each one now controls only its own view: turning the
  overview's events off no longer removes the heatmap dots.
- The overview moved out of the Resources menu into its own **Booking Overview**
  item in the portal navigation, right after Resources — with an *Overview*
  button in the bottom dock on narrow windows. It is a separate entry point, so
  it stays when the Resources menu is switched off.
- The 4 × 28 bookings heatmap labels each column with its weekday (Mon … Sun)
  and puts the day-of-month numbers under the squares instead of above them, so
  the columns read as days of the week first. Hovering a weekday or a square
  still gives the full date.

## [1.0.2] - 2026-11-06

### Removed

- Support for adding other Nexudus portals from the popup. It needed the
  `scripting` permission, the optional `https://*/*` host permission and a
  wildcard `https://*.spaces.nexudus.com/*`, which is what the Web Store flags
  as overly broad and what slows a review down. The extension now asks for
  `storage` alone and for two hosts: the MotionLab.Berlin portal's API and
  Luma's public event API. The implementation is kept on the `runtime-portals`
  branch; another space forks it and changes `config.portal.origin`,
  `config.portal.webAddress`, the manifest's `content_scripts.matches` and its
  `host_permissions` entry.

## [1.0.1] - 2026-11-06

First release published to the Chrome Web Store.

### Fixed

- The expand chevron on workshop and Luma rows no longer wraps onto a line of
  its own when the title and badge fill the row, where it read as a stray dot.

## [1.0.0] - 2026-11-05

First release, published as **Members portal, you had one job**.

### Added

- A **Filters** item in the portal navigation that lists every resource type and
  its groups, so one click opens that group's bookings instead of
  *Bookings → Machines → Filters → Group → Close*. Below 1200 px a **Filters**
  button in the bottom dock opens the same list as a sheet.
- Pinnable resources. The pin button next to a resource keeps it at the top of
  the menu, and clicking a pin opens the calendar filtered to that one resource,
  with a banner linking back to its group.
- A pinned resources overview, both as a standalone page from the toolbar popup
  and as an overlay inside the portal (**Alt+O**, or the **Overview →** pill at
  the top of the Filters menu). One card per pinned resource shows the next 14
  days of bookings and workshop reservations, grouped by day, with expandable
  descriptions and an unpin button.
- A **My bookings** card that collects your own bookings across every resource,
  linking each one to its portal edit page.
- Optional **Luma events**: upcoming MotionLab.Berlin events are merged into
  every card with an *Event* badge and a lazily loaded description. The public
  Luma API only allows `luma.com` as a CORS origin, so a background service
  worker proxies the requests and caches the results.
- A toolbar popup with toggles for *Block location prompt* and *Luma events*,
  the pinned resource list, the group cache status and a link to the overview.
- Support for any Nexudus members portal, not just the built-in one. The popup
  has a **Members portal** field: enter another space's address, accept the
  site-access prompt, and the extension registers its content script for that
  origin at runtime (`chrome.scripting`). Added portals are listed with a
  **Remove** button, and the background worker re-checks registrations and
  permissions on every browser start.

### Changed

- Booking links open the calendar view instead of the list view. Choosing *List*
  in the portal's own *View* dropdown still works and is remembered per tab.
- The extension is now called **Members portal, you had one job** (previously
  *Nexudus Portal+*), including the Safari app name, the bundle identifier, the
  npm package name and the build artifacts. The name avoids a third-party
  trademark; the description still says which portals it works with.
- The internal namespace prefix is `onejob` — `onejob:pins`, `OneJobUrl`,
  `.onejob-*` classes and the `?onejob-resource=` query parameter — instead of
  `nxplus`. Pins, settings and the mirrored session from the old keys are not
  carried over; re-pin and open the portal once after updating.
- The manifest asks for the `scripting` permission and the optional host
  permission `https://*/*`, and `web_accessible_resources` matches `https://*/*`
  instead of the one portal origin, so a portal added at runtime can load the
  page-world script.
- Overview links (*Open portal*, *My bookings*, booking edit pages, resource
  calendars and event links) follow the portal that mirrored the session instead
  of the hard-coded origin, so they stay correct on other spaces.
- Luma events are limited to the built-in portal: `config.luma.source` belongs
  to MotionLab.Berlin, so the toggle is disabled while another space is active
  rather than merging the wrong space's events.

### Fixed

- The portal's location prompt no longer appears on every visit. The extension
  hides `navigator.geolocation` before the app boots, which makes the portal
  skip the request; the popup toggle restores the real API.
- The pinned calendar's Previous/Next buttons step the visible date range
  instead of scrolling a resource grid that holds a single resource.
- Leaving a pinned view resets the portal's cached, filtered resource list, while
  reloading the pinned view keeps it.
- The banner's *Show all* link keeps the resource's group, so the calendar
  returns to the same category instead of the first resource of the whole type.
- Overview times match the portal calendar: the `/en/...` feeds are UTC instants
  and are converted to the browser timezone, while `/api/public/bookings/my`
  returns naive local times that are used as-is.
