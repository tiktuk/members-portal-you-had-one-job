/* global chrome, OneJobConfig */

/**
 * Which portal origins the extension runs on.
 *
 * The manifest only ships the built-in portal (`config.portal.origin`). Every
 * other Nexudus space lives on its own domain, so the popup asks for the origin
 * with `chrome.permissions.request` and registers the same content script for
 * it through `chrome.scripting`. The background worker reconciles the two on
 * startup, in case the permission was revoked from the extensions page.
 *
 * Loaded by the popup, the background worker and the unit tests, so it must not
 * touch `chrome` at load time.
 */
(() => {
  "use strict";

  const cfg = globalThis.OneJobConfig;

  /** Content script files, in load order. Mirrors manifest.json (see the tests). */
  const CONTENT_SCRIPT_FILES = [
    "lib/config.js",
    "lib/url.js",
    "lib/groups.js",
    "lib/overview.js",
    "lib/overview-view.js",
    "content.js",
  ];
  const CONTENT_SCRIPT_CSS = ["portal.css"];

  const DEFAULT_ORIGIN = cfg?.portal?.origin || "";

  /**
   * Turns whatever the member pastes ("members.space.com", a deep link into the
   * bookings view, ...) into a bare https origin. Returns null for anything
   * that is not a web host.
   */
  function normalizeOrigin(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    // "members.space.com" and "localhost:3000" are hosts, not schemes.
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (!host || (host !== "localhost" && !host.includes("."))) return null;

    return `https://${url.host.toLowerCase()}`;
  }

  function isDefaultOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    return Boolean(normalized) && normalized === DEFAULT_ORIGIN;
  }

  function hostLabel(origin) {
    const normalized = normalizeOrigin(origin);
    return normalized ? new URL(normalized).host : String(origin || "");
  }

  function originPattern(origin) {
    return `${origin}/*`;
  }

  /** `chrome.scripting` ids must be unique and stable for a given origin. */
  function scriptId(origin) {
    let hash = 5381;
    for (let index = 0; index < origin.length; index += 1) {
      hash = ((hash << 5) + hash + origin.charCodeAt(index)) >>> 0;
    }
    return `onejob-portal-${hash.toString(16)}`;
  }

  function scriptFor(origin) {
    return {
      id: scriptId(origin),
      matches: [originPattern(origin)],
      js: [...CONTENT_SCRIPT_FILES],
      css: [...CONTENT_SCRIPT_CSS],
      runAt: "document_start",
      persistAcrossSessions: true,
      allFrames: false,
    };
  }

  /**
   * Chrome answers with promises, Safari's converter hands us callbacks; accept
   * both so the popup and the worker behave the same everywhere.
   */
  function callApi(target, method, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      let result;
      try {
        result = target[method](...args, (value) => {
          const error = chrome?.runtime?.lastError;
          if (error) fail(new Error(error.message || String(error)));
          else done(value);
        });
      } catch (error) {
        fail(error);
        return;
      }

      if (result && typeof result.then === "function") result.then(done, fail);
      else if (result !== undefined) done(result);
    });
  }

  function scriptingAvailable() {
    return Boolean(chrome?.scripting?.registerContentScripts);
  }

  async function hasOriginAccess(origin) {
    if (!chrome?.permissions?.contains) return false;
    try {
      return Boolean(
        await callApi(chrome.permissions, "contains", [{ origins: [originPattern(origin)] }]),
      );
    } catch {
      return false;
    }
  }

  /** Must be called inside a user gesture (a click/submit handler). */
  function requestOriginAccess(origin) {
    if (!chrome?.permissions?.request) return Promise.resolve(false);
    return callApi(chrome.permissions, "request", [{ origins: [originPattern(origin)] }])
      .then(Boolean)
      .catch(() => false);
  }

  function removeOriginAccess(origin) {
    if (!chrome?.permissions?.remove) return Promise.resolve(false);
    return callApi(chrome.permissions, "remove", [{ origins: [originPattern(origin)] }])
      .then(Boolean)
      .catch(() => false);
  }

  async function registerPortalScripts(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized || isDefaultOrigin(normalized) || !scriptingAvailable()) return false;

    await unregisterPortalScripts(normalized);
    try {
      await callApi(chrome.scripting, "registerContentScripts", [[scriptFor(normalized)]]);
      return true;
    } catch {
      return false;
    }
  }

  async function unregisterPortalScripts(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized || !chrome?.scripting?.unregisterContentScripts) return false;
    try {
      await callApi(chrome.scripting, "unregisterContentScripts", [
        { ids: [scriptId(normalized)] },
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Dynamic registrations survive restarts, but the host permission can be
   * revoked on its own; keep the two in step.
   */
  async function syncRegistrations(origins) {
    const results = [];
    // Without the permissions API there is nothing to reconcile against; leave
    // whatever the popup registered alone.
    if (!chrome?.permissions?.contains) return results;

    for (const origin of Array.isArray(origins) ? origins : []) {
      const normalized = normalizeOrigin(origin);
      if (!normalized || isDefaultOrigin(normalized)) continue;

      if (await hasOriginAccess(normalized)) {
        results.push(await registerPortalScripts(normalized));
      } else {
        await unregisterPortalScripts(normalized);
        results.push(false);
      }
    }
    return results;
  }

  globalThis.OneJobPortal = {
    CONTENT_SCRIPT_FILES,
    CONTENT_SCRIPT_CSS,
    DEFAULT_ORIGIN,
    normalizeOrigin,
    isDefaultOrigin,
    hostLabel,
    originPattern,
    scriptId,
    scriptFor,
    scriptingAvailable,
    hasOriginAccess,
    requestOriginAccess,
    removeOriginAccess,
    registerPortalScripts,
    unregisterPortalScripts,
    syncRegistrations,
  };
})();
