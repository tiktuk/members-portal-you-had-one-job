/**
 * Shared configuration for the Members portal, you had one job extension.
 *
 * Loaded first in both worlds: the isolated content-script world and the page
 * world (see content.js / page.js). Everything here is plain data so it can be
 * shipped as a classic script in both Chrome and Safari.
 */
(() => {
  "use strict";

  const config = {
    portal: {
      /**
       * The built-in portal: the manifest ships a content script for it and the
       * only host permission for a portal, so it needs no prompt. To run on a
       * different space, change this, `webAddress`, the manifest's
       * `content_scripts.matches` and its `host_permissions` entry, then
       * rebuild — every Nexudus space lives on its own domain.
       */
      origin: "https://members.motionlab.berlin",
      /** Fallback when the web address cannot be read from the current URL. */
      webAddress: "motionlabberlin",
      /** Cookie (set by the portal itself) holding the JSON auth session. */
      authCookie: "AUTH_TOKEN",
    },

    api: {
      /**
       * Nexudus serves each space from its own subdomain; the generic host
       * answers 500 for the public endpoints.
       */
      baseUrlTemplate: "https://{webAddress}.spaces.nexudus.com",
      fallbackBaseUrl: "https://spaces.nexudus.com",
      /** Returns { Resources: [...], NetworkResources: [...], ResourceTypes: [...] }. */
      resourcesPath: "/api/public/resources/published/details",
      timeoutMs: 15000,
    },

    /** Which bookings view the extension falls back to. */
    defaultView: "calendar",

    /**
     * The portal asks for the browser location on every page load (it feeds the
     * AI assistant). Safari only remembers a denial for a day, so the prompt
     * comes back each visit. Hiding `navigator.geolocation` makes the portal
     * take its "not supported" branch instead. This is only the default for the
     * popup's "Block location prompt" toggle (`geoBlockPrompt`).
     */
    geo: { blockPrompt: true },

    /**
     * Keyboard shortcut that opens the pinned resources overview from the
     * portal. Modifiers joined with "+" (alt, ctrl, meta, shift) plus one key,
     * e.g. "alt+o". Matched on the physical key, so it survives Option/Alt
     * layouts that type a different character.
     */
    overview: { shortcut: "alt+o" },

    /**
     * The resource statistics screen, opened from the Resources menu (and the
     * `shortcut`). Periods end today; bookings are fetched whole-month at a
     * time and the compact times are cached in `onejob:stats-cache`. `bands`
     * are booked hours per day, matching the colour scale on the resource
     * tiles.
     */
    stats: {
      label: "Resource statistics",
      shortcut: "alt+s",
      defaultPeriod: "12m",
      bands: [0.5, 1.5, 3],
      /** The current month changes; past months change rarely. */
      cacheTtlMs: 15 * 60 * 1000,
      pastCacheTtlMs: 24 * 60 * 60 * 1000,
      /** Parallel month requests; the portal handles a handful at a time. */
      concurrency: 3,
      /** Drop the oldest cached months above this many characters of JSON. */
      maxCacheBytes: 2000000,
    },

    /**
     * The 4 × 28 heatmap above a single-resource calendar: 28 Monday-aligned
     * days as columns and four equal six-hour blocks as rows. `buckets` are
     * top to bottom; `to` may be 24 (midnight). Each cell is coloured by the
     * booked share of its own block.
     */
    dayGrid: {
      /** Default for the popup's "Bookings heatmap" toggle. */
      enabled: true,
      /** Default for the popup's "Luma events in heatmap" toggle. */
      events: true,
      /** Columns: the current week plus one back and three ahead. */
      daysBack: 7,
      daysAhead: 21,
      buckets: [
        { id: "morning", label: "Morning", from: 6, to: 12 },
        { id: "afternoon", label: "Afternoon", from: 12, to: 18 },
        { id: "evening", label: "Evening", from: 18, to: 24 },
        { id: "night", label: "Night", from: 0, to: 6 },
      ],
      /** Booked share of a block: quiet, moderate, busy. */
      bands: [0.1, 0.3, 0.6],
    },

    /**
     * The one-time pinning tour on the first portal visit. `version` is the
     * "seen" marker (`settings.onboardingVersion`): bump it to show the tour
     * again after rewriting it. The tour opens the Resources menu itself, so it
     * cannot run while that menu is switched off.
     */
    onboarding: { enabled: true, version: 1, delayMs: 900 },

    /**
     * Upcoming Luma events merged into the overview cards, mirroring the
     * Django app's `Space.luma_source`. A public Luma user (`usr-…`) or
     * calendar (`cal-…`) API ID, or any luma.com URL containing one.
     */
    luma: {
      source: "usr-csfrCNKvDVPwE0L",
      /** Default for the popup's "Luma events in overview" toggle. */
      enabled: true,
      /**
       * The public endpoints luma.com itself uses; they need no API key but
       * are undocumented. Only the background worker calls them, because
       * content scripts are subject to CORS and Luma only allows luma.com.
       */
      apiBaseUrl: "https://api.luma.com",
      pageSize: 50,
      maxPages: 10,
      cacheTtlMs: 5 * 60 * 1000,
      detailCacheTtlMs: 60 * 60 * 1000,
      timeoutMs: 15000,
    },

    nav: {
      enabled: true,
      /** Label of the injected top-level menu item. */
      label: "Resources",
      /** Label of the injected booking-overview item next to it. */
      overviewLabel: "Booking Overview",
      /** Shorter label for the bottom-dock button on narrow windows. */
      overviewShortLabel: "Overview",
      /** Turn "Machines: 3D printing" into "3D printing" in the menu. */
      stripGroupPrefix: true,
      /** Hide types that have no resource groups. */
      hideEmptyTypes: true,
      /**
       * Query parameter that narrows the calendar to one resource. The value is
       * the Nexudus resource id; the portal itself ignores it (see page.js).
       */
      resourceParam: "onejob-resource",
    },

    cache: {
      /** Resource groups change rarely; six hours keeps the menu instant. */
      groupsTtlMs: 6 * 60 * 60 * 1000,
      /** Bump to invalidate cached payloads after changing their shape. */
      groupsVersion: 3,
      /** Shape of the statistics cache; bump when its records change. */
      statsVersion: 1,
    },

    /**
     * Nexudus `SystemResourceType` -> URL slug used by
     * /<webAddress>/bookings/<slug>/<view>. Mirrors the portal's own mapping.
     */
    resourceTypeSlugs: {
      1: "meeting-rooms",
      2: "hot-desks",
      3: "private-offices",
      4: "event-spaces",
      5: "labs",
      6: "kitchens",
      7: "treatment-rooms",
      9: "storage-units",
      10: "machines",
      11: "day-passes",
      12: "phone-booths",
      13: "studios",
      14: "car-parks",
      99: "other-resources",
    },

    /** Used only when the portal's own menu does not expose a label. */
    resourceTypeLabels: {
      1: "Meeting rooms",
      2: "Hot desks",
      3: "Private offices",
      4: "Event spaces",
      5: "Labs",
      6: "Kitchens",
      7: "Treatment rooms",
      9: "Storage units",
      10: "Machines",
      11: "Day passes",
      12: "Phone booths",
      13: "Studios",
      14: "Car parks",
      99: "Other resources",
    },

    /** Preferred column order for the menu; unknown types go last. */
    resourceTypeOrder: [
      "machines",
      "labs",
      "meeting-rooms",
      "event-spaces",
      "hot-desks",
      "private-offices",
      "studios",
      "storage-units",
    ],

    storageKeys: {
      settings: "onejob:settings",
      groups: "onejob:groups",
      /** Pinned resources: [{ id, name, group, type }]. */
      pins: "onejob:pins",
      /**
       * Portal session for the pinned-overview page:
       * { accessToken, webAddress, origin, expiresAt, savedAt }.
       */
      session: "onejob:session",
      /**
       * Cached statistics: { version, webAddress, months: { "YYYY-MM":
       * { fetchedAt, records: [[id, resourceId, start, end], ...] } } }.
       * Booking times only; no member names.
       */
      statsCache: "onejob:stats-cache",
      refreshRequest: "onejob:refresh-request",
      /** Timestamp written by the popup's "Replay the pinning tour" button. */
      tourRequest: "onejob:tour-request",
      /** Mirror of `settings` in the page's localStorage (read synchronously). */
      settingsCache: "onejob:settings-cache",
      /** sessionStorage marker for the pinned resource of the current tab. */
      pinnedSession: "onejob:pinned-resource",
    },
  };

  globalThis.OneJobConfig = config;
})();
