# Privacy Policy — Members portal, you had one job

Last updated: 6 November 2026

**Members portal, you had one job** is a browser extension that adds resource
filters, pinned single-resource calendars and a pinned-resources overview to
Nexudus members portals. This policy describes exactly what it handles.

The short version: the extension has no servers, no analytics and no accounts.
It reads your bookings from your own members portal, using the session you are
already signed in with, and keeps your settings on your device.

## What the extension handles

- **Your portal session.** The members portal issues a session token when you
  sign in. The extension keeps a copy of it on your device so the overview page
  can read your bookings without asking you to open the portal again. It is
  sent only to your own portal, and only to fetch your bookings.
- **Your pins and settings.** Which resources you pinned, the four toggles in
  the toolbar popup, and the portal addresses you connected.
- **Resource groups and bookings.** The extension reads the portal's resource
  list (type, group and name) to build the Filters menu, and booking records to
  fill the overview cards. Booking records include the name of the member who
  booked a shared resource, which the portal already shows you on its own
  calendar.
- **Your portal page.** The extension reads the portal's own navigation labels
  and address to build the Filters menu and to keep the calendar view when you
  navigate.

## What the extension does not do

- It does not read your location. It suppresses the portal's own location
  prompt, which you can turn back on in the popup.
- It does not read your browsing history, and it does not run on sites other
  than the members portals you connected.
- It does not use cookies, analytics, telemetry, advertising or tracking of any
  kind.
- It does not create an account, and it does not send anything to the
  developer.

## Where data is stored

Everything stays on your device, in the extension's own local storage:

- Pins, settings and the list of connected portals.
- A cached copy of the resource groups, so the Filters menu opens instantly.
- The portal session, so the overview page works without reopening the portal.

None of it is synced to your browser account or to any server. Removing the
extension deletes it.

## What leaves your device

Only requests to services you already use:

- **Your members portal** (your space's Nexudus address), with your own session,
  to read the resource list and your bookings.
- **The space's public events calendar** (Luma's public API), to list upcoming
  events in the overview. Only public event data is requested; nothing about you
  is sent. This can be turned off with the popup's events toggle.

Both requests go directly from your browser. No intermediary, proxy or service
of ours is involved.

## Third parties

The extension talks to the same two services the members portal itself uses:
Nexudus, which hosts the portal and your bookings, and Luma, which hosts the
space's public event calendar. Their own privacy policies govern the data they
hold; the extension adds nothing to it. No data is sold, rented or shared with
anyone else.

## Your controls

- Unpin a resource from the menu or from its card in the overview.
- Turn any of the four features off in the toolbar popup.
- Remove a connected portal in the popup, which also gives back the site access
  you granted for it.
- Uninstall the extension to delete everything it stored.

## Changes to this policy

If a future version of the extension handles data differently, this page will
be updated before that version is released, and the change will be listed in
the extension's changelog.

## Contact

Questions about this policy: tukodeb@gmail.com, or open an issue at
<https://github.com/tiktuk/members-portal-you-had-one-job/issues>.
