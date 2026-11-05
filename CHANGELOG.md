# Changelog

All notable changes to this extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version lives in `package.json` and `src/manifest.json` and must match the
newest release below; `tests/manifest.test.mjs` fails when they drift.

## [Unreleased]

## [1.0.0] - 2026-11-05

First release, published as **Nexudus, you had one job**.

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
- The extension is now called **Nexudus, you had one job** (previously *Nexudus
  Portal+*), including the Safari app name, the bundle identifier, the npm
  package name and the build artifacts.
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
