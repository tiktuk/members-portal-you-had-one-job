/**
 * Nexudus, you had one job content script (isolated world).
 *
 * Responsibilities:
 *  1. Rewrite a bookings "list" URL to "calendar" before the SPA boots.
 *  2. Inject page.js into the page world to cover client-side navigation.
 *  3. Add a "Filters" menu to the portal's main navigation that links straight
 *     to each resource type / resource group in the calendar view.
 */
(() => {
  "use strict";

  const cfg = globalThis.OneJobConfig;
  const U = globalThis.OneJobUrl;
  const G = globalThis.OneJobGroups;
  if (!cfg || !U || !G) return;

  const NAV_ID = "onejob-nav-item";
  const MENU_ID = "onejob-menu";
  const DOCK_ID = "onejob-dock-button";
  const SHEET_ID = "onejob-sheet";
  const PINNED_BANNER_ID = "onejob-pinned-banner";
  const PINNED_BANNER_WRAP_ID = "onejob-pinned-banner-wrap";
  const DEFAULT_SETTINGS = {
    calendarDefault: true,
    navMenu: true,
    geoBlockPrompt: cfg.geo?.blockPrompt !== false,
  };
  const hasExtensionApis = typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.id);

  const FUNNEL_ICON =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="1em" width="1em" aria-hidden="true"><path d="M3 5h18l-7.5 8.6V20L10.5 18v-4.4L3 5z"></path></svg>';
  const CHEVRON_ICON =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="12" width="12" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path></svg>';
  const PIN_ICON =
    '<svg viewBox="0 0 24 24" height="14" width="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';
  const PIN_FILLED_ICON =
    '<svg viewBox="0 0 24 24" height="14" width="14" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';

  const state = {
    settings: readCachedSettings(),
    groups: null,
    groupsVersion: 0,
    pins: [],
    expandedGroups: new Set(),
    signature: "",
    ensureTimer: 0,
  };

  let overviewOverlay = null;

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
      // The page script boots from the (possibly older) cached settings; hand it
      // the stored ones before the portal's bundle runs.
      notifyPage(state.settings);
      chrome.storage.onChanged.addListener(onStorageChanged);
    }
    state.pins = await loadPins();
    rememberSession();

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
    if (document.querySelector("script[data-onejob-page]")) return;

    const scripts = [
      { file: "lib/config.js" },
      { file: "lib/url.js" },
      { file: "page.js", config: settings },
    ];

    for (const { file, config } of scripts) {
      const element = document.createElement("script");
      element.src = chrome.runtime.getURL(file);
      element.async = false;
      element.dataset.onejobPage = "1";
      if (config) element.dataset.config = JSON.stringify(config);
      root.appendChild(element);
    }
  }

  function notifyPage(settings) {
    try {
      window.postMessage({ type: "onejob:settings", settings }, location.origin);
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
      if (event.key === "Escape") {
        closeMenu();
        closeSheet();
        return;
      }
      if (!isEditableTarget(event.target) && matchesShortcut(event)) {
        event.preventDefault();
        closeMenu();
        closeSheet();
        openOverviewOverlay();
      }
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
    return [
      location.pathname,
      location.search,
      state.groupsVersion,
      state.settings.navMenu,
      state.pins.map((pin) => pin.id).join(","),
      currentPinnedId(),
    ].join("|");
  }

  function ensureNav() {
    ensurePinnedBanner();

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

    const buttons = [...dock.querySelectorAll("button")].filter((button) => !button.id.startsWith("onejob"));
    const reference = buttons[0];
    if (!reference) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = DOCK_ID;
    // Reuse the portal's own dock classes so the button looks native.
    button.className = `${reference.className} onejob-dock-button`;
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
    root.className = "onejob-sheet-root";
    root.hidden = true;

    const backdrop = document.createElement("div");
    backdrop.className = "onejob-sheet-backdrop";
    backdrop.addEventListener("click", closeSheet);

    const panel = document.createElement("div");
    panel.className = "onejob-sheet-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", cfg.nav.label);

    const header = document.createElement("div");
    header.className = "onejob-sheet-header";
    const title = document.createElement("h2");
    title.className = "onejob-sheet-title";
    title.textContent = cfg.nav.label;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closeSheet);
    header.append(title, close);

    const body = document.createElement("div");
    body.className = "onejob-sheet-body";

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
    const body = ensureSheet().querySelector(".onejob-sheet-body");
    if (body) body.replaceChildren(renderMenuContent({ explicitColumns: false }));
  }

  function buildNavItem() {
    const item = document.createElement("li");
    item.className = "nav-item dropdown onejob-nav-item";
    item.id = NAV_ID;

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "cursor-pointer nav-link arrow-none d-flex align-items-center gap-1 dropdown-toggle onejob-toggle";
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
    menu.className = "dropdown-menu onejob-menu";
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
    const button = item.querySelector(".onejob-toggle");
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
    item.querySelector(".onejob-toggle")?.setAttribute("aria-expanded", "false");
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
   * Builds the pinned resources plus the type/group columns used by both the
   * desktop dropdown and the mobile sheet. `explicitColumns` is only needed for
   * the dropdown, whose width is derived from the content.
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
    const pinnedId = currentPinnedId();

    const content = document.createElement("div");
    content.className = "onejob-menu-content";

    const overview = renderOverviewLink();
    if (overview) {
      const row = document.createElement("div");
      row.className = "onejob-overview-row";
      row.appendChild(overview);
      content.appendChild(row);
    }

    const pinned = renderPinnedSection({ webAddress, view, start, end, current, pinnedId });
    if (pinned) content.appendChild(pinned);

    const columns = document.createElement("div");
    columns.className = "onejob-columns";
    if (explicitColumns) {
      // The menu sizes to its content, so the track count has to be explicit.
      columns.style.gridTemplateColumns = `repeat(${Math.min(Math.max(model.length, 1), 4)}, minmax(160px, 1fr))`;
    }

    for (const type of model) {
      const section = document.createElement("div");
      section.className = "onejob-section";

      const title = document.createElement("div");
      title.className = "onejob-section-title";
      title.textContent = type.label;
      section.appendChild(title);

      section.appendChild(
        menuLink({
          label: `All ${type.label.toLowerCase()}`,
          href: U.bookingHref({ webAddress, type: type.slug, view, start, end }),
          active: current?.type === type.slug && !currentGroup && !pinnedId,
          onActivate: clearPinnedResource,
        }),
      );

      for (const group of type.groups) {
        const key = groupKey(type.slug, group.name);
        const resources = resourcesForGroup(type.slug, group.name);
        const expanded = state.expandedGroups.has(key);

        const row = document.createElement("div");
        row.className = "onejob-group-row";
        row.appendChild(
          menuLink({
            label: group.label,
            title: group.name,
            href: U.bookingHref({ webAddress, type: type.slug, view, group: group.name, start, end }),
            active: current?.type === type.slug && currentGroup === group.name && !pinnedId,
            onActivate: clearPinnedResource,
          }),
        );

        if (resources.length) {
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "onejob-group-toggle";
          toggle.title = expanded ? "Hide resources" : "Show resources";
          toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} ${group.label} resources`);
          toggle.setAttribute("aria-expanded", String(expanded));
          toggle.innerHTML = CHEVRON_ICON;
          toggle.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleGroup(key);
          });
          row.appendChild(toggle);
        }
        section.appendChild(row);

        if (resources.length) {
          const resourceList = document.createElement("div");
          resourceList.className = "onejob-resource-list";
          resourceList.hidden = !expanded;

          for (const resource of resources) {
            const resourceRow = document.createElement("div");
            resourceRow.className = "onejob-resource-row";
            resourceRow.appendChild(
              menuLink({
                label: resource.name || `Resource ${resource.id}`,
                title: resource.name || resource.id,
                href: U.bookingHref({
                  webAddress,
                  type: type.slug,
                  view,
                  group: group.name,
                  resource: resource.id,
                  start,
                  end,
                }),
                active: pinnedId === resource.id,
                onActivate: () => rememberPinnedResource({ ...resource, type: type.slug }),
              }),
            );
            resourceRow.appendChild(pinButton({ ...resource, type: type.slug }));
            resourceList.appendChild(resourceRow);
          }
          section.appendChild(resourceList);
        }
      }

      columns.appendChild(section);
    }

    if (!model.length) {
      const empty = document.createElement("div");
      empty.className = "onejob-empty";
      empty.textContent = hasGroups
        ? "No bookable resource groups found."
        : "Resource groups are loading. Open this menu again in a moment.";
      columns.appendChild(empty);
    }

    content.appendChild(columns);
    return content;
  }

  /**
   * The pinned resources overview also opens from the popup as a standalone
   * page, so the link is always shown — the overview lists personal bookings
   * even without pins.
   */
  function renderOverviewLink() {
    if (!hasExtensionApis) return null;

    const overview = document.createElement("a");
    overview.className = "onejob-overview-link";
    overview.href = "#";
    overview.textContent = "Overview →";
    overview.title = `Open the pinned resources overview (${shortcutLabel()})`;
    overview.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      closeSheet();
      openOverviewOverlay();
    });
    return overview;
  }

  /* ------------------------------------------------------------------ *
   * Keyboard shortcut
   * ------------------------------------------------------------------ */

  const OVERVIEW_SHORTCUT = parseShortcut(cfg.overview?.shortcut || "alt+o");

  function parseShortcut(value) {
    const parts = String(value)
      .toLowerCase()
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    const key = parts.pop() || "";

    return {
      key,
      code: /^[a-z]$/.test(key)
        ? `Key${key.toUpperCase()}`
        : /^[0-9]$/.test(key)
          ? `Digit${key}`
          : "",
      alt: parts.includes("alt"),
      ctrl: parts.includes("ctrl") || parts.includes("control"),
      meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("command"),
      shift: parts.includes("shift"),
    };
  }

  /** Physical key match: Option+O types "ø" on macOS, but the code stays KeyO. */
  function matchesShortcut(event) {
    const combo = OVERVIEW_SHORTCUT;
    if (!combo.key || event.repeat) return false;
    if (event.altKey !== combo.alt || event.ctrlKey !== combo.ctrl) return false;
    if (event.metaKey !== combo.meta || event.shiftKey !== combo.shift) return false;
    return combo.code ? event.code === combo.code : event.key.toLowerCase() === combo.key;
  }

  function shortcutLabel() {
    const combo = OVERVIEW_SHORTCUT;
    const parts = [];
    if (combo.ctrl) parts.push("Ctrl");
    if (combo.meta) parts.push("Cmd");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");
    parts.push(combo.key.toUpperCase());
    return parts.join("+");
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    );
  }

  /* ------------------------------------------------------------------ *
   * Pinned overview overlay
   * ------------------------------------------------------------------ */

  let overviewStyles = null;
  let overviewOpening = false;

  /** Cached once per page: injected as <style> so the panel never flashes. */
  function loadOverviewStyles() {
    if (!overviewStyles) {
      overviewStyles = fetch(chrome.runtime.getURL("overview.css"))
        .then((response) => (response.ok ? response.text() : ""))
        .catch(() => "");
    }
    return overviewStyles;
  }

  async function openOverviewOverlay() {
    if (overviewOverlay || overviewOpening || !hasExtensionApis) return;
    overviewOpening = true;

    try {
      const css = await loadOverviewStyles();

      const overlay = document.createElement("div");
      overlay.className = "onejob-overview-overlay";

      const backdrop = document.createElement("div");
      backdrop.className = "onejob-overview-backdrop";
      backdrop.addEventListener("click", closeOverviewOverlay);

      const panel = document.createElement("div");
      panel.className = "onejob-overview-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "Pinned resources overview");

      const host = document.createElement("div");
      host.className = "onejob-overview-host";

      // The overview markup and stylesheet are shared with overview.html; the
      // shadow root keeps its generic class names out of the portal.
      const shadow = host.attachShadow({ mode: "open" });
      const styles = document.createElement("style");
      styles.textContent = css;
      const root = document.createElement("div");
      shadow.append(styles, root);

      panel.appendChild(host);
      overlay.append(backdrop, panel);

      const previousFocus = document.activeElement;
      const previousOverflow = document.documentElement.style.overflow;

      document.documentElement.style.overflow = "hidden";
      document.addEventListener("keydown", onOverviewKeydown, true);
      document.body.appendChild(overlay);

      overviewOverlay = {
        overlay,
        previousFocus,
        previousOverflow,
        view: OneJobOverviewView.mount(root, {
          variant: "panel",
          onClose: closeOverviewOverlay,
        }),
      };
    } finally {
      overviewOpening = false;
    }
  }

  function closeOverviewOverlay() {
    if (!overviewOverlay) return;
    const { overlay, previousFocus, previousOverflow, view } = overviewOverlay;
    overviewOverlay = null;

    document.removeEventListener("keydown", onOverviewKeydown, true);
    document.documentElement.style.overflow = previousOverflow;
    view.destroy();
    overlay.remove();

    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  }

  function onOverviewKeydown(event) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeOverviewOverlay();
  }

  function renderPinnedSection({ webAddress, view, start, end, current, pinnedId }) {
    const pins = state.pins.filter((pin) => pin && pin.id);
    if (!pins.length) return null;

    const section = document.createElement("div");
    section.className = "onejob-pinned";

    const head = document.createElement("div");
    head.className = "onejob-pinned-head";

    const title = document.createElement("div");
    title.className = "onejob-section-title onejob-pinned-title";
    title.textContent = "Pinned";
    head.appendChild(title);

    section.appendChild(head);

    for (const pin of pins) {
      const resource = findResource(pin.id);
      const type = pin.type || resource?.type || current?.type || "all";
      const group = pin.group || resource?.group || "";
      const name = pin.name || resource?.name || `Resource ${pin.id}`;

      const item = document.createElement("div");
      item.className = "onejob-pinned-item";
      item.appendChild(
        menuLink({
          label: name,
          title: name,
          href: U.bookingHref({ webAddress, type, view, group, resource: pin.id, start, end }),
          active: pinnedId === pin.id,
          onActivate: () => rememberPinnedResource({ id: pin.id, name, group, type }),
        }),
      );

      const unpin = document.createElement("button");
      unpin.type = "button";
      unpin.className = "onejob-pin-button is-pinned";
      unpin.title = "Unpin resource";
      unpin.setAttribute("aria-label", `Unpin ${name}`);
      unpin.setAttribute("aria-pressed", "true");
      unpin.innerHTML = PIN_FILLED_ICON;
      unpin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePin({ id: pin.id, name, group, type });
      });
      item.appendChild(unpin);

      section.appendChild(item);
    }
    return section;
  }

  function resourcesForGroup(slug, groupName) {
    return (state.groups?.resources || [])
      .filter((resource) => resource.type === slug && resource.group === groupName)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  function findResource(id) {
    const value = String(id);
    return (state.groups?.resources || []).find((resource) => resource.id === value) || null;
  }

  function groupKey(slug, name) {
    return `${slug}|${name}`;
  }

  function toggleGroup(key) {
    if (state.expandedGroups.has(key)) state.expandedGroups.delete(key);
    else state.expandedGroups.add(key);
    const item = document.getElementById(NAV_ID);
    if (item) fillMenu(item);
    if (isSheetOpen()) fillSheet();
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

  function menuLink({ label, href, active, title, onActivate }) {
    const link = document.createElement("a");
    link.className = `onejob-link${active ? " is-active" : ""}`;
    link.href = href;
    link.appendChild(document.createTextNode(label));
    link.setAttribute("role", "menuitem");
    if (title) link.title = title;
    link.addEventListener("click", () => {
      if (onActivate) onActivate();
      closeMenu();
      closeSheet();
    });
    return link;
  }

  function pinButton(resource) {
    const pinned = state.pins.some((pin) => pin.id === resource.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `onejob-pin-button${pinned ? " is-pinned" : ""}`;
    button.title = pinned ? "Unpin resource" : "Pin resource";
    button.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${resource.name || resource.id}`);
    button.setAttribute("aria-pressed", String(pinned));
    button.innerHTML = pinned ? PIN_FILLED_ICON : PIN_ICON;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePin(resource);
    });
    return button;
  }

  async function togglePin(resource) {
    const id = String(resource.id);
    const exists = state.pins.some((pin) => pin.id === id);
    if (exists) {
      state.pins = state.pins.filter((pin) => pin.id !== id);
    } else {
      state.pins = [
        ...state.pins,
        {
          id,
          name: resource.name || "",
          group: resource.group || "",
          type: resource.type || "",
        },
      ];
    }
    await storageSet(cfg.storageKeys.pins, state.pins);
    state.signature = "";
    scheduleEnsure();

    // Unpinning the resource that is currently shown alone should return to
    // its group's calendar instead of leaving a stale single-resource view.
    if (exists && currentPinnedId() === id) {
      const href = showAllHref();
      clearPinnedResource();
      if (href) location.assign(href);
    }
  }

  /* ------------------------------------------------------------------ *
   * Pinned resource (per-tab marker + banner)
   * ------------------------------------------------------------------ */

  function readPinnedSession() {
    try {
      const raw = sessionStorage.getItem(cfg.storageKeys.pinnedSession);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function rememberPinnedResource(resource) {
    try {
      sessionStorage.setItem(
        cfg.storageKeys.pinnedSession,
        JSON.stringify({
          id: String(resource.id),
          name: resource.name || "",
          group: resource.group || "",
          type: resource.type || "",
        }),
      );
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function clearPinnedResource() {
    try {
      sessionStorage.removeItem(cfg.storageKeys.pinnedSession);
    } catch {
      /* ignore */
    }
  }

  function currentPinnedId() {
    const fromUrl = U.currentPinnedResource(location.search);
    if (fromUrl) return fromUrl;
    const session = readPinnedSession();
    return session && session.id ? String(session.id) : "";
  }

  /**
   * The pinned resource's group. Keeping it in the "show all" link means the
   * calendar returns to the same category (CNC Machining) instead of starting
   * at the first resource of the whole type (3D printing).
   */
  function pinnedGroup(pin) {
    const resource = pin?.id ? findResource(pin.id) : null;
    return pin?.group || resource?.group || U.currentGroup(location.search);
  }

  function showAllHref() {
    const info = U.parseBookingPath(location.pathname);
    const pin = readPinnedSession();
    const type = info?.type || pin?.type || "all";
    const view = info?.view || cfg.defaultView;
    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const { start, end } = U.currentRange(location.search);
    return U.bookingHref({ webAddress, type, view, group: pinnedGroup(pin), start, end });
  }

  function ensurePinnedBanner() {
    const existing = document.getElementById(PINNED_BANNER_ID);
    const info = U.parseBookingPath(location.pathname);
    const pinnedId = currentPinnedId();
    if (!info || !pinnedId) {
      document.getElementById(PINNED_BANNER_WRAP_ID)?.remove();
      existing?.remove();
      return;
    }

    const main = document.querySelector("main");
    if (!main) return;

    let banner = existing;
    let wrap = document.getElementById(PINNED_BANNER_WRAP_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = PINNED_BANNER_ID;
      banner.className = "onejob-pinned-banner";
      banner.innerHTML =
        '<span class="onejob-pinned-badge">Pinned</span>' +
        '<span class="onejob-pinned-text">Showing only <strong class="onejob-pinned-name"></strong></span>' +
        '<a class="onejob-pinned-show-all" href="#"></a>';
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = PINNED_BANNER_WRAP_ID;
        wrap.className = "container";
      }
      wrap.appendChild(banner);
    } else if (!wrap) {
      // Upgrading from a banner that was prepended straight to <main>.
      wrap = document.createElement("div");
      wrap.id = PINNED_BANNER_WRAP_ID;
      wrap.className = "container";
      banner.parentElement?.insertBefore(wrap, banner);
      wrap.appendChild(banner);
    }
    // Match the width of the portal's calendar container.
    if (wrap && !main.contains(wrap)) main.prepend(wrap);

    const session = readPinnedSession();
    const resource = findResource(pinnedId);
    const name = session?.name || resource?.name || `Resource ${pinnedId}`;
    const type = info.type || session?.type || resource?.type || "all";
    const group = pinnedGroup(session);
    const href = showAllHref();
    const label = group
      ? `Show all ${G.displayGroupName(group, cfg.nav.stripGroupPrefix)}`
      : `Show all ${G.typeLabel(type).toLowerCase()}`;

    const nameElement = banner.querySelector(".onejob-pinned-name");
    if (nameElement.textContent !== name) nameElement.textContent = name;

    const link = banner.querySelector(".onejob-pinned-show-all");
    if (link.getAttribute("href") !== href) link.href = href;
    if (link.textContent !== label) link.textContent = label;
    link.onclick = () => clearPinnedResource();
  }

  /* ------------------------------------------------------------------ *
   * Resource groups (API + cache)
   * ------------------------------------------------------------------ */

  async function refreshGroups({ force = false } = {}) {
    const stored = await storageGet(cfg.storageKeys.groups);
    // v2 caches only had groups; keep using them while the resource list is
    // fetched so the menu does not go blank after an upgrade.
    const cached =
      stored && (stored.version === cfg.cache.groupsVersion || stored.version === 2) ? stored : null;
    if (cached) {
      state.groups = cached;
      state.groupsVersion += 1;
      scheduleEnsure();
    }

    const isFresh =
      cached &&
      cached.version === cfg.cache.groupsVersion &&
      Date.now() - (cached.fetchedAt || 0) < cfg.cache.groupsTtlMs;
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
        resources: G.resourceListFromPayload(payload),
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

  /**
   * The pinned-overview page runs on the extension origin, where the portal's
   * AUTH_TOKEN cookie is not readable. Mirror the token into storage whenever
   * the content script sees a live session.
   */
  function rememberSession() {
    if (!hasExtensionApis) return;
    const token = readAccessToken();
    if (!token) return;

    let expiresAt = 0;
    const raw = readCookie(cfg.portal.authCookie);
    if (raw) {
      try {
        const session = JSON.parse(decodeURIComponent(raw));
        if (typeof session?.expires_at === "number") expiresAt = session.expires_at;
      } catch {
        /* ignore */
      }
    }

    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    storageSet(cfg.storageKeys.session, {
      accessToken: token,
      webAddress,
      /** Which portal this came from, so the overview links back to it. */
      origin: location.origin,
      expiresAt,
      savedAt: Date.now(),
    });
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

  async function loadPins() {
    const stored = hasExtensionApis ? await storageGet(cfg.storageKeys.pins) : readLocalPins();
    return normalizePins(stored);
  }

  function readLocalPins() {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKeys.pins) || "[]");
    } catch {
      return [];
    }
  }

  function normalizePins(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((pin) => (typeof pin === "string" ? { id: pin } : pin))
      .filter((pin) => pin && pin.id)
      .map((pin) => ({
        id: String(pin.id),
        name: String(pin.name || ""),
        group: String(pin.group || ""),
        type: String(pin.type || ""),
      }));
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

    if (changes[cfg.storageKeys.pins]) {
      state.pins = normalizePins(changes[cfg.storageKeys.pins].newValue);
      state.signature = "";
      scheduleEnsure();
    }

    if (changes[cfg.storageKeys.refreshRequest]) refreshGroups({ force: true });
  }
})();
