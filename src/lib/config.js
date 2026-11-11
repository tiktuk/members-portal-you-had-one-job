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
      /** Default for the popup's "Luma events" toggle. */
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
