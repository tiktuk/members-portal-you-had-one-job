/* global chrome, OneJobConfig, OneJobPortal */
(() => {
  "use strict";

  const cfg = OneJobConfig;
  const P = OneJobPortal;
  const DEFAULTS = {
    calendarDefault: true,
    navMenu: true,
    lumaEvents: cfg.luma?.enabled !== false,
    geoBlockPrompt: cfg.geo?.blockPrompt !== false,
  };

  const calendarToggle = document.getElementById("calendar-default");
  const navToggle = document.getElementById("nav-menu");
  const lumaToggle = document.getElementById("luma-events");
  const geoToggle = document.getElementById("geo-block");
  const refreshButton = document.getElementById("refresh");
  const status = document.getElementById("groups-status");
  const pinsStatus = document.getElementById("pins-status");
  const overviewLink = document.getElementById("overview-link");
  const portalStatus = document.getElementById("portal-status");
  const portalForm = document.getElementById("portal-form");
  const portalInput = document.getElementById("portal-input");
  const portalHint = document.getElementById("portal-hint");
  const portalList = document.getElementById("portal-list");
  const lumaHint = document.getElementById("luma-hint");
  const lumaRow = document.getElementById("luma-row");

  init();

  async function init() {
    const settings = { ...DEFAULTS, ...((await get(cfg.storageKeys.settings)) || {}) };
    calendarToggle.checked = settings.calendarDefault !== false;
    navToggle.checked = settings.navMenu !== false;
    lumaToggle.checked = settings.lumaEvents !== false;
    geoToggle.checked = settings.geoBlockPrompt !== false;

    calendarToggle.addEventListener("change", () =>
      saveSettings({ calendarDefault: calendarToggle.checked }),
    );
    navToggle.addEventListener("change", () => saveSettings({ navMenu: navToggle.checked }));
    lumaToggle.addEventListener("change", () =>
      saveSettings({ lumaEvents: lumaToggle.checked }),
    );
    geoToggle.addEventListener("change", () =>
      saveSettings({ geoBlockPrompt: geoToggle.checked }),
    );

    portalForm.addEventListener("submit", connectPortal);

    overviewLink.addEventListener("click", (event) => {
      if (overviewLink.classList.contains("is-disabled")) {
        event.preventDefault();
        return;
      }
      if (chrome.tabs?.create) {
        event.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL("overview.html") });
      }
    });

    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      refreshButton.textContent = "Refreshing…";
      await set(cfg.storageKeys.refreshRequest, Date.now());
      setTimeout(() => {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh groups";
      }, 2500);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[cfg.storageKeys.groups]) renderGroups(changes[cfg.storageKeys.groups].newValue);
      if (changes[cfg.storageKeys.pins]) renderPins(changes[cfg.storageKeys.pins].newValue);
    });

    renderGroups(await get(cfg.storageKeys.groups));
    renderPins(await get(cfg.storageKeys.pins));
    await renderPortals();
  }

  /* ------------------------------------------------------------------ *
   * Portals
   * ------------------------------------------------------------------ */

  /**
   * Adds the portal the member pastes. The host permission has to be requested
   * from the submit handler itself, before anything is awaited, or the browser
   * no longer counts it as a user gesture.
   */
  async function connectPortal(event) {
    event.preventDefault();

    const origin = P.normalizeOrigin(portalInput.value);
    if (!origin) {
      setPortalHint("Enter a portal address like members.yourspace.com.", true);
      return;
    }
    if (P.isDefaultOrigin(origin)) {
      portalInput.value = "";
      setPortalHint("That portal is built in — just open it and sign in.", false);
      return;
    }

    const granted = await P.requestOriginAccess(origin);
    if (!granted) {
      setPortalHint("Access to that portal was not granted.", true);
      return;
    }

    if (!(await P.registerPortalScripts(origin))) {
      setPortalHint(
        "This browser can’t add portals at runtime. Use a build with the origin in the manifest.",
        true,
      );
      return;
    }

    const portals = await readPortals();
    if (!portals.includes(origin)) await set(cfg.storageKeys.portals, [...portals, origin]);
    portalInput.value = "";
    setPortalHint("Added. Open the portal, sign in, then reload the tab.", false);
    await renderPortals();
  }

  async function disconnectPortal(origin) {
    await P.unregisterPortalScripts(origin);
    await P.removeOriginAccess(origin);

    const portals = (await readPortals()).filter((item) => item !== origin);
    await set(cfg.storageKeys.portals, portals);
    setPortalHint("Removed. Reload that portal tab to drop the extension.", false);
    await renderPortals();
  }

  async function renderPortals() {
    const session = await get(cfg.storageKeys.session);
    const active = P.normalizeOrigin(session?.origin) || cfg.portal.origin;
    portalStatus.textContent = P.hostLabel(active);

    portalList.replaceChildren();
    for (const origin of await readPortals()) {
      if (P.isDefaultOrigin(origin)) continue;

      const item = document.createElement("li");
      item.className = "portal-item";

      const host = document.createElement("span");
      host.className = "portal-item-host";
      host.textContent = P.hostLabel(origin);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "portal-remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${P.hostLabel(origin)}`);
      remove.addEventListener("click", () => disconnectPortal(origin));

      item.append(host, remove);
      portalList.appendChild(item);
    }

    // config.luma.source is the built-in portal's Luma calendar.
    const lumaOn = P.isDefaultOrigin(active);
    lumaToggle.disabled = !lumaOn;
    lumaRow.classList.toggle("is-disabled", !lumaOn);
    lumaHint.textContent = lumaOn
      ? "Merge this space’s upcoming Luma events into the overview cards."
      : "Only configured for the built-in portal.";
  }

  function setPortalHint(text, isError) {
    portalHint.textContent = text;
    portalHint.classList.toggle("is-error", Boolean(isError));
  }

  async function readPortals() {
    const stored = await get(cfg.storageKeys.portals);
    return Array.isArray(stored) ? stored.filter((origin) => typeof origin === "string") : [];
  }

  async function saveSettings(patch) {
    const current = { ...DEFAULTS, ...((await get(cfg.storageKeys.settings)) || {}) };
    await set(cfg.storageKeys.settings, { ...current, ...patch });
  }

  function renderGroups(groups) {
    if (!groups || !groups.groupsBySlug) {
      status.textContent = "No group data yet — open the portal while signed in.";
      return;
    }
    const groupCount = Object.values(groups.groupsBySlug).reduce((sum, list) => sum + list.length, 0);
    const typeCount = Object.keys(groups.groupsBySlug).length;
    const age = formatAge(groups.fetchedAt);
    status.textContent = `${groupCount} groups · ${typeCount} types${age ? ` · ${age}` : ""}`;
  }

  function renderPins(pins) {
    const count = Array.isArray(pins) ? pins.filter((pin) => pin && pin.id).length : 0;
    if (!count) {
      pinsStatus.textContent = "No pinned resources yet — pin one in the portal’s Filters menu.";
      overviewLink.classList.add("is-disabled");
      overviewLink.setAttribute("aria-disabled", "true");
      overviewLink.removeAttribute("href");
      return;
    }
    pinsStatus.textContent = `${count} pinned resource${count === 1 ? "" : "s"}`;
    overviewLink.classList.remove("is-disabled");
    overviewLink.removeAttribute("aria-disabled");
    overviewLink.href = "overview.html";
  }

  function formatAge(timestamp) {
    if (!timestamp) return "";
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  function get(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (result) => resolve(result[key])));
  }

  function set(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  }
})();
