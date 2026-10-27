# Nexudus Portal+

A small Safari / Chrome extension that improves the MotionLab.Berlin members
portal (<https://members.motionlab.berlin/motionlabberlin>).

It does four things:

1. **Resource filters in the main menu.** A new **Filters** item next to
   *Bookings* lists every bookable resource type and its resource groups
   (Machines › CNC Machining, Labs › Outdoor Lab, …). One click jumps straight
   to that group instead of *Bookings → Machines → Filters → Group → Close*.
   Below 1200 px the portal swaps the top navigation for its bottom dock, so the
   extension adds a **Filters** button there that opens the same list as a
   bottom sheet.
2. **Pinnable resources.** Expand a group in the **Filters** menu and press the
   pin icon next to a resource (for example *OLSK Large CNC*). Pinned resources
   appear at the top of the menu; clicking one opens the calendar with **only
   that resource**, so there is no horizontal scrolling through every machine of
   the type. A *Pinned* banner above the calendar links back to the full type.
3. **Calendar by default.** Bookings links open the calendar view instead of the
   list view. Picking *List* in the portal's own *View* dropdown still works and
   is remembered for the tab.
4. **No location prompt.** The portal asks for the browser location on every
   page load. Safari only remembers a denial for a day, so the dialog returns
   each visit; the extension hides `navigator.geolocation` from the page, which
   makes the portal skip the request instead of prompting. The popup's *Block
   location prompt* toggle turns this off.

All three toggles live in the toolbar popup; pins are managed from the menu
itself.

```
Bookings ▾   Filters ▾   Store ▾   Memberships   Community
              ┌──────────────────────────────────────────────┐
              │ PINNED                                        │
              │ [ OLSK Large CNC (pin) ] [ E-Lab (pin) ]      │
              │ MACHINES        LABS           MEETING ROOMS │
              │ All machines    All labs       All meeting…  │
              │ 3D printing  ›  E-Lab        › Meeting Rooms │
              │ CNC Machining › Metal Lab    ›               │
              │ Laser Cutting › Outdoor Lab  ›               │
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

Everything tunable lives in `src/lib/config.js`. The popup's toggles are stored
in `chrome.storage.local`; `geo.blockPrompt` below only seeds the *Block
location prompt* toggle.

| Key | Meaning |
| --- | --- |
| `nav.label` | Text of the injected menu item (default `Filters`). |
| `nav.stripGroupPrefix` | Show `3D printing` instead of `Machines: 3D printing`. |
| `nav.hideEmptyTypes` | Hide resource types that have no groups. |
| `defaultView` | View used by the injected links (`calendar`). |
| `geo.blockPrompt` | Default for the popup's *Block location prompt* toggle: hide `navigator.geolocation` so the portal stops asking for the location (`true`). |
| `resourceTypeOrder` | Column order of the menu. |
| `nav.resourceParam` | Query parameter used for single-resource links (`nxplus-resource`). |
| `cache.groupsTtlMs` | How long resource groups are cached (6 h). |
| `portal.origin` / `content_scripts.matches` | Change both to use this on another Nexudus portal. |

The menu is built from the portal's own navigation (which resource types it
offers) plus `GET /api/public/resources/published/details` for the group and
resource names. Pins are stored in `chrome.storage.local` under `nxplus:pins`.

## How it works

The members portal is a React SPA served from `members.motionlab.berlin`; each
space's API lives on its own subdomain, `https://<webAddress>.spaces.nexudus.com`
(the generic `spaces.nexudus.com` host returns 500 for public endpoints).

- Booking routes are `/<webAddress>/bookings/<type>/<view>` where `view` is
  `list`, `calendar`, `floorplan` or `map`. The resource type is a slug such as
  `machines`, `labs` or `meeting-rooms`.
- The list/calendar views filter their resources by query parameters, notably
  `group=<exact GroupName>` and `type=<SystemResourceType>`. There is no
  resource-level query parameter, so the extension implements one itself.
- The SPA stores its session in a readable `AUTH_TOKEN` cookie (JSON with
  `access_token`), which is what lets the extension fetch resource groups
  without a background service worker.

Two scripts do the work:

- `src/content.js` (isolated world) rewrites the initial `list` URL to
  `calendar` **before the app boots**, injects the menu, caches groups and
  resources, and stores pins.
- `src/page.js` (page world) patches `history.pushState`/`replaceState` so
  client-side navigation also lands on the calendar, and remembers an explicit
  *List* choice from the portal's *View* dropdown. It also hides
  `navigator.geolocation` before the app boots (see above).

A pinned link looks like
`/motionlabberlin/bookings/machines/calendar?group=…&nxplus-resource=1415309496`.
The portal ignores the extra parameter, so `page.js` narrows the
`/api/public/resources/published/details` response down to that id before the
calendar renders, and makes the portal's filters no-ops while pinned (only the
calendar's `start`, `end` and `view` query keys survive).
The id is also mirrored into `sessionStorage` because the portal removes unknown
query parameters when it normalises the URL. Leaving the pinned view — a
different type, the portal's *View* dropdown, or any normal calendar/list link
(including the portal's own *Bookings* menu) — clears the marker and triggers a
full navigation, so the portal's cached, filtered resource list is reset.
Reloading a pinned view keeps it.
With a single resource the portal's Previous/Next buttons (which scroll the
resource grid sideways) have nothing to scroll, so `page.js` makes them step the
date range by the visible day count instead.

Because the redirect happens on the URL and only the resources payload is
filtered, no React internals are touched; the portal's own links, filters and
view picker keep working.

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
- **Only one resource is shown** — a pinned resource is active. Use *Show all
  …* in the banner above the calendar, or unpin it in the **Filters** menu.
- **Changes from the popup** apply on the next page load.
- If Nexudus changes the markup, `src/content.js` selectors
  (`nav.navbar ul.navbar-nav`, `#resourceViewDropdown`) and `config.js` are the
  only places to adjust.
