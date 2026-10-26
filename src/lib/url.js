/**
 * URL helpers shared by the content script (isolated world) and page.js (page
 * world). Also loaded directly by the unit tests, so it must not touch `chrome`.
 */
(() => {
  "use strict";

  const BOOKING_VIEWS = ["list", "calendar", "floorplan", "map"];
  const BOOKING_PATH_RE = /^\/([^/]+)\/bookings\/([^/]+)\/(list|calendar|floorplan|map)\/?$/;
  const ALLOW_LIST_KEY = "nxplus:allow-list";

  function parseBookingPath(pathname) {
    const match = BOOKING_PATH_RE.exec(pathname || "");
    if (!match) return null;
    return { webAddress: match[1], type: match[2], view: match[3] };
  }

  /** Returns the same path with a different view, or null if it is not a bookings path. */
  function pathWithView(pathname, view) {
    const info = parseBookingPath(pathname);
    if (!info || !BOOKING_VIEWS.includes(view) || info.view === view) return null;
    return `/${info.webAddress}/bookings/${info.type}/${view}`;
  }

  /**
   * Rewrites a (possibly relative) bookings URL to the calendar view.
   * Returns a relative path + query + hash, or null when nothing should change.
   */
  function toCalendarUrl(href, base) {
    if (!href) return null;
    let url;
    try {
      url = new URL(String(href), base || location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    const nextPath = pathWithView(url.pathname, "calendar");
    if (!nextPath) return null;
    return `${nextPath}${url.search}${url.hash}`;
  }

  function webAddressFromLocation(pathname) {
    const info = parseBookingPath(pathname || "");
    if (info) return info.webAddress;
    const first = String(pathname || "").split("/").filter(Boolean)[0];
    return first || null;
  }

  /** Each Nexudus space is served from https://<webAddress>.spaces.nexudus.com. */
  function apiBaseUrl(webAddress) {
    const config = globalThis.NXPlusConfig;
    const template = config?.api?.baseUrlTemplate;
    const address = webAddress || config?.portal?.webAddress;
    if (template && address) return template.replace("{webAddress}", address);
    return config?.api?.fallbackBaseUrl || "https://spaces.nexudus.com";
  }

  function bookingHref({ webAddress, type, view, group, start, end }) {
    const params = new URLSearchParams();
    if (group) params.set("group", group);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const query = params.toString();
    return `/${webAddress}/bookings/${type}/${view}${query ? `?${query}` : ""}`;
  }

  /** start/end currently in the URL, so switching group keeps the time range. */
  function currentRange(search) {
    try {
      const params = new URLSearchParams(search ?? location.search);
      return { start: params.get("start") || "", end: params.get("end") || "" };
    } catch {
      return { start: "", end: "" };
    }
  }

  /**
   * The portal's own "View" dropdown is the only place where choosing "List" is
   * an explicit intent; remember it so we stop forcing the calendar afterwards.
   */
  function isListAllowed() {
    try {
      return sessionStorage.getItem(ALLOW_LIST_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setListAllowed(allowed) {
    try {
      if (allowed) sessionStorage.setItem(ALLOW_LIST_KEY, "1");
      else sessionStorage.removeItem(ALLOW_LIST_KEY);
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function currentGroup(search) {
    try {
      return new URLSearchParams(search ?? location.search).get("group") || "";
    } catch {
      return "";
    }
  }

  globalThis.NXPlusUrl = {
    BOOKING_VIEWS,
    parseBookingPath,
    pathWithView,
    toCalendarUrl,
    webAddressFromLocation,
    apiBaseUrl,
    bookingHref,
    currentRange,
    currentGroup,
    isListAllowed,
    setListAllowed,
  };
})();
