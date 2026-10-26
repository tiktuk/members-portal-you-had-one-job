/**
 * Runs in the page's own JavaScript world.
 *
 * The portal is a React single-page app: the bookings view lives in the URL
 * (`/<webAddress>/bookings/<type>/<view>`), and navigation goes through
 * history.pushState. Patching those two methods is therefore enough to make
 * the calendar view the default without touching React internals.
 *
 * The content script rewrites the very first URL before the app boots; this
 * file covers client-side navigation (e.g. home -> Bookings -> Machines).
 *
 * It also implements single-resource calendars: when a pinned resource link is
 * opened (`?nxplus-resource=<id>`), the resources payload is narrowed down to
 * that resource and the portal's filters are ignored, so the calendar renders
 * one column instead of every resource of the type.
 */
(() => {
  "use strict";

  const U = globalThis.NXPlusUrl;
  const config = globalThis.NXPlusConfig;
  if (!U || !config) return;

  const RESOURCE_PARAM = U.RESOURCE_PARAM || "nxplus-resource";
  const PINNED_KEY = config.storageKeys?.pinnedSession || "nxplus:pinned-resource";

  const script = document.currentScript;
  let settings = { calendarDefault: true };
  try {
    settings = { ...settings, ...JSON.parse(script?.dataset?.config || "{}") };
  } catch {
    /* keep defaults */
  }

  // The content script sends live updates when the popup toggles a setting.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== "nxplus:settings") return;
    settings = { ...settings, ...data.settings };
  });

  /* ------------------------------------------------------------------ *
   * Geolocation prompt
   * ------------------------------------------------------------------ */

  // The portal wraps the whole app in a provider that calls
  // navigator.geolocation.getCurrentPosition() on mount (it feeds the AI
  // assistant). Safari only keeps a denial for a day, so the dialog shows up
  // again on every visit. Hide the API before the app boots: the provider then
  // takes its "not supported" branch and no permission dialog appears.
  if (config.geo?.blockPrompt !== false) {
    try {
      Object.defineProperty(Navigator.prototype, "geolocation", {
        configurable: true,
        get: () => undefined,
      });
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ *
   * Pinned resource (single-resource calendar)
   * ------------------------------------------------------------------ */

  // Keep a reference to the real implementation: the portal parses its query
  // strings with URLSearchParams, and the override below calls back into this.
  const originalGet = URLSearchParams.prototype.get;

  function readPinned() {
    try {
      const raw = sessionStorage.getItem(PINNED_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writePinned(pin) {
    try {
      sessionStorage.setItem(PINNED_KEY, JSON.stringify(pin));
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function clearPinned() {
    try {
      sessionStorage.removeItem(PINNED_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * Keep the per-tab marker in sync with a URL. The portal drops unknown query
   * parameters when it normalises the bookings URL, so the marker (not the URL)
   * is what keeps the single-resource view alive after boot.
   */
  function syncPinnedFor(url) {
    let next;
    try {
      next = new URL(String(url ?? location.href), location.href);
    } catch {
      return;
    }
    const info = U.parseBookingPath(next.pathname);
    const fromUrl = originalGet.call(new URLSearchParams(next.search), RESOURCE_PARAM) || "";
    const stored = readPinned();

    if (fromUrl) {
      if (!stored || String(stored.id) !== fromUrl) {
        writePinned({ id: fromUrl, type: info?.type || "" });
      }
      return;
    }

    if (stored && stored.id && (!info || (stored.type && info.type !== stored.type))) {
      clearPinned();
    }
  }

  function pinned() {
    syncPinnedFor(location.href);
    const stored = readPinned();
    return stored && stored.id ? stored : null;
  }

  // Pick up the marker from a direct/shared link before the app boots.
  pinned();

  // While a single resource is pinned, the resources payload is already
  // narrowed down; any portal filter left over in the URL (group, capacity,
  // amenities, …) would hide it. Keep only the keys the calendar itself needs.
  const PINNED_QUERY_KEYS = new Set(["start", "end", "view"]);
  URLSearchParams.prototype.get = function (name) {
    if (!PINNED_QUERY_KEYS.has(name) && pinned()) return null;
    return originalGet.call(this, name);
  };

  // The portal fetches /api/public/resources/published/details with axios,
  // which uses XMLHttpRequest. Narrow that response down to the pinned id so
  // FullCalendar receives a single resource.
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__nxplusUrl = String(url || "");
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const pin = pinned();
    const url = this.__nxplusUrl || "";
    if (pin && /\/api\/public\/resources\/published\/details(?:[?#]|$)/.test(url)) {
      this.addEventListener("load", () => {
        try {
          const data = JSON.parse(this.responseText);
          if (!Array.isArray(data?.Resources)) return;
          const filtered = data.Resources.filter((resource) => String(resource.Id) === String(pin.id));
          if (!filtered.length) return;
          data.Resources = filtered;
          const text = JSON.stringify(data);
          Object.defineProperty(this, "responseText", { configurable: true, get: () => text });
          if (this.responseType === "json") {
            Object.defineProperty(this, "response", { configurable: true, get: () => data });
          }
        } catch {
          /* leave the original payload untouched */
        }
      });
    }
    return originalSend.apply(this, arguments);
  };

  /* ------------------------------------------------------------------ *
   * Calendar default + history
   * ------------------------------------------------------------------ */

  function shouldForce() {
    return settings.calendarDefault !== false && !U.isListAllowed();
  }

  // A full navigation resets the portal's React Query cache; without it, the
  // filtered resource payload would survive after leaving the pinned view.
  let leavingPinned = false;

  function patchHistory(method) {
    const original = history[method];
    if (typeof original !== "function") return;
    history[method] = function (state, title, url) {
      let nextUrl = url;
      if (shouldForce() && url != null) {
        const rewritten = U.toCalendarUrl(url, location.href);
        if (rewritten) nextUrl = rewritten;
      }

      if (!leavingPinned) {
        const pin = readPinned();
        if (pin && pin.id) {
          const info = U.parseBookingPath(safePath(nextUrl ?? location.href));
          const leaving = !info || (pin.type && info.type !== pin.type) || info.view !== "calendar";
          if (leaving) {
            leavingPinned = true;
            clearPinned();
            location.assign(nextUrl != null ? String(nextUrl) : location.href);
            return;
          }
        }
      }

      syncPinnedFor(nextUrl ?? location.href);
      return original.call(this, state, title, nextUrl);
    };
  }

  patchHistory("pushState");
  patchHistory("replaceState");

  window.addEventListener("popstate", () => syncPinnedFor(location.href));

  /* ------------------------------------------------------------------ *
   * Pinned calendar: previous / next
   * ------------------------------------------------------------------ */

  // The portal's Previous/Next buttons scroll the resource grid sideways. A
  // pinned calendar has a single resource, so the grid fits and the buttons do
  // nothing; step the date range by the visible number of days instead.
  function calendarStep(button) {
    const container = button.closest(".calendar-container");
    const heading = container?.querySelector("h4");
    const row = heading?.parentElement?.parentElement;
    if (!row) return 0;
    const buttons = [...row.querySelectorAll("button")];
    if (buttons.length !== 2) return 0;
    const index = buttons.indexOf(button);
    return index === 0 ? -1 : index === 1 ? 1 : 0;
  }

  function localIso(date) {
    const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset < 0 ? "-" : "+";
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
      `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
    );
  }

  function stepPinnedRange(days) {
    const params = new URLSearchParams(location.search);
    const from = new Date(params.get("start") || "");
    const to = new Date(params.get("end") || "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
    from.setDate(from.getDate() + days);
    to.setDate(to.getDate() + days);
    params.set("start", localIso(from));
    params.set("end", localIso(to));
    history.pushState(history.state, "", `${location.pathname}?${params.toString()}${location.hash}`);
    // React Router only reacts to history events; pushState alone is invisible.
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    return true;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!button || !pinned()) return;
      const direction = calendarStep(button);
      if (!direction) return;
      const container = button.closest(".calendar-container");
      const days = container.querySelectorAll(".fc-timegrid-col").length || 1;
      if (!stepPinnedRange(direction * days)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  /**
   * Remember an explicit "List" choice in the portal's View dropdown, and clear
   * it again when the user switches back to the calendar.
   */
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link) return;
      const menu = link.closest(".dropdown-menu");
      if (!menu || !isViewDropdown(menu)) return;
      const info = U.parseBookingPath(safePath(link.href));
      if (!info) return;
      U.setListAllowed(info.view === "list");
    },
    true,
  );

  function isViewDropdown(menu) {
    const labelledBy = menu.getAttribute("aria-labelledby");
    const toggle = labelledBy ? document.getElementById(labelledBy) : null;
    if (toggle && toggle.id === "resourceViewDropdown") return true;
    // React Bootstrap sometimes generates ids; fall back to the toggle text.
    return Boolean(toggle && /\bview\b|ansicht|vista|vue/i.test(toggle.textContent || ""));
  }

  function safePath(href) {
    try {
      return new URL(href, location.href).pathname;
    } catch {
      return "";
    }
  }
})();
