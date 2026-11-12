/**
 * Members portal, you had one job content script (isolated world).
 *
 * Responsibilities:
 *  1. Rewrite a bookings "list" URL to "calendar" before the SPA boots.
 *  2. Inject page.js into the page world to cover client-side navigation.
 *  3. Add a "Resources" menu to the portal's main navigation that links straight
 *     to each resource type / resource group in the calendar view.
 */
(() => {
  "use strict";

  const cfg = globalThis.OneJobConfig;
  const U = globalThis.OneJobUrl;
  const G = globalThis.OneJobGroups;
  const S = globalThis.OneJobStats;
  const O = globalThis.OneJobOverview;
  const T = globalThis.OneJobTour;
  if (!cfg || !U || !G) return;

  const NAV_ID = "onejob-nav-item";
  const MENU_ID = "onejob-menu";
  const DOCK_ID = "onejob-dock-button";
  const SHEET_ID = "onejob-sheet";
  const OVERVIEW_NAV_ID = "onejob-overview-nav-item";
  const OVERVIEW_DOCK_ID = "onejob-overview-dock-button";
  const PINS_BAR_ID = "onejob-pins-bar";
  const PINS_BAR_WRAP_ID = "onejob-pins-bar-wrap";
  const DAY_GRID_ID = "onejob-day-grid";
  const DAY_GRID_WRAP_ID = "onejob-day-grid-wrap";
  const DEFAULT_SETTINGS = {
    calendarDefault: true,
    navMenu: true,
    dayGrid: cfg.dayGrid?.enabled !== false,
    dayGridEvents: cfg.dayGrid?.events !== false,
    geoBlockPrompt: cfg.geo?.blockPrompt !== false,
    /** `cfg.onboarding.version` once the pinning tour has been shown. */
    onboardingVersion: 0,
  };
  const hasExtensionApis = typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.id);

  const FUNNEL_ICON =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="1em" width="1em" aria-hidden="true"><path d="M3 5h18l-7.5 8.6V20L10.5 18v-4.4L3 5z"></path></svg>';
  const CHEVRON_ICON =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="12" width="12" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path></svg>';
  const OVERVIEW_ICON =
    '<svg viewBox="0 0 24 24" height="1em" width="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>';
  const STATS_ICON =
    '<svg viewBox="0 0 24 24" height="14" width="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M2 20h20"></path></svg>';
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
    tour: null,
    tourStarting: false,
    tourPending: false,
    tourRequested: false,
    tourTimer: 0,
    /** The pin made during the tour's pin step; the heatmap step follows it. */
    tourPinId: "",
    /** Fetch state of the single-resource day/time heatmap. */
    dayGrid: {
      key: "",
      status: "idle",
      records: [],
      revision: 0,
      error: false,
      attemptedAt: 0,
      /** Space-wide Luma events, fetched through the background worker. */
      lumaStatus: "idle",
      events: [],
      /** The member's own bookings on the pinned resource. */
      mineKey: "",
      mineStatus: "idle",
      mine: [],
      /** Workshop reservations of the pinned resource (`fullCalendarEvents`). */
      reservedKey: "",
      reservedStatus: "idle",
      reserved: [],
    },
  };

  let activeOverlay = null;

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

    if (hasExtensionApis) state.tourRequested = await consumeTourRequest();
    // A resumed tour only needs the calendar heatmap, so it does not wait for
    // the group list the menu steps need.
    const resuming = Boolean(readTourResume());
    if (resuming) scheduleTour();
    if (state.settings.navMenu !== false && cfg.nav.enabled) await refreshGroups();
    if (!resuming) scheduleTour();
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
      if (!isEditableTarget(event.target)) {
        if (matchesShortcut(event, SHORTCUTS.overview)) {
          event.preventDefault();
          closeMenu();
          closeSheet();
          openOverviewOverlay();
          return;
        }
        if (matchesShortcut(event, SHORTCUTS.stats)) {
          event.preventDefault();
          closeMenu();
          closeSheet();
          openStatsOverlay();
        }
      }
    });
    window.addEventListener("popstate", scheduleEnsure);
    // The pins strip moves between <main> and its parent when the portal's
    // responsive layout switches (personal pages are a flex row from 992px).
    window.addEventListener("resize", scheduleEnsure);

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
    ensurePinsBar();
    ensureDayGrid();
    if (state.tourPending) maybeStartTour();

    const menuEnabled = state.settings.navMenu !== false && cfg.nav.enabled;
    if (menuEnabled) {
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
    } else {
      document.getElementById(NAV_ID)?.remove();
      document.getElementById(DOCK_ID)?.remove();
      document.getElementById(SHEET_ID)?.remove();
    }

    // The overview is its own entry point, so it stays when the menu is off.
    ensureOverviewEntry();

    if (!menuEnabled) return;

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
    // The tour card floats outside the menu but belongs to it.
    if (state.tour && event.target instanceof Element && event.target.closest("#onejob-tour")) return;
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
    const pinnedId = currentPinnedId();

    const content = document.createElement("div");
    content.className = "onejob-menu-content";

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
        const groupHref = U.bookingHref({
          webAddress,
          type: type.slug,
          view,
          group: group.name,
          start,
          end,
        });
        const groupActive = current?.type === type.slug && currentGroup === group.name && !pinnedId;

        const row = document.createElement("div");
        row.className = "onejob-group-row";
        if (resources.length) {
          row.appendChild(groupToggle({ group, key, expanded, active: groupActive }));
        } else {
          // A group with no resources cannot expand, so it keeps the link.
          row.appendChild(
            menuLink({
              label: group.label,
              title: group.name,
              href: groupHref,
              active: groupActive,
              onActivate: clearPinnedResource,
            }),
          );
        }
        section.appendChild(row);

        if (resources.length) {
          const resourceList = document.createElement("div");
          resourceList.className = "onejob-resource-list";
          resourceList.hidden = !expanded;

          for (const resource of resources) {
            const resourceRow = document.createElement("div");
            resourceRow.className = "onejob-resource-row";
            resourceRow.dataset.resourceId = String(resource.id);
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

          // The group's own calendar lives here now: the group name opens the
          // list, so this is the only way to that whole group.
          const allRow = document.createElement("div");
          allRow.className = "onejob-resource-row";
          allRow.appendChild(
            menuLink({
              label: "Show all",
              title: `Show all ${group.label}`,
              href: groupHref,
              onActivate: clearPinnedResource,
            }),
          );
          resourceList.appendChild(allRow);

          const statsRow = document.createElement("div");
          statsRow.className = "onejob-resource-row";
          const statsButton = document.createElement("button");
          statsButton.type = "button";
          statsButton.className = "onejob-link onejob-stats-link";
          statsButton.title = `Statistics for ${group.label}`;
          statsButton.setAttribute("aria-label", `Statistics for ${group.label}`);
          statsButton.append(document.createTextNode("Statistics"));
          statsButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            closeSheet();
            openStatsOverlay({
              scope: { type: type.slug, group: group.name, label: group.label },
            });
          });
          statsRow.appendChild(statsButton);
          resourceList.appendChild(statsRow);

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

    // The statistics screen lives at the bottom of the menu.
    const footer = document.createElement("div");
    footer.className = "onejob-menu-footer";

    const stats = document.createElement("button");
    stats.type = "button";
    stats.className = "onejob-menu-stats-button";
    stats.innerHTML = STATS_ICON;
    stats.append(document.createTextNode(cfg.stats?.label || "Resource statistics"));
    stats.title = `Open ${cfg.stats?.label || "resource statistics"} (${shortcutLabel(SHORTCUTS.stats)})`;
    stats.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      closeSheet();
      openStatsOverlay();
    });
    footer.appendChild(stats);
    content.appendChild(footer);

    return content;
  }

  /* ------------------------------------------------------------------ *
   * Booking overview entry (its own item, not a row inside the menu)
   * ------------------------------------------------------------------ */

  function ensureOverviewEntry() {
    if (!hasExtensionApis || !cfg.nav.enabled) {
      document.getElementById(OVERVIEW_NAV_ID)?.remove();
      document.getElementById(OVERVIEW_DOCK_ID)?.remove();
      return;
    }

    // Desktop: a plain nav item right after Resources.
    const list = findNavList();
    if (list) {
      let item = document.getElementById(OVERVIEW_NAV_ID);
      if (!item || !list.contains(item)) item = buildOverviewNavItem();
      const resources = document.getElementById(NAV_ID);
      if (resources && list.contains(resources)) {
        // after() is a no-op when the item already follows Resources.
        if (resources.nextElementSibling !== item) resources.after(item);
      } else if (!list.contains(item)) {
        insertNavItem(list, item);
      }
    }

    // Narrow: the portal swaps the navbar for a dock, so it gets a button too.
    const dock = findDock();
    if (dock) ensureOverviewDockButton(dock);
  }

  function buildOverviewNavItem() {
    const item = document.createElement("li");
    item.className = "nav-item onejob-nav-item";
    item.id = OVERVIEW_NAV_ID;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cursor-pointer nav-link onejob-overview-nav";
    button.textContent = cfg.nav.overviewLabel;
    button.title = `Open the booking overview (${shortcutLabel(SHORTCUTS.overview)})`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      closeSheet();
      openOverviewOverlay();
    });

    item.appendChild(button);
    return item;
  }

  function ensureOverviewDockButton(dock) {
    const existing = document.getElementById(OVERVIEW_DOCK_ID);
    if (existing && dock.contains(existing)) {
      const resources = document.getElementById(DOCK_ID);
      if (!resources?.parentElement || resources.nextElementSibling === existing) return;
      resources.after(existing);
      return;
    }

    const buttons = [...dock.querySelectorAll("button")].filter((button) => !button.id.startsWith("onejob"));
    const reference = buttons[0];
    if (!reference) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = OVERVIEW_DOCK_ID;
    // Reuse the portal's own dock classes so the button looks native.
    button.className = `${reference.className} onejob-dock-button`;
    button.setAttribute("aria-label", cfg.nav.overviewLabel);

    const icon = document.createElement("span");
    if (reference.firstElementChild?.className) icon.className = reference.firstElementChild.className;
    icon.innerHTML = OVERVIEW_ICON;
    const label = document.createElement("span");
    if (reference.lastElementChild?.className) label.className = reference.lastElementChild.className;
    label.textContent = cfg.nav.overviewShortLabel;
    button.append(icon, label);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
      openOverviewOverlay();
    });

    const resources = document.getElementById(DOCK_ID);
    if (resources?.parentElement) {
      // after() is a no-op when the button already follows Resources.
      if (resources.nextElementSibling !== button) resources.after(button);
    } else {
      const more = buttons.find((candidate) => /more|mehr|más|plus/i.test(candidate.getAttribute("aria-label") || ""));
      if (more) more.parentElement.insertBefore(button, more);
      else reference.parentElement.appendChild(button);
    }
  }

  /* ------------------------------------------------------------------ *
   * Keyboard shortcut
   * ------------------------------------------------------------------ */

  const SHORTCUTS = {
    overview: parseShortcut(cfg.overview?.shortcut || "alt+o"),
    stats: parseShortcut(cfg.stats?.shortcut || "alt+s"),
  };

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
  function matchesShortcut(event, combo) {
    if (!combo.key || event.repeat) return false;
    if (event.altKey !== combo.alt || event.ctrlKey !== combo.ctrl) return false;
    if (event.metaKey !== combo.meta || event.shiftKey !== combo.shift) return false;
    return combo.code ? event.code === combo.code : event.key.toLowerCase() === combo.key;
  }

  function shortcutLabel(combo) {
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
   * Overlays (pinned overview and resource statistics)
   *
   * Both mount a shared view into a shadow root and use the same shell, so
   * their generic class names cannot collide with the portal's Bootstrap
   * styles. The shell is fixed and full-height; the view scrolls inside it.
   * ------------------------------------------------------------------ */

  const overlayStyles = new Map();
  /** Opens are serialised: the tour can ask for the second screen while the
   *  first one's stylesheet is still loading, and a dropped request would leave
   *  the wrong screen on display. */
  let overlayQueue = Promise.resolve();
  /**
   * Every user-visible close bumps this. An open that was queued, or that was
   * still waiting for its stylesheet, must not resurrect a screen the member or
   * the tour has already dismissed.
   */
  let overlayGeneration = 0;

  /** Cached per file: injected as <style> so the panel never flashes. */
  function loadOverlayStyles(files) {
    return Promise.all(
      files.map((file) => {
        if (!overlayStyles.has(file)) {
          overlayStyles.set(
            file,
            fetch(chrome.runtime.getURL(file))
              .then((response) => (response.ok ? response.text() : ""))
              .catch(() => ""),
          );
        }
        return overlayStyles.get(file);
      }),
    ).then((parts) => parts.join("\n"));
  }

  function openOverlay(options) {
    const generation = overlayGeneration;
    overlayQueue = overlayQueue
      .then(() => (generation === overlayGeneration ? openOverlayNow(options, generation) : null))
      .catch(() => {});
    return overlayQueue;
  }

  async function openOverlayNow({ kind, label, stylesheets, mount, ariaModal = true }, generation) {
    if (!hasExtensionApis) return;
    if (activeOverlay) closeOverlay(false);

    const css = await loadOverlayStyles(stylesheets);
    // Closed (or replaced) while the stylesheet was loading.
    if (generation !== overlayGeneration) return;

    const overlay = document.createElement("div");
    overlay.className = "onejob-overview-overlay";

    const backdrop = document.createElement("div");
    backdrop.className = "onejob-overview-backdrop";
    backdrop.addEventListener("click", () => closeOverlay());

    const panel = document.createElement("div");
    panel.className = "onejob-overview-panel";
    panel.setAttribute("role", "dialog");
    // The tour card lives outside the panel, so AT must still reach it while
    // the tour is driving the overlay.
    panel.setAttribute("aria-modal", ariaModal ? "true" : "false");
    panel.setAttribute("aria-label", label);

    const host = document.createElement("div");
    host.className = "onejob-overview-host";

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
    document.addEventListener("keydown", onOverlayKeydown, true);
    document.body.appendChild(overlay);

    try {
      activeOverlay = {
        kind,
        overlay,
        panel,
        root,
        previousFocus,
        previousOverflow,
        view: mount(root, { variant: "panel", onClose: closeOverlay }),
      };
    } catch (error) {
      document.removeEventListener("keydown", onOverlayKeydown, true);
      document.documentElement.style.overflow = previousOverflow;
      overlay.remove();
      throw error;
    }
  }

  function openOverviewOverlay(options = {}) {
    if (activeOverlay?.kind === "overview") return;
    const fromTour = options.fromTour === true;
    // The overlay covers the page the tour is pointing at; when the tour asked
    // for it, it is the step's subject instead.
    if (!fromTour) state.tour?.end("overview");
    openOverlay({
      kind: "overview",
      label: "Pinned resources overview",
      stylesheets: ["overview.css"],
      ariaModal: !fromTour,
      mount: (root, viewOptions) => OneJobOverviewView.mount(root, viewOptions),
    });
  }

  function openStatsOverlay(options = {}) {
    if (activeOverlay?.kind === "stats" || !globalThis.OneJobStatsView) return;
    const fromTour = options.fromTour === true;
    if (!fromTour) state.tour?.end("statistics");
    const scope = options.scope || null;
    openOverlay({
      kind: "stats",
      label: scope?.label
        ? `${cfg.stats?.label || "Resource statistics"}: ${scope.label}`
        : cfg.stats?.label || "Resource statistics",
      stylesheets: ["overview.css", "stats.css"],
      ariaModal: !fromTour,
      mount: (root, viewOptions) => globalThis.OneJobStatsView.mount(root, { ...viewOptions, scope }),
    });
  }

  function closeOverlay(cancelPending = true) {
    if (cancelPending) overlayGeneration += 1;
    if (!activeOverlay) return;
    const { overlay, previousFocus, previousOverflow, view } = activeOverlay;
    activeOverlay = null;

    document.removeEventListener("keydown", onOverlayKeydown, true);
    document.documentElement.style.overflow = previousOverflow;
    view.destroy();
    overlay.remove();

    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  }

  function onOverlayKeydown(event) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeOverlay();
  }

  /* ------------------------------------------------------------------ *
   * First-run feature tour
   *
   * Pinning is the way in, but the point of the extension is what it opens:
   * the calendar heatmap, the booking overview and the statistics screen. The
   * tour pins one machine, follows it to its calendar (the page change is
   * bridged by a sessionStorage marker), then opens the two overlays and shows
   * the settings that switch all of it on.
   * ------------------------------------------------------------------ */

  /** Where a tour that navigated away resumes, in this tab only. */
  const TOUR_RESUME_KEY = "onejob:tour-resume";
  /** A marker older than this belongs to a visit the member abandoned. */
  const TOUR_RESUME_MS = 30000;

  async function consumeTourRequest() {
    const requested = await storageGet(cfg.storageKeys.tourRequest);
    if (!requested) return false;
    // Consume it, so a replay requested while no portal tab was open runs once.
    await storageSet(cfg.storageKeys.tourRequest, 0);
    return true;
  }

  function scheduleTour() {
    if (!hasExtensionApis || !cfg.onboarding?.enabled || !T) return;
    clearTimeout(state.tourTimer);
    state.tourTimer = setTimeout(() => {
      state.tourTimer = 0;
      maybeStartTour();
    }, Number(cfg.onboarding.delayMs) || 900);
  }

  function writeTourResume(step) {
    try {
      sessionStorage.setItem(
        TOUR_RESUME_KEY,
        JSON.stringify({
          version: Number(cfg.onboarding?.version) || 1,
          step,
          at: Date.now(),
        }),
      );
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function readTourResume() {
    let value = null;
    try {
      value = JSON.parse(sessionStorage.getItem(TOUR_RESUME_KEY) || "null");
    } catch {
      value = null;
    }

    const fresh =
      value &&
      value.step &&
      Number(value.version) === (Number(cfg.onboarding?.version) || 1) &&
      Date.now() - Number(value.at || 0) < TOUR_RESUME_MS;
    if (!fresh) clearTourResume();
    return fresh ? value : null;
  }

  function clearTourResume() {
    try {
      sessionStorage.removeItem(TOUR_RESUME_KEY);
    } catch {
      /* ignore */
    }
  }

  function maybeStartTour() {
    if (!hasExtensionApis || !cfg.onboarding?.enabled || !T) return;
    if (state.tour || state.tourStarting) return;

    const version = Number(cfg.onboarding.version) || 1;
    const seen = Number(state.settings.onboardingVersion || 0) >= version;

    // A resumed tour is this visit continuing after the heatmap step's
    // navigation, so the seen marker is already written and must not stop it.
    const resume = readTourResume();
    const steps = tourSteps(tourGroup());
    const resumeIndex = resume ? steps.findIndex((step) => step.id === resume.step) : -1;
    const resumed = resumeIndex >= 0;
    // A marker for a step this build no longer has is a dead end.
    if (resume && !resumed) clearTourResume();
    if (seen && !state.tourRequested && !resumed) {
      // Nothing is waiting for this page any more.
      state.tourPending = false;
      return;
    }

    if (resumed) {
      // The calendar page has not mounted its heatmap yet; ensureNav retries.
      if (!document.getElementById(DAY_GRID_ID)) {
        state.tourPending = true;
        return;
      }
    } else {
      // The pin step opens the menu, so the tour cannot run without it.
      if (state.settings.navMenu === false || !cfg.nav.enabled) return;
      const nav = document.getElementById(NAV_ID);
      const dock = findDock();
      if (!isVisible(nav) && !isVisible(dock)) {
        // The navigation is not on screen yet; ensureNav retries.
        state.tourPending = true;
        return;
      }
    }

    state.tourPending = false;
    state.tourRequested = false;
    clearTourResume();

    // Someone who already pinned a resource found the feature on their own.
    if (!seen && !resumed && state.pins.length) {
      markTourSeen();
      return;
    }

    state.tourStarting = true;
    markTourSeen();
    state.tourStarting = false;

    state.tour = T.start({
      steps,
      startIndex: resumed ? resumeIndex : 0,
      ignore: [
        `#${NAV_ID}`,
        `#${MENU_ID}`,
        `#${SHEET_ID}`,
        `#${DOCK_ID}`,
        `#${OVERVIEW_NAV_ID}`,
        `#${OVERVIEW_DOCK_ID}`,
        `#${PINS_BAR_ID}`,
        ".onejob-overview-overlay",
      ].join(", "),
      onEnd: () => {
        state.tour = null;
        state.tourPinId = "";
        // The tour relaxed the panel's aria-modal so its card stayed reachable.
        activeOverlay?.panel?.setAttribute("aria-modal", "true");
      },
    });
  }

  /** The first group with resources, in the order the menu shows them. */
  function tourGroup() {
    if (!state.groups?.resources?.length) return null;

    const list = findNavList();
    const model = G.buildMenuModel(state.groups.groupsBySlug || {}, list ? readNavTypes(list) : [], {
      stripPrefix: cfg.nav.stripGroupPrefix,
      hideEmptyTypes: true,
    });

    for (const type of model) {
      for (const group of type.groups) {
        const resources = resourcesForGroup(type.slug, group.name);
        if (resources.length) {
          return {
            key: groupKey(type.slug, group.name),
            name: group.name,
            label: group.label,
            resource: resources[0],
          };
        }
      }
    }
    return null;
  }

  function tourSteps(group) {
    const steps = [
      {
        id: "intro",
        title: "Three screens, one click away",
        body: `Booking Overview, resource statistics and a 28-day heatmap on any machine's calendar. A 30-second tour?`,
        enter: () => {
          closeMenu();
          closeSheet();
        },
        target: () => tourNavTarget(),
        primaryLabel: "Show me",
      },
    ];

    // Pinning is the way in; the heatmap step then opens that machine's
    // calendar. Kept in the list even when a pin exists, so the step count does
    // not change across the page change; the step itself adapts to that pin.
    if (group) steps.push(tourPinStep(group));

    if (state.settings.dayGrid !== false) steps.push(tourHeatmapStep());
    steps.push(tourOverviewStep(), tourSettingsStep(), tourStatsStep());
    return steps;
  }

  /**
   * Pinning is the way in. With nothing pinned the step opens the menu and
   * waits for a pin; with a pin already in place it points at that chip, so a
   * replay never asks the member to pin a second time (and never lands on a
   * pin button that would unpin the machine they already have).
   */
  function tourPinStep(group) {
    const pinned = () => Boolean(tourPin());
    return {
      id: "pin",
      title: () => (pinned() ? "Your pinned machine" : "Pin the machine you book most"),
      body: () =>
        pinned()
          ? `You already have ${tourPin().name || "a machine"} pinned. The tour carries on with its calendar, where the heatmap lives.`
          : "Press the pin icon at the right of a machine's row. The tour carries on with that machine's calendar, where the heatmap lives.",
      enter: () => {
        if (pinned()) {
          closeMenu();
          closeSheet();
          return;
        }
        // Re-open the group if it was collapsed between the steps.
        state.expandedGroups.add(group.key);
        openTourMenu();
      },
      target: () => (pinned() ? tourPinChip() || tourNavTarget() : tourResourcePin(group)),
      // Nothing to see on the calendar until something is pinned.
      blocked: () => !pinned(),
      primaryLabel: () => (pinned() ? "" : "Pin one to continue"),
    };
  }

  /**
   * The heatmap lives on the pinned resource's calendar, so this step either
   * navigates there (and the tour resumes on the next page) or, once the page
   * has it, simply points at the grid.
   */
  function tourHeatmapStep() {
    return {
      id: "heatmap",
      title: "A 4 × 28 heatmap on its calendar",
      body: heatmapBody,
      enter: () => {
        closeMenu();
        closeSheet();
      },
      target: () => document.getElementById(DAY_GRID_ID) || tourPinChip() || tourNavTarget(),
      primaryLabel: () => (dayGridMounted() || !tourPin() ? "" : "Open the calendar"),
      onPrimary: (tour) => {
        const pin = dayGridMounted() ? null : tourPin();
        if (!pin) {
          tour.next();
          return;
        }
        // The marker is what lets the next page pick the tour up again.
        writeTourResume("heatmap");
        rememberPinnedResource(pin);
        location.assign(tourPinHref(pin));
      },
    };
  }

  function heatmapBody() {
    if (dayGridMounted()) {
      return "This is the 28-day heatmap: morning, afternoon, evening and night for last week and the next three. A black dot marks a Luma event, a green bar along the bottom your own booking and an orange bar a workshop reservation; the square's colour is how much of that six-hour block is booked. Click a square to open that day's week.";
    }
    const pin = tourPin();
    if (pin) {
      return `Next stop: ${pin.name || "the pin"}'s calendar, where a 4 × 28 heatmap under the strip shows when it is booked — morning, afternoon, evening and night, last week and the next three.`;
    }
    return "Pin a machine and its calendar gets a 4 × 28 heatmap under the strip: morning, afternoon, evening and night for last week and the next three.";
  }

  function dayGridMounted() {
    return Boolean(document.getElementById(DAY_GRID_ID));
  }

  function tourOverviewStep() {
    return {
      id: "overview",
      title: "Every pin, two weeks ahead",
      body: `One card per pinned machine with its next 14 days of bookings, your own bookings above them and workshops marked Reserved. ${shortcutLabel(SHORTCUTS.overview)} opens it from anywhere.`,
      enter: () => {
        closeMenu();
        closeSheet();
        openOverviewOverlay({ fromTour: true });
      },
      leave: () => closeOverlay(),
      // The overview mounts into a shadow root, so the target has to be read
      // from there; the header is up as soon as the panel is.
      target: () =>
        tourOverlayQuery(".cards .card") ||
        tourOverlayQuery(".my-bookings .card") ||
        tourOverlayQuery(".page-header"),
      missingMs: 4000,
    };
  }

  function tourSettingsStep() {
    return {
      id: "settings",
      title: "Your settings live in the toolbar",
      body: "These are the six switches with their current state. The extension's toolbar icon opens the popup that changes them, and its tour row replays this tour.",
      enter: () => {
        closeMenu();
        closeSheet();
      },
      centered: true,
      render: (container) => renderTourSettings(container),
    };
  }

  function tourStatsStep() {
    return {
      id: "statistics",
      title: "A year of bookings at a glance",
      body: "The busiest days, the weekday and time-of-day patterns, and every resource ranked by booked hours. Switch between 4 weeks, 3 months and 12 months. Each group's list has a Statistics row that scopes this to that group.",
      enter: () => {
        closeMenu();
        closeSheet();
        openStatsOverlay({ fromTour: true });
      },
      // The tour ends on the calendar it started the detour from, so the screen
      // it opened closes again — whether by Got it, Back or Skip.
      leave: () => closeOverlay(),
      target: () => tourOverlayQuery(".stats-heatmap") || tourOverlayQuery(".stats-tiles"),
      missingMs: 10000,
    };
  }

  /** The settings the popup shows, with the state the portal is running with. */
  function renderTourSettings(container) {
    const list = document.createElement("ul");
    list.className = "onejob-tour-settings";

    for (const row of cfg.onboarding?.settings || []) {
      const item = document.createElement("li");
      item.className = "onejob-tour-setting";

      const label = document.createElement("span");
      label.className = "onejob-tour-setting-label";
      label.textContent = row.label;

      const on = state.settings[row.key] !== false;
      const value = document.createElement("span");
      value.className = `onejob-tour-setting-state ${on ? "is-on" : "is-off"}`;
      value.textContent = on ? "On" : "Off";

      item.append(label, value);
      list.appendChild(item);
    }

    container.appendChild(list);
  }

  /** A selector inside the open overlay's shadow root, if that screen is up. */
  function tourOverlayQuery(selector) {
    return activeOverlay?.root?.querySelector(selector) || null;
  }

  /** Whichever of the two entry points the current width actually shows. */
  function tourNavTarget() {
    const nav = document.getElementById(NAV_ID);
    if (isVisible(nav)) return nav;
    const dock = document.getElementById(DOCK_ID);
    return isVisible(dock) ? dock : nav || dock;
  }

  /** The open menu, or the open bottom sheet on narrow windows. */
  function tourMenuRoot() {
    const menu = document.getElementById(MENU_ID);
    if (menu && menu.classList.contains("show") && isVisible(menu)) return menu;
    return isSheetOpen() ? document.getElementById(SHEET_ID) : null;
  }

  function tourResourcePin(group) {
    const id = String(group.resource.id);
    for (const row of tourMenuRoot()?.querySelectorAll(".onejob-resource-row") || []) {
      if (row.dataset.resourceId !== id) continue;
      return row.querySelector(".onejob-pin-button");
    }
    return null;
  }

  function tourPinChip() {
    return (
      document.querySelector(`#${PINS_BAR_ID} .onejob-pin-chip.is-active`) ||
      document.querySelector(`#${PINS_BAR_ID} .onejob-pin-chip`)
    );
  }

  /** The pin the heatmap step opens: the one pinned during the tour first. */
  function tourPin() {
    const justPinned = state.tourPinId
      ? state.pins.find((pin) => pin.id === state.tourPinId)
      : null;
    if (justPinned) return justPinned;
    if (!state.pins.length) return null;
    const active = currentPinnedId();
    return state.pins.find((pin) => pin.id === active) || state.pins[0];
  }

  /** The pin's single-resource calendar, built the way its chip's link is. */
  function tourPinHref(pin) {
    const resource = findResource(pin.id);
    const info = U.parseBookingPath(location.pathname);
    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const { start, end } = U.currentRange(location.search);
    return U.bookingHref({
      webAddress,
      type: pin.type || resource?.type || info?.type || "all",
      view: cfg.defaultView,
      group: pin.group || resource?.group || "",
      resource: pin.id,
      start,
      end,
    });
  }

  function openTourMenu() {
    const item = document.getElementById(NAV_ID);
    const menu = item?.querySelector(`#${MENU_ID}`);
    // Below 1200px the portal hides the navbar; the menu is still in the DOM.
    if (item && menu && isVisible(item)) {
      fillMenu(item);
      if (!menu.classList.contains("show")) toggleMenu(item);
      return;
    }
    if (isVisible(findDock())) openSheet();
  }

  function isVisible(element) {
    if (!element || !element.getClientRects().length) return false;
    return getComputedStyle(element).visibility !== "hidden";
  }

  /**
   * Recorded when the tour is *shown*, not when it ends: clicking a resource
   * name mid-tour navigates away, and that is exactly the habit the tour is
   * about, so it must not make the tour restart on every page. The popup's
   * replay button is the way back in.
   */
  function markTourSeen() {
    const version = Number(cfg.onboarding?.version) || 1;
    if (Number(state.settings.onboardingVersion || 0) >= version) return;
    state.settings = { ...state.settings, onboardingVersion: version };
    writeCachedSettings(state.settings);
    storageSet(cfg.storageKeys.settings, state.settings);
  }

  /**
   * The pins strip: one chip per pinned resource, at the top of the page below
   * the portal's navigation. It is always there, so a pinned resource is one
   * click away without opening the menu. When a pin is the only resource on
   * screen, the strip also carries the way back to its group's calendar.
   */
  function ensurePinsBar() {
    const pins = state.pins.filter((pin) => pin && pin.id);
    const pinnedId = currentPinnedId();
    if (!pins.length && !pinnedId) {
      document.getElementById(PINS_BAR_WRAP_ID)?.remove();
      return;
    }

    const main = document.querySelector("main");
    if (!main) return;

    let wrap = document.getElementById(PINS_BAR_WRAP_ID);
    let bar = document.getElementById(PINS_BAR_ID);
    if (!wrap || !bar) {
      wrap?.remove();
      wrap = document.createElement("div");
      wrap.id = PINS_BAR_WRAP_ID;
      wrap.className = "container";
      bar = document.createElement("nav");
      bar.id = PINS_BAR_ID;
      bar.className = "onejob-pins-bar";
      bar.setAttribute("aria-label", "Pinned resources");
      wrap.appendChild(bar);
    }
    // Match the width of the portal's content container.
    mountStrip(wrap, main);

    const key = pinsBarKey(pins);
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    bar.replaceChildren(...renderPinsBar(pins));
  }

  /**
   * Personal pages (`/user/dashboard/*`) lay `<main>` out as a flex row — a
   * 200px left menu next to the content — so a child of it becomes a column of
   * its own and the page reflows around the strip. Where `<main>` is a flex or
   * grid container, the strip goes just above it instead. `after` keeps a
   * second strip (the day grid) below the one it belongs under.
   */
  function mountStrip(wrap, main, after) {
    const display = getComputedStyle(main).display;
    const rowLayout = display.includes("flex") || display.includes("grid");
    const host = rowLayout && main.parentElement ? main.parentElement : main;
    const anchor = after && after.parentElement === host ? after : null;

    if (anchor) {
      if (wrap.parentElement !== host || wrap.previousElementSibling !== anchor) anchor.after(wrap);
      return;
    }
    if (rowLayout) {
      if (wrap.parentElement !== host || wrap.nextElementSibling !== main) host.insertBefore(wrap, main);
      return;
    }
    if (wrap.parentElement !== main || main.firstElementChild !== wrap) main.prepend(wrap);
  }

  /**
   * Everything the strip's links depend on. Rebuilding it on every ensure pass
   * would fight the MutationObserver that schedules those passes.
   */
  function pinsBarKey(pins) {
    return [
      pins.map((pin) => `${pin.id}:${pin.name}`).join(","),
      state.groupsVersion,
      currentPinnedId(),
      location.search,
    ].join("|");
  }

  function renderPinsBar(pins) {
    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const view = cfg.defaultView;
    const { start, end } = U.currentRange(location.search);
    const current = U.parseBookingPath(location.pathname);
    const pinnedId = currentPinnedId();

    const label = document.createElement("span");
    label.className = "onejob-pins-bar-label";
    label.textContent = "Pinned";
    const nodes = [label];

    for (const pin of pins) {
      const resource = findResource(pin.id);
      const type = pin.type || resource?.type || current?.type || "all";
      const group = pin.group || resource?.group || "";
      const name = pin.name || resource?.name || `Resource ${pin.id}`;

      const chip = document.createElement("div");
      chip.className = `onejob-pin-chip${pinnedId === pin.id ? " is-active" : ""}`;

      const link = document.createElement("a");
      link.className = "onejob-pin-chip-link";
      link.href = U.bookingHref({ webAddress, type, view, group, resource: pin.id, start, end });
      link.textContent = name;
      link.title = name;
      link.addEventListener("click", () => {
        rememberPinnedResource({ id: pin.id, name, group, type });
        // Clicking the chip on the pin or heatmap step is the same move as that
        // step's button, so the tour picks up on the calendar either way.
        if (state.tour?.id === "pin" || state.tour?.id === "heatmap") {
          writeTourResume("heatmap");
        }
      });
      chip.appendChild(link);

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
      chip.appendChild(unpin);

      nodes.push(chip);
    }

    if (pinnedId) nodes.push(showAllLink());
    return nodes;
  }

  /**
   * The way out of the single-resource view, at the end of the strip.
   */
  function showAllLink() {
    const info = U.parseBookingPath(location.pathname);
    const session = readPinnedSession();
    const resource = session?.id ? findResource(session.id) : null;
    const type = info?.type || session?.type || resource?.type || "all";
    const group = pinnedGroup(session);

    const link = document.createElement("a");
    link.className = "onejob-pins-show-all";
    link.href = showAllHref();
    link.textContent = group
      ? `Show all ${G.displayGroupName(group, cfg.nav.stripGroupPrefix)}`
      : `Show all ${G.typeLabel(type).toLowerCase()}`;
    link.addEventListener("click", () => clearPinnedResource());
    return link;
  }

  /* ------------------------------------------------------------------ *
   * Day/time heatmap (single-resource calendar)
   *
   * A 4 × 28 grid under the pins: 28 days across, morning / afternoon /
   * evening / night down. It only exists while a pin is the only resource on
   * screen, because the booking feed returns every resource and there is no
   * per-resource filter; the rows are coloured by that resource's booked
   * share of each six-hour block.
   * ------------------------------------------------------------------ */

  function ensureDayGrid() {
    const pin = state.settings.dayGrid === false ? null : dayGridPin();
    const existing = document.getElementById(DAY_GRID_WRAP_ID);
    if (!pin) {
      existing?.remove();
      return;
    }

    const main = document.querySelector("main");
    if (!main) return;

    let wrap = existing;
    let grid = document.getElementById(DAY_GRID_ID);
    if (!wrap || !grid) {
      wrap?.remove();
      wrap = document.createElement("div");
      wrap.id = DAY_GRID_WRAP_ID;
      wrap.className = "container";
      grid = document.createElement("section");
      grid.id = DAY_GRID_ID;
      grid.className = "onejob-daygrid";
      grid.setAttribute("aria-label", "Bookings per day and time of day");
      grid.addEventListener("click", onDayGridClick);
      grid.addEventListener("pointerover", onDayGridPointerOver);
      grid.addEventListener("pointerleave", () => setDayGridHover(grid, ""));
      wrap.appendChild(grid);
    }

    mountStrip(wrap, main, document.getElementById(PINS_BAR_WRAP_ID));
    loadDayGrid(pin);
    loadDayGridLuma();
    loadDayGridMine(pin);
    loadDayGridReserved(pin);

    const key = dayGridKey(pin);
    if (grid.dataset.key === key) return;
    grid.dataset.key = key;
    renderDayGrid(grid, pin);
  }

  /** The pinned resource, but only while its calendar is the page on screen. */
  function dayGridPin() {
    if (!hasExtensionApis || !S || !O) return null;
    const info = U.parseBookingPath(location.pathname);
    if (!info || info.view !== "calendar") return null;
    const id = currentPinnedId();
    if (!id) return null;

    const session = readPinnedSession();
    const resource = findResource(id);
    return {
      id,
      name: session?.name || resource?.name || "",
      group: session?.group || resource?.group || "",
      type: session?.type || resource?.type || info.type,
    };
  }

  function dayGridWindow() {
    const config = cfg.dayGrid || {};
    return S.dayGridRange({ daysBack: config.daysBack, daysAhead: config.daysAhead });
  }

  function visibleWeekKey() {
    const { start } = U.currentRange(location.search);
    const date = start ? new Date(start) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return S.dayKey(S.dayGridRange({ now: date }).current);
  }

  /**
   * The grid is rebuilt only when this changes: the MutationObserver schedules
   * an ensure pass for every DOM mutation, so rendering unconditionally loops.
   */
  function dayGridKey(pin) {
    const { start } = dayGridWindow();
    return [
      pin.id,
      S.dayKey(start),
      state.dayGrid.revision,
      state.groupsVersion,
      visibleWeekKey(),
    ].join("|");
  }

  function loadDayGrid(pin) {
    if (!S || !O) return;
    const { start, end } = dayGridWindow();
    const key = `${pin.id}|${start.getTime()}|${end.getTime()}`;

    if (state.dayGrid.key === key) {
      const retry = state.dayGrid.status === "error" && Date.now() - state.dayGrid.attemptedAt > 60000;
      if (!retry) return;
    }

    state.dayGrid.key = key;
    state.dayGrid.status = "loading";
    state.dayGrid.attemptedAt = Date.now();
    state.dayGrid.error = false;
    // A different resource or window must not show the previous grid's data.
    state.dayGrid.records = [];
    state.dayGrid.revision += 1;

    const token = readAccessToken();
    if (!token) {
      failDayGrid(key);
      return;
    }

    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const params = new URLSearchParams({
      start: O.toPortalIso(start),
      end: O.toPortalIso(end),
      showAll: "",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.api.timeoutMs);

    fetch(`${U.apiBaseUrl(webAddress)}/en/bookings/fullCalendarBookings?${params.toString()}`, {
      method: "GET",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "x-nx-app-name": "portal",
        "X-Use-Timezone": "true",
      },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (state.dayGrid.key !== key) return;
        // A linked booking repeats per resource; keep the pinned resource's row.
        const records = Array.isArray(payload)
          ? S.normalizeRecords(payload, O.parseTimestamp, { perResource: true })
          : [];
        state.dayGrid.records = records;
        state.dayGrid.status = Array.isArray(payload) ? "ready" : "error";
        state.dayGrid.error = !Array.isArray(payload);
        state.dayGrid.revision += 1;
        scheduleEnsure();
      })
      .catch(() => failDayGrid(key))
      .finally(() => clearTimeout(timeout));
  }

  function failDayGrid(key) {
    if (state.dayGrid.key !== key) return;
    state.dayGrid.records = [];
    state.dayGrid.status = "error";
    state.dayGrid.error = true;
    state.dayGrid.revision += 1;
    scheduleEnsure();
  }

  /**
   * `config.luma.source` is the built-in portal's calendar. content.js only
   * runs on that portal (the manifest names one origin), so the gate is the
   * setting rather than the origin; the overview needs the origin check because
   * its page can run anywhere. The heatmap has its own switch, independent of
   * the overview's *Luma events in overview* row.
   */
  function dayGridLumaEnabled() {
    return (
      hasExtensionApis &&
      Boolean(cfg.luma?.source) &&
      state.settings.dayGridEvents !== false
    );
  }

  function loadDayGridLuma() {
    if (!dayGridLumaEnabled()) {
      if (state.dayGrid.events.length) {
        state.dayGrid.events = [];
        state.dayGrid.lumaStatus = "idle";
        state.dayGrid.revision += 1;
        scheduleEnsure();
      }
      return;
    }
    if (state.dayGrid.lumaStatus !== "idle") return;
    state.dayGrid.lumaStatus = "loading";

    chrome.runtime.sendMessage({ type: "onejob:luma-events" }, (response) => {
      const error = chrome.runtime.lastError;
      state.dayGrid.lumaStatus = "ready";
      if (error || !response?.ok) return;

      state.dayGrid.events = (response.entries || [])
        .map((entry) => O.normalizeLumaEvent(entry))
        .filter(Boolean)
        .map((event) => ({
          start: event.stamp,
          end: event.endStamp,
          name: event.coworker,
          url: event.url,
        }));
      state.dayGrid.revision += 1;
      scheduleEnsure();
    });
  }

  /**
   * The member's own bookings on the pinned resource, so their cells can be
   * marked. `/api/public/bookings/my` returns every resource, so the response
   * is narrowed to this pin; the records' times are naive local strings.
   */
  async function loadDayGridMine(pin) {
    const { start, end } = dayGridWindow();
    const key = `${pin.id}|${start.getTime()}|${end.getTime()}`;
    if (state.dayGrid.mineKey === key) return;

    state.dayGrid.mineKey = key;
    state.dayGrid.mine = [];
    state.dayGrid.mineStatus = "loading";
    state.dayGrid.revision += 1;

    const token = readAccessToken();
    if (!token) {
      state.dayGrid.mineStatus = "idle";
      return;
    }

    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const base = `${U.apiBaseUrl(webAddress)}/api/public/bookings/my`;
    const records = [];

    try {
      for (let page = 1; page <= 5; page += 1) {
        const params = new URLSearchParams({
          from_Booking_FromTime: O.toQueryTimestamp(start),
          to_Booking_FromTime: O.toQueryTimestamp(end),
          orderBy: "FromTime",
          dir: "0",
          size: "100",
          page: String(page),
        });
        const response = await fetch(`${base}?${params.toString()}`, {
          method: "GET",
          credentials: "omit",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "x-nx-app-name": "portal",
            "X-Use-Timezone": "true",
          },
        });
        if (!response.ok) break;
        const payload = await response.json();
        if (!Array.isArray(payload?.Records)) break;
        records.push(...payload.Records);
        if (!payload.HasNextPage) break;
      }
    } catch {
      if (state.dayGrid.mineKey === key) state.dayGrid.mineStatus = "error";
      return;
    }

    if (state.dayGrid.mineKey !== key) return;
    state.dayGrid.mine = records
      .filter(
        (record) =>
          record &&
          record.Cancelled !== true &&
          String(record.ResourceId) === String(pin.id),
      )
      .map((record) => {
        const from = O.parseTimestamp(record.FromTime || record.fromTime || record.start);
        const to = O.parseTimestamp(record.ToTime || record.toTime || record.end);
        return from && to ? { start: from.stamp, end: to.stamp } : null;
      })
      .filter(Boolean);
    state.dayGrid.mineStatus = "ready";
    state.dayGrid.revision += 1;
    scheduleEnsure();
  }

  /**
   * Workshop reservations of the pinned resource, from the same
   * `fullCalendarEvents` feed the overview's *Reserved* rows use. They block
   * the resource, so the heatmap counts them; space-wide events
   * (`resourceId: 0`) are ignored.
   */
  async function loadDayGridReserved(pin) {
    const { start, end } = dayGridWindow();
    const key = `${pin.id}|${start.getTime()}|${end.getTime()}`;
    if (state.dayGrid.reservedKey === key) return;

    state.dayGrid.reservedKey = key;
    state.dayGrid.reserved = [];
    state.dayGrid.reservedStatus = "loading";
    state.dayGrid.revision += 1;

    const token = readAccessToken();
    if (!token) {
      state.dayGrid.reservedStatus = "idle";
      return;
    }

    const webAddress = U.webAddressFromLocation(location.pathname) || cfg.portal.webAddress;
    const params = new URLSearchParams({
      start: O.toPortalIso(start),
      end: O.toPortalIso(end),
    });

    try {
      const response = await fetch(
        `${U.apiBaseUrl(webAddress)}/en/bookings/fullCalendarEvents?${params.toString()}`,
        {
          method: "GET",
          credentials: "omit",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "x-nx-app-name": "portal",
            "X-Use-Timezone": "true",
          },
        },
      );
      if (!response.ok) throw new Error("events");
      const payload = await response.json();
      if (state.dayGrid.reservedKey !== key) return;

      state.dayGrid.reserved = (Array.isArray(payload) ? payload : [])
        .filter((record) => record && String(record.resourceId) === String(pin.id))
        .map((record) => {
          const from = O.parseTimestamp(record.start);
          const to = O.parseTimestamp(record.end);
          if (!from || !to) return null;
          return {
            start: from.stamp,
            end: to.stamp,
            name: String(record.title || record.shortDescription || "Reserved"),
          };
        })
        .filter(Boolean);
      state.dayGrid.reservedStatus = "ready";
      state.dayGrid.revision += 1;
      scheduleEnsure();
    } catch {
      if (state.dayGrid.reservedKey === key) state.dayGrid.reservedStatus = "error";
    }
  }

  function renderDayGrid(grid, pin) {
    const config = cfg.dayGrid || {};
    const model = S.dayGrid(state.dayGrid.records, [{ id: pin.id }], {
      daysBack: config.daysBack,
      daysAhead: config.daysAhead,
      buckets: config.buckets,
      bands: config.bands,
      events: dayGridLumaEnabled() ? state.dayGrid.events : [],
      mine: state.dayGrid.mine,
      reserved: state.dayGrid.reserved,
    });
    const now = new Date();
    const visible = visibleWeekKey();
    const today = S.dayKey(now);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const table = document.createElement("div");
    table.className = "onejob-daygrid-grid";

    const weekCorner = document.createElement("span");
    weekCorner.className = "onejob-daygrid-corner";
    table.appendChild(weekCorner);
    for (const week of model.weeks) {
      const label = document.createElement("span");
      label.className = `onejob-daygrid-week${S.dayKey(week.start) === visible ? " is-visible" : ""}`;
      label.textContent = week.label;
      label.title = weekRangeLabel(week.start);
      table.appendChild(label);
    }

    const shortWeekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
    const headerCell = (day, className) => {
      const weekday = day.date.getDay();
      const node = document.createElement("span");
      node.className = [
        className,
        day.key === today ? "is-today" : "",
        weekday === 0 || weekday === 6 ? "is-weekend" : "",
      ].filter(Boolean).join(" ");
      node.title = dayLabel(day.date);
      return node;
    };

    const weekdayCorner = document.createElement("span");
    weekdayCorner.className = "onejob-daygrid-corner";
    table.appendChild(weekdayCorner);
    for (const day of model.days) {
      const name = headerCell(day, "onejob-daygrid-weekday");
      name.textContent = shortWeekday.format(day.date);
      table.appendChild(name);
    }

    for (const row of model.rows) {
      const label = document.createElement("span");
      label.className = "onejob-daygrid-row";
      label.textContent = row.label;
      label.title = `${padHour(row.from)}:00–${padHour(row.to % 24)}:00`;
      table.appendChild(label);

      for (const cell of row.days) {
        const link = document.createElement("a");
        const weekday = cell.date.getDay();
        link.className = [
          "onejob-daygrid-cell",
          `onejob-daygrid-level-${cell.level}`,
          cell.key === today ? "is-today" : "",
          cell.date.getTime() < todayStart ? "is-past" : "",
          weekday === 0 || weekday === 6 ? "is-weekend" : "",
          cell.eventCount ? "has-event" : "",
          cell.reservedCount ? "has-reserved" : "",
          cell.mine ? "is-mine" : "",
        ].filter(Boolean).join(" ");
        link.href = dayGridHref(cell.date, pin);
        link.dataset.day = cell.key;
        const text = dayGridCellLabel(cell, row);
        link.title = text;
        link.setAttribute("aria-label", text);
        if (cell.reservedCount) {
          const bar = document.createElement("span");
          bar.className = "onejob-daygrid-reserved";
          link.appendChild(bar);
        }
        table.appendChild(link);
      }
    }

    // The dates sit under the squares so the weekday names can sit above them.
    const dateCorner = document.createElement("span");
    dateCorner.className = "onejob-daygrid-corner";
    table.appendChild(dateCorner);
    for (const day of model.days) {
      const number = headerCell(day, "onejob-daygrid-daynum");
      number.textContent = String(day.date.getDate());
      table.appendChild(number);
    }

    if (!state.dayGrid.error) {
      grid.replaceChildren(table);
      return;
    }

    // The grid itself is self-explanatory; only a failed fetch needs a word.
    const note = document.createElement("p");
    note.className = "onejob-daygrid-note";
    note.textContent = "Bookings unavailable";
    grid.replaceChildren(note, table);
  }

  /** Every square of a week links to that week's calendar. */
  function dayGridHref(date, pin) {
    const params = new URLSearchParams(location.search);
    const monday = S.dayGridRange({ now: date }).current;
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    params.set("start", O.toPortalIso(monday));
    params.set("end", O.toPortalIso(end));
    if (pin?.id) params.set(U.RESOURCE_PARAM, String(pin.id));
    return `${location.pathname}?${params.toString()}${location.hash}`;
  }

  function dayGridCellLabel(cell, row) {
    const date = dayLabel(cell.date);
    const bookings = `${cell.count} ${cell.count === 1 ? "booking" : "bookings"}${cell.linked ? " (linked)" : ""}`;
    const share = Math.round(cell.share * 100);
    const hours = cell.reservedHours > 0
      ? `${S.formatHours(cell.hours)} booked + ${S.formatHours(cell.reservedHours)} reserved`
      : `${S.formatHours(cell.hours)} booked`;
    const mine = cell.mine ? " · your booking" : "";
    const reserved = cell.reservedNames?.length
      ? ` · Reserved: ${cell.reservedNames
          .map((name, index) => `${timeLabel(cell.reservedStarts[index])} ${name}`)
          .join(", ")}`
      : "";
    const events = cell.eventNames?.length
      ? ` · Luma: ${cell.eventNames
          .map((name, index) => `${timeLabel(cell.eventStarts[index])} ${name}`)
          .join(", ")}`
      : "";
    return `${date}, ${row.label.toLowerCase()} · ${bookings} · ${hours} (${share}%)${mine}${reserved}${events}`;
  }

  function timeLabel(stamp) {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(
      new Date(stamp),
    );
  }

  function dayLabel(date) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  }

  function weekRangeLabel(start) {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return `${dayLabel(start)} – ${dayLabel(end)}`;
  }

  function padHour(value) {
    return String(value).padStart(2, "0");
  }

  function onDayGridClick(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest(".onejob-daygrid-cell");
    if (!cell) return;

    const pin = dayGridPin();
    if (pin) rememberPinnedResource(pin);

    event.preventDefault();
    try {
      history.pushState(history.state, "", cell.href);
      // React Router only reacts to history events; pushState alone is invisible.
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    } catch {
      location.assign(cell.href);
    }
  }

  function onDayGridPointerOver(event) {
    const grid = event.currentTarget;
    const target = event.target;
    const cell = target instanceof Element ? target.closest(".onejob-daygrid-cell") : null;
    if (!cell || !grid.contains(cell)) return;
    setDayGridHover(grid, cell.dataset.day || "");
  }

  /** Light up the four squares of the hovered day so a column reads as a day. */
  function setDayGridHover(grid, day) {
    if (grid.dataset.hover === day) return;
    grid.dataset.hover = day;
    for (const cell of grid.querySelectorAll(".onejob-daygrid-cell.is-hover")) {
      cell.classList.remove("is-hover");
    }
    if (!day) return;
    for (const cell of grid.querySelectorAll(`.onejob-daygrid-cell[data-day="${day}"]`)) {
      cell.classList.add("is-hover");
    }
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

  /**
   * The whole group row is the toggle. Clicking a group name used to jump to
   * that group's calendar, which is what testers did instead of expanding the
   * list — the group's calendar is the "Show all" row at the end of the list now.
   */
  function groupToggle({ group, key, expanded, active }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `onejob-group-toggle${active ? " is-active" : ""}`;
    button.dataset.group = group.name;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} ${group.label} resources`);

    const label = document.createElement("span");
    label.className = "onejob-group-label";
    label.textContent = group.label;

    const chevron = document.createElement("span");
    chevron.className = "onejob-group-chevron";
    chevron.innerHTML = CHEVRON_ICON;

    button.append(label, chevron);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleGroup(key);
    });
    return button;
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

    // Pinning during the tour's pin step is the success case; the heatmap step
    // then follows this machine to its calendar.
    if (!exists && state.tour?.id === "pin") {
      state.tourPinId = id;
      state.tour.next();
    }

    // Unpinning the resource that is currently shown alone should return to
    // its group's calendar instead of leaving a stale single-resource view.
    if (exists && currentPinnedId() === id) {
      const href = showAllHref();
      clearPinnedResource();
      if (href) location.assign(href);
    }
  }

  /* ------------------------------------------------------------------ *
   * Pinned resource (per-tab marker + the strip's Show all link)
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

    if (changes[cfg.storageKeys.tourRequest] && changes[cfg.storageKeys.tourRequest].newValue) {
      state.tourRequested = true;
      storageSet(cfg.storageKeys.tourRequest, 0);
      scheduleTour();
    }
  }
})();
