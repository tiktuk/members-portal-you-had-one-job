/* global chrome, NXPlusConfig */
(() => {
  "use strict";

  const cfg = NXPlusConfig;
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
