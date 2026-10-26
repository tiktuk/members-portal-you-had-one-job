/**
 * Nexudus Portal+ content script (isolated world).
 *
 * Responsibilities:
 *  1. Rewrite a bookings "list" URL to "calendar" before the SPA boots.
 *  2. Inject page.js into the page world to cover client-side navigation.
 *  3. Add a "Filters" menu to the portal's main navigation that links straight
 *     to each resource type / resource group in the calendar view.
 */
(() => {
  "use strict";

  const cfg = globalThis.NXPlusConfig;
  const U = globalThis.NXPlusUrl;
  const G = globalThis.NXPlusGroups;
  if (!cfg || !U || !G) return;

  const NAV_ID = "nxplus-nav-item";
  const MENU_ID = "nxplus-menu";
  const DEFAULT_SETTINGS = { calendarDefault: true, navMenu: true };
  const hasExtensionApis = typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.id);

  const state = {
    settings: readCachedSettings(),
    groups: null,
    groupsVersion: 0,
    signature: "",
    ensureTimer: 0,
  };

  // 1. Must happen synchronously, before the app's own scripts read the URL.
  if (state.settings.calendarDefault !== false && !U.isListAllowed()) {
    const nextPath = U.pathWithView(location.pathname, "calendar");
    if (nextPath) {
      try {
        history.replaceState(history.state, "", `${nextPath}${location.search}${location.hash}`);
      } catch {
        /* ignore */
      }
    }
  }

  // 2. Page-world helper (handles pushState/replaceState afterwards).
  injectPageScript(state.settings);

  // 3.
  start();

  async function start() {
    if (hasExtensionApis) {
      state.settings = await loadSettings();
      writeCachedSettings(state.settings);
      chrome.storage.onChanged.addListener(onStorageChanged);
    }

    observeNav();
    scheduleEnsure();

    if (state.settings.navMenu !== false && cfg.nav.enabled) refreshGroups();
  }

  /* ------------------------------------------------------------------ *
   * Page-world injection
   * ------------------------------------------------------------------ */

  function injectPageScript(settings) {
    if (!hasExtensionApis) return;
    const root = document.head || document.documentElement;
    if (!root) return;
    if (document.querySelector("script[data-nxplus-page]")) return;

    const scripts = [
      { file: "lib/config.js" },
      { file: "lib/url.js" },
      { file: "page.js", config: settings },
    ];

    for (const { file, config } of scripts) {
      const element = document.createElement("script");
      element.src = chrome.runtime.getURL(file);
      element.async = false;
      element.dataset.nxplusPage = "1";
      if (config) element.dataset.config = JSON.stringify(config);
      root.appendChild(element);
    }
  }

  function notifyPage(settings) {
    try {
      window.postMessage({ type: "nxplus:settings", settings }, location.origin);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ *
   * Navigation menu
   * ------------------------------------------------------------------ */

  function observeNav() {
    const observer = new MutationObserver(() => scheduleEnsure());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
    window.addEventListener("popstate", scheduleEnsure);

    // Safety net for SPA route changes that do not mutate the navigation DOM.
    setInterval(() => {
      if (state.signature !== currentSignature()) scheduleEnsure();
    }, 1000);
  }

  function scheduleEnsure() {
    if (state.ensureTimer) return;
    state.ensureTimer = setTimeout(() => {
      state.ensureTimer = 0;
      ensureNav();
    }, 60);
  }

  function currentSignature() {
    return [location.pathname, location.search, state.groupsVersion, state.settings.navMenu].join("|");
  }

  function ensureNav() {
    const list = findNavList();
    if (!list) return;

    let item = document.getElementById(NAV_ID);
    if (state.settings.navMenu === false || !cfg.nav.enabled) {
      if (item) item.remove();
      return;
    }

    if (!item || !list.contains(item)) {
      item = buildNavItem();
      insertNavItem(list, item);
      state.signature = "";
    }

    const signature = currentSignature();
    if (signature !== state.signature) {
      state.signature = signature;
      fillMenu(item);
    }
  }

  function findNavList() {
    return (
      document.querySelector("nav.navbar ul.navbar-nav") ||
      document.querySelector("nav ul.navbar-nav") ||
      document.querySelector("nav ul")
    );
  }

  function findBookingsItem(list) {
    const items = [...list.children].filter((element) => element.tagName === "LI" && element.id !== NAV_ID);
    return (
      items.find((item) => item.querySelector('a[href*="/bookings/"]')) ||
      items.find((item) => /booking|buchung|reserva|prenot|réserv|bokning/i.test(item.textContent || "")) ||
      items[0] ||
      null
    );
  }

  function insertNavItem(list, item) {
    const bookings = findBookingsItem(list);
    if (!bookings) {
      list.prepend(item);
      return;
    }
    if (bookings.nextSibling) list.insertBefore(item, bookings.nextSibling);
    else list.appendChild(item);
  }

  function buildNavItem() {
    const item = document.createElement("li");
    item.className = "nav-item dropdown nxplus-nav-item";
    item.id = NAV_ID;

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "cursor-pointer nav-link arrow-none d-flex align-items-center gap-1 dropdown-toggle nxplus-toggle";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML =
      '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="1em" width="1em" aria-hidden="true"><path d="M3 5h18l-7.5 8.6V20L10.5 18v-4.4L3 5z"></path></svg>';
    button.append(document.createTextNode(cfg.nav.label));
    button.insertAdjacentHTML(
      "beforeend",
      '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="12" width="12" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path></svg>',
    );
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(item);
    });

    const menu = document.createElement("div");
    menu.className = "dropdown-menu nxplus-menu";
    menu.id = MENU_ID;
    menu.setAttribute("role", "menu");
    // Bootstrap positions [data-bs-popper] menus below their toggle.
    menu.setAttribute("data-bs-popper", "static");
    menu.addEventListener("click", (event) => event.stopPropagation());

    item.append(button, menu);
    return item;
  }

  function toggleMenu(item) {
    const menu = item.querySelector(`#${MENU_ID}`);
    const button = item.querySelector(".nxplus-toggle");
    if (!menu || !button) return;
    const open = !menu.classList.contains("show");
    menu.classList.toggle("show", open);
    button.setAttribute("aria-expanded", String(open));
    item.classList.toggle("show", open);
  }

  function closeMenu() {
    const item = document.getElementById(NAV_ID);
    if (!item) return;
    item.querySelector(`#${MENU_ID}`)?.classList.remove("show");
    item.querySelector(".nxplus-toggle")?.setAttribute("aria-expanded", "false");
    item.classList.remove("show");
  }

  function onDocumentClick(event) {
    const item = document.getElementById(NAV_ID);
    if (!item || !item.querySelector(`#${MENU_ID}`)?.classList.contains("show")) return;
    if (item.contains(event.target)) return;
    closeMenu();
  }

  function fillMenu(item) {
    const menu = item.querySelector(`#${MENU_ID}`);
    if (!menu) return;

    const list = findNavList();
    const types = list ? readNavTypes(list) : [];
    const groupsBySlug = state.groups?.groupsBySlug || {};
    const hasGroups = Boolean(state.groups);
    const model = G.buildMenuModel(groupsBySlug, types, {
      stripPrefix: cfg.nav.stripGroupPrefix,
      hideEmptyTypes: hasGroups && cfg.nav.hideEmptyTypes,
    });

    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const view = cfg.defaultView;
    const { start, end } = U.currentRange(location.search);
    const current = U.parseBookingPath(location.pathname);
    const currentGroup = U.currentGroup(location.search);

    const columns = document.createElement("div");
    columns.className = "nxplus-columns";
    // The menu sizes to its content, so the track count has to be explicit.
    columns.style.gridTemplateColumns = `repeat(${Math.min(Math.max(model.length, 1), 4)}, minmax(160px, 1fr))`;

    for (const type of model) {
      const section = document.createElement("div");
      section.className = "nxplus-section";

      const title = document.createElement("div");
      title.className = "nxplus-section-title";
      title.textContent = type.label;
      section.appendChild(title);

      section.appendChild(
        menuLink({
          label: `All ${type.label.toLowerCase()}`,
          href: U.bookingHref({ webAddress, type: type.slug, view, start, end }),
          active: current?.type === type.slug && !currentGroup,
        }),
      );

      for (const group of type.groups) {
        section.appendChild(
          menuLink({
            label: group.label,
            title: group.name,
            href: U.bookingHref({ webAddress, type: type.slug, view, group: group.name, start, end }),
            active: current?.type === type.slug && currentGroup === group.name,
          }),
        );
      }

      columns.appendChild(section);
    }

    if (!model.length) {
      const empty = document.createElement("div");
      empty.className = "nxplus-empty";
      empty.textContent = hasGroups
        ? "No bookable resource groups found."
        : "Resource groups are loading. Open this menu again in a moment.";
      columns.appendChild(empty);
    }

    menu.replaceChildren(columns);
  }

  function readNavTypes(list) {
    const bookings = findBookingsItem(list);
    if (!bookings) return [];
    const types = [];
    for (const link of bookings.querySelectorAll('a[href*="/bookings/"]')) {
      let path;
      try {
        path = new URL(link.href, location.href).pathname;
      } catch {
        continue;
      }
      const info = U.parseBookingPath(path);
      if (!info || info.type === "all") continue;
      if (types.some((type) => type.slug === info.type)) continue;
      types.push({ slug: info.type, label: (link.textContent || "").trim() || G.typeLabel(info.type) });
    }
    return types;
  }

  function menuLink({ label, href, active, title }) {
    const link = document.createElement("a");
    link.className = `nxplus-link${active ? " is-active" : ""}`;
    link.href = href;
    link.textContent = label;
    link.setAttribute("role", "menuitem");
    if (title) link.title = title;
    link.addEventListener("click", () => closeMenu());
    return link;
  }

  /* ------------------------------------------------------------------ *
   * Resource groups (API + cache)
   * ------------------------------------------------------------------ */

  async function refreshGroups({ force = false } = {}) {
    const stored = await storageGet(cfg.storageKeys.groups);
    const cached = stored && stored.version === cfg.cache.groupsVersion ? stored : null;
    if (cached) {
      state.groups = cached;
      state.groupsVersion += 1;
      scheduleEnsure();
    }

    const isFresh = cached && Date.now() - (cached.fetchedAt || 0) < cfg.cache.groupsTtlMs;
    if (isFresh && !force) return;

    const fresh = await fetchGroups();
    if (!fresh) return;

    state.groups = fresh;
    state.groupsVersion += 1;
    await storageSet(cfg.storageKeys.groups, fresh);
    scheduleEnsure();
  }

  async function fetchGroups() {
    const token = readAccessToken();
    if (!token) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.api.timeoutMs);
    try {
      const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
      const response = await fetch(`${U.apiBaseUrl(webAddress)}${cfg.api.resourcesPath}`, {
        method: "GET",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "x-nx-app-name": "portal",
          "X-Use-Timezone": "true",
        },
        signal: controller.signal,
      });
      if (!response.ok) return null;

      const payload = await response.json();
      return {
        version: cfg.cache.groupsVersion,
        fetchedAt: Date.now(),
        groupsBySlug: G.groupsBySlugFromPayload(payload),
        resourceCount: G.resourcesFromPayload(payload).length,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function readAccessToken() {
    const raw = readCookie(cfg.portal.authCookie);
    if (!raw) return null;
    let session;
    try {
      session = JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
    if (!session || !session.access_token) return null;
    if (typeof session.expires_at === "number" && session.expires_at <= Date.now()) return null;
    return session.access_token;
  }

  function readCookie(name) {
    for (const part of document.cookie.split(";")) {
      const index = part.indexOf("=");
      if (index === -1) continue;
      if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Settings + storage
   * ------------------------------------------------------------------ */

  function readCachedSettings() {
    try {
      const raw = localStorage.getItem(cfg.storageKeys.settingsCache);
      return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function writeCachedSettings(settings) {
    try {
      localStorage.setItem(cfg.storageKeys.settingsCache, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }

  async function loadSettings() {
    const stored = await storageGet(cfg.storageKeys.settings);
    return { ...DEFAULT_SETTINGS, ...(stored || {}) };
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!hasExtensionApis) return resolve(undefined);
      try {
        chrome.storage.local.get([key], (result) => resolve(result ? result[key] : undefined));
      } catch {
        resolve(undefined);
      }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      if (!hasExtensionApis) return resolve();
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  function onStorageChanged(changes, area) {
    if (area && area !== "local") return;

    if (changes[cfg.storageKeys.settings]) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes[cfg.storageKeys.settings].newValue || {}) };
      writeCachedSettings(state.settings);
      notifyPage(state.settings);
      state.signature = "";
      scheduleEnsure();
      if (state.settings.navMenu !== false && !state.groups) refreshGroups();
    }

    if (changes[cfg.storageKeys.refreshRequest]) refreshGroups({ force: true });
  }
})();
