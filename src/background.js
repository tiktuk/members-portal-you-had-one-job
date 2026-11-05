/* global chrome, OneJobConfig, OneJobLuma, OneJobPortal */

/**
 * Background service worker.
 *
 * Two jobs: proxying Luma's public API, and keeping the content script
 * registrations for portals added from the popup in step with their host
 * permissions.
 *
 * The Luma API is proxied because content scripts are subject to CORS (the
 * portal origin), and api.luma.com only allows https://luma.com, so the
 * overview's in-portal overlay could not fetch it directly. Extension pages and
 * service workers may cross-origin fetch with a host permission.
 *
 * Responses are cached in memory like the Django app's Django-cache entries:
 * five minutes for the event list, one hour for a single event description.
 */
importScripts("lib/config.js", "lib/luma.js", "lib/portal.js");

const cfg = OneJobConfig;
const L = OneJobLuma;
const P = OneJobPortal;

const eventsCache = new Map();
const descriptionsCache = new Map();

// A dynamic content script survives restarts, but its host permission can be
// revoked on its own; reconcile the two whenever the browser starts.
chrome.runtime.onInstalled.addListener(() => syncPortals());
chrome.runtime.onStartup.addListener(() => syncPortals());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return undefined;

  if (message.type === "onejob:luma-events") {
    loadEvents(Boolean(message.force))
      .then((entries) => sendResponse({ ok: true, entries }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message.type === "onejob:luma-description") {
    loadDescription(String(message.eventId || ""))
      .then((description) => sendResponse({ ok: true, description }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  return undefined;
});

async function syncPortals() {
  const stored = await chrome.storage.local.get(cfg.storageKeys.portals);
  return P.syncRegistrations(stored?.[cfg.storageKeys.portals]);
}

async function loadEvents(force) {
  const source = L.parseSource(cfg.luma?.source);
  if (!source) throw new Error("Luma events are not configured for this extension.");

  const cached = eventsCache.get(source.id);
  if (!force && cached && Date.now() - cached.at < ttl(cfg.luma?.cacheTtlMs, 300000)) {
    return cached.entries;
  }

  const entries = [];
  let cursor = null;

  for (let page = 0; page < Number(cfg.luma?.maxPages || 10); page += 1) {
    const payload = await getJson(
      L.listUrl(cfg.luma?.apiBaseUrl, source, {
        limit: cfg.luma?.pageSize,
        cursor,
      }),
    );
    if (!payload || !Array.isArray(payload.entries)) {
      throw new Error("Luma response did not include an entries list.");
    }

    entries.push(...payload.entries.filter((entry) => entry && typeof entry === "object"));
    cursor = payload.next_cursor;
    if (!payload.has_more || !cursor) break;
  }

  eventsCache.set(source.id, { at: Date.now(), entries });
  return entries;
}

async function loadDescription(eventId) {
  if (!/^[A-Za-z0-9_-]+$/.test(eventId)) throw new Error("Invalid Luma event ID.");

  const cached = descriptionsCache.get(eventId);
  if (cached && Date.now() - cached.at < ttl(cfg.luma?.detailCacheTtlMs, 3600000)) {
    return cached.text;
  }

  // Only describe events that belong to the configured source, like the web
  // app's endpoint. The list cache can be empty after a worker restart, in
  // which case the request goes through and is validated by Luma's own API.
  const known = [...eventsCache.values()].some(({ entries }) =>
    entries.some((entry) => entry.event?.api_id === eventId),
  );
  if (eventsCache.size && !known) throw new Error("Unknown Luma event.");

  const payload = await getJson(L.eventUrl(cfg.luma?.apiBaseUrl, eventId));
  const raw = payload?.description_mirror ?? payload?.event?.description;
  const text =
    raw && typeof raw === "object" ? L.flattenDescription(raw) : String(raw || "");
  const normalized = L.normalizeDescription(text);

  descriptionsCache.set(eventId, { at: Date.now(), text: normalized });
  return normalized;
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(cfg.luma?.timeoutMs || 15000),
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      let message = `Luma request failed: HTTP ${response.status}.`;
      if (response.status === 429) {
        message += " Luma is rate limiting requests; try again shortly.";
      } else if (response.status === 404) {
        message += " Check the configured Luma user or calendar ID.";
      }
      throw new Error(message);
    }

    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The Luma request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function ttl(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function errorMessage(error) {
  return (error && error.message) || "Luma request failed.";
}
