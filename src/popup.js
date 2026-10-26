/* global chrome, NXPlusConfig */
(() => {
  "use strict";

  const cfg = NXPlusConfig;
  const DEFAULTS = { calendarDefault: true, navMenu: true };

  const calendarToggle = document.getElementById("calendar-default");
  const navToggle = document.getElementById("nav-menu");
  const refreshButton = document.getElementById("refresh");
  const status = document.getElementById("groups-status");

  init();

  async function init() {
    const settings = { ...DEFAULTS, ...((await get(cfg.storageKeys.settings)) || {}) };
    calendarToggle.checked = settings.calendarDefault !== false;
    navToggle.checked = settings.navMenu !== false;

    calendarToggle.addEventListener("change", () =>
      saveSettings({ calendarDefault: calendarToggle.checked }),
    );
    navToggle.addEventListener("change", () => saveSettings({ navMenu: navToggle.checked }));

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
    });

    renderGroups(await get(cfg.storageKeys.groups));
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
