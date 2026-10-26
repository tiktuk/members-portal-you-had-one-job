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
  const DOCK_ID = "nxplus-dock-button";
  const SHEET_ID = "nxplus-sheet";
  const DEFAULT_SETTINGS = { calendarDefault: true, navMenu: true };
  const hasExtensionApis = typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.id);

  const FUNNEL_ICON =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="1em" width="1em" aria-hidden="true"><path d="M3 5h18l-7.5 8.6V20L10.5 18v-4.4L3 5z"></path></svg>';
  const CHEVRON_ICON =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="12" width="12" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path></svg>';

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
      if (event.key !== "Escape") return;
      closeMenu();
      closeSheet();
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
    if (state.settings.navMenu === false || !cfg.nav.enabled) {
      document.getElementById(NAV_ID)?.remove();
      document.getElementById(DOCK_ID)?.remove();
      document.getElementById(SHEET_ID)?.remove();
      return;
    }

    // Desktop: a dropdown in the main navigation bar.
    const list = findNavList();
    if (list) {
      const item = document.getElementById(NAV_ID);
      if (!item || !list.contains(item)) {
        insertNavItem(list, buildNavItem());
        state.signature = "";
      }
    }

    // Mobile/narrow: a button in the bottom dock that opens a sheet.
    const dock = findDock();
    if (dock) ensureDockButton(dock);

    const signature = currentSignature();
    if (signature !== state.signature) {
      state.signature = signature;
      const item = document.getElementById(NAV_ID);
      if (item) fillMenu(item);
      if (isSheetOpen()) fillSheet();
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

  /* ------------------------------------------------------------------ *
   * Mobile dock (narrow viewports use a bottom bar instead of the navbar)
   * ------------------------------------------------------------------ */

  function findDock() {
    return (
      document.querySelector('nav[aria-label="Main navigation"]') ||
      document.querySelector("nav[class*='dockNav']")
    );
  }

  function ensureDockButton(dock) {
    const existing = document.getElementById(DOCK_ID);
    if (existing && dock.contains(existing)) return;

    const buttons = [...dock.querySelectorAll("button")].filter((button) => !button.id.startsWith("nxplus"));
    const reference = buttons[0];
    if (!reference) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = DOCK_ID;
    // Reuse the portal's own dock classes so the button looks native.
    button.className = `${reference.className} nxplus-dock-button`;
    button.setAttribute("aria-label", cfg.nav.label);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");

    const icon = document.createElement("span");
    if (reference.firstElementChild?.className) icon.className = reference.firstElementChild.className;
    icon.innerHTML = FUNNEL_ICON;
    const label = document.createElement("span");
    if (reference.lastElementChild?.className) label.className = reference.lastElementChild.className;
    label.textContent = cfg.nav.label;
    button.append(icon, label);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSheet();
    });

    const more = buttons.find((candidate) => /more|mehr|más|plus/i.test(candidate.getAttribute("aria-label") || ""));
    if (more) more.parentElement.insertBefore(button, more);
    else reference.parentElement.appendChild(button);
  }

  function ensureSheet() {
    const existing = document.getElementById(SHEET_ID);
    if (existing) return existing;

    const root = document.createElement("div");
    root.id = SHEET_ID;
    root.className = "nxplus-sheet-root";
    root.hidden = true;

    const backdrop = document.createElement("div");
    backdrop.className = "nxplus-sheet-backdrop";
    backdrop.addEventListener("click", closeSheet);

    const panel = document.createElement("div");
    panel.className = "nxplus-sheet-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", cfg.nav.label);

    const header = document.createElement("div");
    header.className = "nxplus-sheet-header";
    const title = document.createElement("h2");
    title.className = "nxplus-sheet-title";
    title.textContent = cfg.nav.label;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closeSheet);
    header.append(title, close);

    const body = document.createElement("div");
    body.className = "nxplus-sheet-body";

    panel.append(header, body);
    root.append(backdrop, panel);
    document.body.appendChild(root);
    return root;
  }

  function isSheetOpen() {
    const root = document.getElementById(SHEET_ID);
    return Boolean(root && !root.hidden);
  }

  function toggleSheet() {
    if (isSheetOpen()) closeSheet();
    else openSheet();
  }

  function openSheet() {
    const root = ensureSheet();
    fillSheet();
    root.hidden = false;
    document.getElementById(DOCK_ID)?.setAttribute("aria-expanded", "true");
  }

  function closeSheet() {
    const root = document.getElementById(SHEET_ID);
    if (!root || root.hidden) return;
    root.hidden = true;
    document.getElementById(DOCK_ID)?.setAttribute("aria-expanded", "false");
  }

  function fillSheet() {
    const body = ensureSheet().querySelector(".nxplus-sheet-body");
    if (body) body.replaceChildren(renderMenuContent({ explicitColumns: false }));
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
    button.innerHTML = FUNNEL_ICON;
    button.append(document.createTextNode(cfg.nav.label));
    button.insertAdjacentHTML("beforeend", CHEVRON_ICON);
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
    if (menu) menu.replaceChildren(renderMenuContent({ explicitColumns: true }));
  }

  /**
   * Builds the type/group columns used by both the desktop dropdown and the
   * mobile sheet. `explicitColumns` is only needed for the dropdown, whose
   * width is derived from the content.
   */
  function renderMenuContent({ explicitColumns }) {
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
    if (explicitColumns) {
      // The menu sizes to its content, so the track count has to be explicit.
      columns.style.gridTemplateColumns = `repeat(${Math.min(Math.max(model.length, 1), 4)}, minmax(160px, 1fr))`;
    }

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

    return columns;
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
    link.addEventListener("click", () => {
      closeMenu();
      closeSheet();
    });
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
