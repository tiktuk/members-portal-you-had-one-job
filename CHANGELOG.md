# Changelog

All notable changes to this extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version lives in `package.json` and `src/manifest.json` and must match the
newest release below; `tests/manifest.test.mjs` fails when they drift.

## [Unreleased]

### Added

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
  bookings a green one, and a dot marks a Luma event (when *Luma events* is
  on). Bookings linked to the resource from another resource's booking count
  too and are marked "(linked)". The tooltip gives the times and names. The
  popup's *Bookings heatmap* and *Luma event dots* toggles hide the heatmap and
  the dots respectively.
- Pins sit in a strip at the top of every portal page, below the navigation, so
  a pinned resource is one click away without opening the menu. Each chip links
  to that resource's calendar and carries its own unpin button.
- A one-time tour on the first portal visit. It opens the Resources menu,
  points at the group arrow, at the pin button, and at the chip in the strip, so
  pinning is shown instead of hidden behind a chevron. Escape, *Skip* or a click
  outside ends it. *Replay* in the toolbar popup starts it again.

### Fixed

- The pins strip no longer breaks the personal pages. Their `<main>` is a flex
  row (a 200px activity menu next to the content), so the strip became a column
  of its own; it now sits just above `<main>` wherever that is a flex or grid
  container.

### Changed

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
- The overview's *Events* pill is now a *Show events* checkbox. A pill that only
  changed colour gave no hint that it was a toggle; the tick says so, and the
  label reads as the state it switches.
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
