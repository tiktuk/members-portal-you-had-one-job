# Chrome Web Store Listing — Members portal, you had one job

> Last Updated: 2026-11-06

Everything below is meant to be copy-pasted into the Chrome Developer Dashboard.
Source of truth for the store presence: update it whenever the manifest, the
feature set or the data practices change (see `AGENTS.md`).

## Store Listing

**Extension Name** [REQUIRED]

```
Members portal, you had one job
```

<!-- 31 characters. Must stay identical to manifest.json "name". -->

**Short Description** [REQUIRED]

```
Adds resource filters and pinned single-resource calendars to Nexudus members portals, so booking a machine takes one click.
```

<!-- 124 characters (limit 132). Identical to manifest.json "description". -->

**Detailed Description** [REQUIRED]

```
Adds resource filters and pinned single-resource calendars to Nexudus members portals, so booking a machine, lab or meeting room takes one click instead of four.

FEATURES

• Filters menu — a "Filters" item next to Bookings lists every bookable resource type and its groups, so you jump straight to "Machines › CNC Machining" instead of Bookings → Machines → Filters → Group → Close. On narrow windows, where the portal replaces its top navigation with a bottom bar, the same list opens as a sheet.

• Pin a resource — expand a group, press the pin next to a resource you book often, and it moves to the top of the menu. Clicking a pin opens the calendar with only that resource, so there is no horizontal scrolling through every machine of the type. A banner above the calendar links back to that resource's group.

• Pinned resources overview — one card per pinned resource with its bookings and workshop reservations for the next 14 days, grouped by day. Open it from the "Overview" button at the top of the Filters menu, or press Alt+O anywhere on the portal. Each card links to that resource's calendar, and its × button unpins it.

• My bookings — a card that collects your own bookings across every resource, each linking to its page in the portal.

• Calendar by default — booking links open the calendar view instead of the list. Picking "List" in the portal's own View dropdown still works and is remembered for the tab.

• No location prompt — the portal asks for your browser location on every page load. The extension stops that prompt. It never reads or stores your location, and the toolbar popup has a toggle to bring the prompt back.

• Space events — with the events toggle on, the overview also lists the space's upcoming public events, with an Event badge and the event description on expand.

HOW TO USE

1. Install the extension and open your members portal, signed in as usual.
2. Click "Filters" in the portal navigation. Every resource type and group is listed there.
3. Press the pin icon next to a resource you book often.
4. Press Alt+O, or the "Overview" button at the top of the Filters menu, to see all pinned resources and your own bookings.
5. The toolbar icon opens the same overview as a full page, lists your pins, and holds the four toggles.

The extension ships configured for the MotionLab.Berlin members portal. Nexudus gives every space its own domain, so to use it with another space, paste that portal's address into the toolbar popup and press Connect. The extension asks for access to that one site, and Remove gives it back.

PRIVACY

Nothing is sent to us. The extension has no servers, no analytics and no accounts. It reads your bookings from your own members portal using the session you are already signed in with, and keeps your pins, settings and portal list on your device. The only other service it talks to is the space's public events calendar, for the optional event list. Full details: https://tiktuk.github.io/members-portal-you-had-one-job/privacy.html

PERMISSIONS

• Read and change your data on your members portal — needed to add the Filters menu, open the calendar view by default, and show bookings in the overview. The extension only runs on portal addresses you have connected.
• Read your data on api.luma.com — needed to show the space's upcoming public events. Only public event data is read.
• Access to other sites on request — requested only when you paste a portal address and press Connect, because every Nexudus space lives on its own domain.

SUPPORT

Found a bug or have a suggestion? Open an issue at https://github.com/tiktuk/members-portal-you-had-one-job/issues or email tukodeb@gmail.com.

Version 1.0.1 — first release in the Chrome Web Store. The expand chevron on workshop and event rows no longer wraps onto a line of its own.
```

**Category** [REQUIRED]

```
Productivity
```

**Single Purpose** [REQUIRED]

```
Makes booking a shared resource on a Nexudus members portal faster by adding resource filters, a pin list and single-resource calendars.
```

**Primary Language** [REQUIRED]

```
English
```

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/icons/icon-128.png` (picked up from the manifest) |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `docs/screenshots/filters-menu.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/overview.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/overview-events.png` |
| Screenshot 4 | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 5 | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

<!-- Status options: ⬜ Not created | 🟡 Needs update | ✅ Ready -->

`docs/screenshots/popup.png` is 640×1360 and is README-only — the store rejects it.

### Screenshot Notes

All three are 1280×800 captures of `tests/screenshots.html`, which mirrors the
portal with an invented space, invented members and invented bookings, so no
member data appears in a public listing. Order them:

1. `filters-menu.png` — the Filters menu open over the portal, showing types,
   groups and the Overview pill. This is the feature that sells the extension.
2. `overview.png` — the pinned overview with My bookings and resource cards.
3. `overview-events.png` — the same view with the space's events merged in.

Regenerate with `python3 -m http.server 8765` and the capture steps in
`tests/screenshots.html` if the UI changes; outdated screenshots are a
rejection reason.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Keeps the member's pinned resources, the four popup toggles, the list of portal addresses they connected, a cached copy of the resource groups (so the Filters menu opens instantly) and the portal session used by the overview page. Everything is stored on the device with `chrome.storage.local`; nothing is synced and nothing is sent anywhere. |
| `scripting` | permissions | Nexudus gives every space its own domain, so the manifest can only ship the built-in portal. When a member pastes another portal's address in the popup and presses Connect, the extension registers the same content script for that origin at runtime. Without `scripting` the extension would only ever work on one space. |
| `https://*.spaces.nexudus.com/*` | host_permissions | The portal's own JSON endpoints for the resource list and bookings live on the space's `spaces.nexudus.com` subdomain. The extension reads them with the member's existing session to build the Filters menu and the overview cards. No HTML page content is read. |
| `https://api.luma.com/*` | host_permissions | Reads the space's public upcoming events (public calendar data only) so the overview can list them next to bookings. No account, no user data, no writes. |
| `https://*/*` | optional_host_permissions | Only requested after the member types a portal address and presses Connect, and it is the only way to reach a portal on its own domain. It is optional, so the install-time prompt does not include it, and Remove gives the permission back. |
| `content_scripts.matches: https://members.motionlab.berlin/*` | content script | The built-in portal. This is the only site the extension runs on without the member granting anything. |
| `web_accessible_resources.matches: https://*/*` | web accessible resources | The page-world script and the overview page have to be loadable from any portal a member connects, and there is no runtime equivalent of this list. Access is still gated by the optional host permission above, not by this match pattern. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — it handles the member's portal
session and the booking records shown in the overview. Nothing leaves the
device except requests to the member's own portal and the space's public event
calendar.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | Yes | No | Names of coworkers already visible on the portal's own calendar are shown on bookings in the overview. Fetched from the member's portal, displayed, not stored. | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | Yes | To the member's own portal only | The portal session token is kept on the device so the overview page can read the member's bookings without reopening the portal. It is sent only in requests to the member's own Nexudus space, and never to the developer or any other party. | No |
| Personal communications | No | No | — | No |
| Location | No | No | The extension never reads the location. It suppresses the portal's own location prompt; the toggle in the popup restores it. | No |
| Web history | No | No | No history API is used. The extension only runs on portal addresses the member connected. | No |
| User activity | Yes | To the member's own portal only | The member's own bookings are read to fill the My bookings card. Not stored, not transmitted anywhere else. | No |
| Website content | Yes | No | The portal's own navigation labels and URL are read to build the Filters menu and keep the calendar view. Stays on the device. | No |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]

```
https://tiktuk.github.io/members-portal-you-had-one-job/privacy.html
```

<!-- Source: docs/privacy.md. Served by GitHub Pages from main /docs; verified
     live on 2026-11-06. The page is Jekyll-rendered, so the URL ends in
     .html even though the source is .md. -->

## Distribution

**Visibility**: Unlisted
**Regions**: All regions

<!-- Unlisted: anyone with the link can install, but it does not appear in search.
     The extension only does something on a Nexudus members portal, so a public
     listing would mostly collect installs from people who cannot use it.
     Private (trusted testers only) is the alternative if the space wants to
     control exactly who installs it. -->

## Developer Info

**Publisher Name** [REQUIRED]

```
Tuk Bredsdorff
```

**Contact Email** [REQUIRED]

```
tukodeb@gmail.com
```

**Support URL / Email** [RECOMMENDED]

```
https://github.com/tiktuk/members-portal-you-had-one-job/issues
```

**Homepage URL** [RECOMMENDED]

```
https://github.com/tiktuk/members-portal-you-had-one-job
```

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.1 | 2026-11-06 | First store submission. Expand chevron on workshop and event rows no longer wraps onto its own line. | Draft |
| 1.0.0 | 2026-11-05 | First release, GitHub only (unpacked installs). | Not submitted |

<!-- Status options: Draft | Submitted | In Review | Published | Rejected -->

## Review Notes

<!-- Not published. For the reviewer-facing "Notes for reviewers" field, see
     the box at the end of this section. -->

### Notes for Reviewers

Paste this into the dashboard's *Notes for certification* field:

<!-- The repo is public, so the test account's email and password are typed into
     the dashboard field and never written here. Keep them in
     CHROMEWEBSTORE.local.md (gitignored) if they need to live somewhere on disk. -->

```
This extension only does anything on a Nexudus members portal, which needs a
signed-in member account. Test credentials for the built-in portal
(members.motionlab.berlin) are at the end of this field.

After signing in, open https://members.motionlab.berlin/motionlabberlin/bookings/machines/calendar

1. Click "Filters" in the top navigation (or the Filters button in the bottom
   bar on a narrow window). The menu lists every resource type and group.
2. Press the pin icon next to any resource. It moves to the top of the menu.
3. Click the pinned resource: the calendar shows only that resource, with a
   "Pinned" banner above it.
4. Press Alt+O (Option+O on macOS) to open the pinned resources overview. It
   shows the My bookings card and one card per pinned resource. The toolbar
   popup's "Overview" link opens the same page in a new tab.
5. The toolbar popup has four toggles: calendar as default view, the Filters
   menu, Luma events and the location prompt block.

To test another space, paste its portal address into the popup's "Members
portal" field and press Connect; the extension asks for access to that one site
and then works there too. Remove gives the permission back.

The optional https://*/* permission is only requested from that Connect button:
each Nexudus space lives on its own domain, so the manifest cannot list them.
```

### Known Issues / Limitations

- **Needs a signed-in account.** A reviewer who is not given credentials sees
  the portal's login page and nothing else. Without a test account in the
  dashboard's notes field, expect a "does not appear to function" rejection.
- **The optional `https://*/*` permission will be questioned.** The answer is in
  the justification table: runtime registration for portals on their own
  domains. The permission is requested only from the Connect button.
- **Luma events are tied to one calendar.** `config.luma.source` is
  MotionLab.Berlin's public Luma calendar, so the toggle is disabled on other
  portals rather than showing the wrong space's events. The listing says "the
  space's public events", which is true for the built-in portal and off
  elsewhere — worth a sentence in the reviewer notes if it is flagged.
- **"Nexudus" in the description.** The name avoids the trademark, and the
  description uses the platform name only to say what the extension works with.
  Do not put it in the extension name.
- **`web_accessible_resources` matches `https://*/*`.** It is a broad match for a
  narrow reason (runtime portals); the optional host permission is the real gate.
- **`chrome.storage.local`, never `.sync`.** Nothing is uploaded to Google, so
  the disclosure says "on the device".

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| | | | |

## Pre-Submission Checklist

- [x] `manifest_version: 3`
- [x] Version bumped to 1.0.1 and `package.json`, `src/manifest.json` and
      `CHANGELOG.md` agree (`npm test`)
- [x] Manifest name and description match this document, description ≤ 132 chars
- [x] ZIP is built from `src/` only — no `.git/`, `node_modules/`, tests,
      screenshots, README, CHANGELOG or this file (24 files, ~55 KB)
- [x] No remote code, no `eval`, no obfuscation; every file is in the package
- [x] Every permission and host permission justified above
- [x] Privacy policy published and the URL loads
- [ ] Reviewer test account appended to the dashboard's notes field (never
      written in this file — the repo is public)
- [ ] Screenshots 1–3 uploaded in the order listed
- [ ] Data use disclosure in the dashboard matches the table above
- [ ] ZIP uploaded from the `v1.0.1` GitHub release (not a local `dist/` build)

<!-- Release asset: https://github.com/tiktuk/members-portal-you-had-one-job/releases/download/v1.0.1/members-portal-you-had-one-job.zip
     sha256 f947526764a4350cc6b8507700fdf25c874dc9d3f82faa5d50f5ef6ca802e0fa (55,530 bytes) -->
