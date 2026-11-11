# Chrome Web Store Listing — Members portal, you had one job

> Last Updated: 2026-11-11

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
Adds resource filters and pinned single-resource calendars to the MotionLab.Berlin portal, so booking a machine takes one click.
```

<!-- 128 characters (limit 132). Identical to manifest.json "description". -->

**Detailed Description** [REQUIRED]

```
Adds resource filters and pinned single-resource calendars to the MotionLab.Berlin members portal, so booking a machine, lab or meeting room takes one click instead of four.

FEATURES

• Resources menu — a "Resources" item next to Bookings lists every bookable resource type and its groups, so you jump straight to "Machines › CNC Machining" instead of Bookings → Machines → Filters → Group → Close. Clicking a group opens its machines, and the "Show all" row at the end of that list opens the whole group's calendar. On narrow windows, where the portal replaces its top navigation with a bottom bar, the same list opens as a sheet.

• Pin a resource — expand a group, press the pin next to a resource you book often, and it moves to a strip at the top of every portal page, visible without opening the menu. Clicking a pin opens the calendar with only that resource, so there is no horizontal scrolling through every machine of the type; while that view is open the strip also offers "Show all" for the resource's group.

• First-run tour — the first time you open the portal, a short tour opens the Resources menu and points at the group arrow, the pin icon and the strip, so pinning is shown instead of hidden behind a chevron. Replay it from the bottom of the Resources menu or from the toolbar popup.

• Pinned resources overview — one card per pinned resource with its bookings and workshop reservations for the next 14 days, grouped by day. Open it from "Booking Overview" in the portal's main navigation, or press Alt+O anywhere on the portal. Each card links to that resource's calendar, and its × button unpins it.

• My bookings — a card that collects your own bookings across every resource, each linking to its page in the portal.

• Calendar by default — booking links open the calendar view instead of the list. Picking "List" in the portal's own View dropdown still works and is remembered for the tab.

• No location prompt — the portal asks for your browser location on every page load. The extension stops that prompt. It never reads or stores your location, and the toolbar popup has a toggle to bring the prompt back.

• Space events — with the events toggle on, the overview also lists the space's upcoming public events, with an Event badge and the event description on expand.

HOW TO USE

1. Install the extension and open your members portal, signed in as usual. The first visit shows a short tour; replay it from the bottom of the Resources menu or the toolbar popup.
2. Click "Resources" in the portal navigation. Every resource type and group is listed there; click a group to open its machines.
3. Press the pin icon next to a resource you book often. It appears in the strip at the top of the page.
4. Press Alt+O, or "Booking Overview" in the main navigation, to see all pinned resources and your own bookings.
5. The toolbar icon opens the same overview as a full page, lists your pins, and holds the four toggles.

This build is for the MotionLab.Berlin members portal. Nexudus gives every space its own web address, so the extension is installed for one portal at a time and does nothing anywhere else.

PRIVACY

Nothing is sent to us. The extension has no servers, no analytics and no accounts. It reads your bookings from your own members portal using the session you are already signed in with, and keeps your pins and settings on your device. The only other service it talks to is the space's public events calendar, for the optional event list. Full details: https://tiktuk.github.io/members-portal-you-had-one-job/privacy.html

PERMISSIONS

• Read and change your data on the MotionLab.Berlin members portal and its booking API — needed to add the Resources menu, open the calendar view by default, and show bookings in the overview. The extension runs on no other site.
• Read your data on api.luma.com — needed to show the space's upcoming public events. Only public event data is read.

SUPPORT

Found a bug or have a suggestion? Open an issue at https://github.com/tiktuk/members-portal-you-had-one-job/issues or email tukodeb@gmail.com.

Version 1.0.2 — first release in the Chrome Web Store. Asks only for the one portal and the space's public events calendar.
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

`docs/screenshots/popup.png` is 640×1181 and is README-only — the store rejects it.

### Screenshot Notes

All three are 1280×800 captures of `tests/screenshots.html`, which mirrors the
portal with an invented space, invented members and invented bookings, so no
member data appears in a public listing. Order them:

1. `filters-menu.png` — the Resources menu open over the portal, showing types
   and groups. This is the feature that sells the extension.
2. `overview.png` — the pinned overview with My bookings and resource cards.
3. `overview-events.png` — the same view with the space's events merged in.

Regenerate with `python3 -m http.server 8765` and the capture steps in
`tests/screenshots.html` if the UI changes; outdated screenshots are a
rejection reason.

## Permissions Justification

<!-- One justification field for the whole manifest, capped at 1,000 characters,
     and it renders plain text: a markdown table pastes as pipes, a fenced block
     as backticks. Paste the block below verbatim. -->

**Permissions justification** — 674 of 1,000 characters

```
storage: keeps pins, the four popup toggles, a cached resource list and the portal session on their device. Local only; nothing synced or sent.
https://motionlabberlin.spaces.nexudus.com/*: reads the resource list and booking JSON for the portal the member is signed in to, to build the Resources menu and the overview cards. JSON only, no HTML.
https://api.luma.com/*: reads the space's public upcoming events for the overview. No account, no user data, no writes.
content script on members.motionlab.berlin: the only site the extension runs on.
web_accessible_resources https://members.motionlab.berlin/*: the page script and overview page must load into that portal page.
```

<!-- Keep every permission to its own sentence when editing — the reviewer
     checks them against the manifest one by one — but stay under 1,000. -->

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
| Web history | No | No | No history API is used. The extension runs on one portal and reads nothing else. | No |
| User activity | Yes | To the member's own portal only | The member's own bookings are read to fill the My bookings card. Not stored, not transmitted anywhere else. | No |
| Website content | Yes | No | The portal's own navigation labels and URL are read to build the Resources menu and keep the calendar view. Stays on the device. | No |

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
| 1.0.2 | 2026-11-06 | First store submission. Narrow permissions: `storage` plus the one portal and the space's events API; the "add another portal" field is gone. | Draft |
| 1.0.1 | 2026-11-06 | GitHub release only. Expand chevron on workshop and event rows no longer wraps onto its own line. | Not submitted |
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
This extension only does anything on the MotionLab.Berlin members portal
(members.motionlab.berlin), which needs a signed-in member account. Test
credentials are at the end of this field.

After signing in, open https://members.motionlab.berlin/motionlabberlin/bookings/machines/calendar

1. Click "Resources" in the top navigation (or the Resources button in the bottom
   bar on a narrow window). The menu lists every resource type and group.
2. Press the pin icon next to any resource. It appears in the strip at the top
   of the page, below the navigation.
3. Click the pinned resource in that strip: the calendar shows only that
   resource, and the strip ends with "Show all" for its group.
4. Press Alt+O (Option+O on macOS) to open the pinned resources overview. It
   shows the My bookings card and one card per pinned resource. The toolbar
   popup's "Overview" link opens the same page in a new tab.
5. The toolbar popup has four toggles: calendar as default view, the Resources
   menu, Luma events and the location prompt block.

The extension runs on this portal only: the manifest names it in
content_scripts.matches and asks for host access to just that site and to the
space's own booking API subdomain.
```

### Known Issues / Limitations

- **Needs a signed-in account.** A reviewer who is not given credentials sees
  the portal's login page and nothing else. Without a test account in the
  dashboard's notes field, expect a "does not appear to function" rejection.
- **One portal per build.** 1.0.2 dropped the popup's "add another portal"
  field so the manifest could stop asking for `scripting`, an optional
  `https://*/*` and a wildcard `https://*.spaces.nexudus.com/*`. A reviewer who
  tries the extension on another Nexudus space will see it do nothing, by
  design; the listing says so. The feature is preserved on the `runtime-portals`
  branch.
- **Luma events are tied to one calendar.** `config.luma.source` is
  MotionLab.Berlin's public Luma calendar, so the overview hides its *Show
  events* checkbox on any other origin.
- **"Nexudus" in the description.** The name avoids the trademark, and the
  description uses the platform name only to say what the extension works with.
  Do not put it in the extension name.
- **`chrome.storage.local`, never `.sync`.** Nothing is uploaded to Google, so
  the disclosure says "on the device".

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| | | | |

## Pre-Submission Checklist

- [x] `manifest_version: 3`
- [x] Version bumped to 1.0.2 and `package.json`, `src/manifest.json` and
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
- [ ] ZIP uploaded from the `v1.0.2` GitHub release (not a local `dist/` build)

<!-- Release asset: https://github.com/tiktuk/members-portal-you-had-one-job/releases/download/v1.0.2/members-portal-you-had-one-job.zip
     sha256 ae0adf346f03dd2ac3b80a69f2120c800590e5e686f95d084315ac8c1a6f7c1d (51,525 bytes, 23 files) -->
