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
 */
(() => {
  "use strict";

  const U = globalThis.NXPlusUrl;
  const config = globalThis.NXPlusConfig;
  if (!U || !config) return;

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

  function shouldForce() {
    return settings.calendarDefault !== false && !U.isListAllowed();
  }

  function patchHistory(method) {
    const original = history[method];
    if (typeof original !== "function") return;
    history[method] = function (state, title, url) {
      let nextUrl = url;
      if (shouldForce() && url != null) {
        const rewritten = U.toCalendarUrl(url, location.href);
        if (rewritten) nextUrl = rewritten;
      }
      return original.call(this, state, title, nextUrl);
    };
  }

  patchHistory("pushState");
  patchHistory("replaceState");

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
