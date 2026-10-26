# Nexudus Portal+

A small Safari / Chrome extension that improves the MotionLab.Berlin members
portal (<https://members.motionlab.berlin/motionlabberlin>).

It does two things:

1. **Resource filters in the main menu.** A new **Filters** item next to
   *Bookings* lists every bookable resource type and its resource groups
   (Machines › CNC Machining, Labs › Outdoor Lab, …). One click jumps straight
   to that group instead of *Bookings → Machines → Filters → Group → Close*.
   Below 1200 px the portal swaps the top navigation for its bottom dock, so the
   extension adds a **Filters** button there that opens the same list as a
   bottom sheet.
2. **Calendar by default.** Bookings links open the calendar view instead of the
   list view. Picking *List* in the portal's own *View* dropdown still works and
   is remembered for the tab.

Both can be toggled from the toolbar popup.

```
Bookings ▾   Filters ▾   Store ▾   Memberships   Community
              ┌──────────────────────────────────────────────┐
              │ MACHINES        LABS           MEETING ROOMS │
              │ All machines    All labs       All meeting…  │
              │ 3D printing     3D printing    Meeting Rooms │
              │ CNC Machining   E-Lab                        │
              │ Laser Cutting   Handtool Lab                 │
              │ …               …                            │
              └──────────────────────────────────────────────┘
```

## Install

### Chrome / Edge / Brave

```bash
npm run build          # produces dist/chrome and dist/nexudus-portal-plus.zip
```

Then open `chrome://extensions`, enable *Developer mode*, choose
**Load unpacked** and select `dist/chrome` (or the `src` folder directly while
developing). Reload the portal tab afterwards.

### Safari

Safari needs a signed app wrapper; Apple's converter generates it:

```bash
npm run build          # also runs safari-web-extension-converter (needs Xcode)
open "dist/safari/Nexudus Portal+/Nexudus Portal+.xcodeproj"
```

In Xcode run the **Nexudus Portal+ (macOS)** scheme once. Then in Safari:
*Settings → Extensions → Nexudus Portal+* → enable it and allow it on
`members.motionlab.berlin`. The iOS project in the same Xcode project works the
same way if you want it on a phone.

## Configuration

Everything tunable lives in `src/lib/config.js`:

| Key | Meaning |
| --- | --- |
| `nav.label` | Text of the injected menu item (default `Filters`). |
| `nav.stripGroupPrefix` | Show `3D printing` instead of `Machines: 3D printing`. |
| `nav.hideEmptyTypes` | Hide resource types that have no groups. |
| `defaultView` | View used by the injected links (`calendar`). |
| `resourceTypeOrder` | Column order of the menu. |
| `cache.groupsTtlMs` | How long resource groups are cached (6 h). |
| `portal.origin` / `content_scripts.matches` | Change both to use this on another Nexudus portal. |

The menu is built from the portal's own navigation (which resource types it
offers) plus `GET /api/public/resources/published/details` for the group names.

## How it works

The members portal is a React SPA served from `members.motionlab.berlin`; each
space's API lives on its own subdomain, `https://<webAddress>.spaces.nexudus.com`
(the generic `spaces.nexudus.com` host returns 500 for public endpoints).

- Booking routes are `/<webAddress>/bookings/<type>/<view>` where `view` is
  `list`, `calendar`, `floorplan` or `map`. The resource type is a slug such as
  `machines`, `labs` or `meeting-rooms`.
- The list/calendar views filter their resources by query parameters, notably
  `group=<exact GroupName>` and `type=<SystemResourceType>`.
- The SPA stores its session in a readable `AUTH_TOKEN` cookie (JSON with
  `access_token`), which is what lets the extension fetch resource groups
  without a background service worker.

Two scripts do the work:

- `src/content.js` (isolated world) rewrites the initial `list` URL to
  `calendar` **before the app boots**, injects the menu, and caches groups.
- `src/page.js` (page world) patches `history.pushState`/`replaceState` so
  client-side navigation also lands on the calendar, and remembers an explicit
  *List* choice from the portal's *View* dropdown.

Because the redirect happens on the URL, no React internals are touched; the
portal's own links, filters and view picker keep working.

## Development

```bash
npm test                       # node --test (URL logic, menu model, manifest)
python3 scripts/make-icons.py  # regenerate icons
npm run build                  # dist/chrome, zip, Safari Xcode project
```

`tests/fixture.html` is a harness that mirrors the portal navigation and stubs
the extension APIs and the resources endpoint, so the menu can be inspected
without signing in:

```bash
python3 -m http.server 8765    # from this folder
open http://localhost:8765/tests/fixture.html
```

### Troubleshooting

- **Menu missing** — sign in to the portal first (the extension needs the
  session cookie to read group names), then reload. Check the popup's status
  line; *Refresh groups* forces a re-fetch.
- **Still on the list view** — the extension remembers an explicit *List* choice
  for the tab; pick *Calendar* in the portal's *View* dropdown to reset it.
- **Changes from the popup** apply on the next page load.
- If Nexudus changes the markup, `src/content.js` selectors
  (`nav.navbar ul.navbar-nav`, `#resourceViewDropdown`) and `config.js` are the
  only places to adjust.
