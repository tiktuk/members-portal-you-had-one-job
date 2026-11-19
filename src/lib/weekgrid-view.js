/* global chrome, OneJobConfig, OneJobUrl, OneJobOverview, OneJobGroups, OneJobStats, OneJobWeekGrid, OneJobBookingDialog */

/**
 * The category week view: every resource of a menu group in one week grid.
 * Mounted into the in-portal overlay by content.js; the markup lives in a
 * shadow root so its generic class names cannot collide with the portal's
 * Bootstrap styles.
 */
(() => {
  "use strict";

  const cfg = OneJobConfig;
  const U = OneJobUrl;
  const O = OneJobOverview;
  const G = OneJobGroups;
  const S = OneJobStats;
  const W = OneJobWeekGrid;

  const SUCCESS_MS = 8 * 1000;
  const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
  const DAY_NUMBER = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  const DAY_TITLE = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

  function weekCfg() {
    return cfg.weekGrid || {};
  }

  function emptyState() {
    return {
      session: null,
      settings: null,
      cachedGroups: null,
      /** The whole published list; `resources` is what the current mode shows. */
      allResources: [],
      resources: [],
      pins: [],
      /** "single" (the pinned machine it opened from), "pinned", "mine" or "category". */
      mode: "category",
      /** { type, group, label } of the menu group the view was opened from. */
      scope: null,
      viewMode: "week",
      weekOffset: 0,
      dayOffset: 0,
      /** weekStart ms -> { fetchedAt, records, reserved, mine, me }. */
      weeks: {},
      events: [],
    eventsStatus: "idle",
    loading: false,
    error: null,
    resourcesError: null,
      notice: "",
      success: null,
      updatedAt: null,
      webAddress: cfg.portal.webAddress,
      origin: cfg.portal.origin,
      model: null,
    };
  }

  const state = emptyState();

  const ui = {
    root: null,
    doc: null,
    onClose: null,
    summary: null,
    modes: null,
    viewModes: null,
    heading: null,
    nav: null,
    previousButton: null,
    nextButton: null,
    title: null,
    notice: null,
    success: null,
    body: null,
    refreshButton: null,
    timer: 0,
    successTimer: 0,
    onStorageChanged: null,
    controller: null,
    ghost: null,
    cells: new Map(),
  };

  const dialogs = OneJobBookingDialog.create({
    doc: () => ui.doc,
    root: () => ui.root,
    session: () => currentSession(),
    fetchJson: (...args) => fetchJson(...args),
    portalOrigin: () => portalOrigin(),
    webAddress: () => state.webAddress,
    isPanel: () => true,
    closePanel: () => ui.onClose?.(),
    reload: () => load({ force: true }),
    showSuccess: (notice) => showSuccess(notice),
    ownCoworkerId: () => currentWeek()?.me?.id,
  });

  globalThis.OneJobWeekGridView = { mount, destroy };

  function mount(root, options = {}) {
    destroy();

    ui.root = root;
    ui.doc = root.ownerDocument;
    ui.onClose = typeof options.onClose === "function" ? options.onClose : null;
    state.scope = normalizeScope(options.scope);
    state.mode = state.scope?.resourceId ? "single" : "category";

    root.classList.add("overview", "weekgrid", "is-panel");
    root.replaceChildren(buildShell());

    start();
    return {
      refresh: () => load({ force: true }),
      destroy,
      hasOpenModal: () => dialogs.hasOpenModal(),
    };
  }

  function normalizeScope(scope) {
    if (!scope || typeof scope !== "object") return null;
    const type = String(scope.type || "");
    const group = String(scope.group || "");
    if (!type && !group) return null;
    const resourceId = scope.resourceId != null ? String(scope.resourceId) : "";
    const label = String(scope.label || group || type);
    return { type, group, resourceId, label, categoryLabel: String(scope.categoryLabel || label) };
  }

  function destroy() {
    dialogs.close();
    dialogs.reset();
    if (ui.timer) clearInterval(ui.timer);
    if (ui.successTimer) clearTimeout(ui.successTimer);
    if (ui.controller) ui.controller.abort();
    if (ui.onStorageChanged && typeof chrome?.storage?.onChanged?.removeListener === "function") {
      chrome.storage.onChanged.removeListener(ui.onStorageChanged);
    }
    if (ui.root) ui.root.replaceChildren();

    ui.root = null;
    ui.doc = null;
    ui.onClose = null;
    ui.summary = null;
    ui.modes = null;
    ui.viewModes = null;
    ui.heading = null;
    ui.nav = null;
    ui.previousButton = null;
    ui.nextButton = null;
    ui.title = null;
    ui.notice = null;
    ui.success = null;
    ui.body = null;
    ui.refreshButton = null;
    ui.timer = 0;
    ui.successTimer = 0;
    ui.onStorageChanged = null;
    ui.controller = null;
    ui.ghost = null;
    ui.cells = new Map();

    Object.assign(state, emptyState());
  }

  /* ------------------------------------------------------------------ *
   * Markup
   * ------------------------------------------------------------------ */

  function el(tag, className, text) {
    const node = ui.doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function iconButton(label, text, onClick) {
    const button = el("button", "button button-icon", text);
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  function buildShell() {
    const fragment = ui.doc.createDocumentFragment();

    const header = el("header", "page-header");
    const heading = el("div", "page-heading");
    ui.heading = el("h1", null, weekCfg().label || "Caro Week View");
    heading.appendChild(ui.heading);
    ui.modes = el("div", "wg-modes");
    ui.modes.setAttribute("role", "group");
    ui.modes.setAttribute("aria-label", "Show");
    heading.appendChild(ui.modes);
    ui.summary = el("p", "summary", "Loading…");
    ui.summary.setAttribute("aria-live", "polite");
    heading.appendChild(ui.summary);

    const actions = el("div", "actions");

    ui.viewModes = el("div", "wg-modes");
    ui.viewModes.setAttribute("role", "group");
    ui.viewModes.setAttribute("aria-label", "Calendar view");
    for (const mode of ["week", "day"]) {
      const button = el("button", "wg-mode", mode === "week" ? "Week" : "Day");
      button.type = "button";
      button.dataset.viewMode = mode;
      button.setAttribute("aria-pressed", String(state.viewMode === mode));
      button.addEventListener("click", () => setViewMode(mode));
      ui.viewModes.appendChild(button);
    }

    const nav = el("div", "wg-nav");
    ui.nav = nav;
    const today = el("button", "button", "Today");
    today.type = "button";
    today.addEventListener("click", () => {
      if (state.viewMode === "day") goToDay(0, true);
      else goToWeek(0, true);
    });
    ui.title = el("span", "wg-title");
    ui.title.setAttribute("aria-live", "polite");
    ui.previousButton = iconButton("Previous period", "‹", () => moveDate(-1));
    ui.nextButton = iconButton("Next period", "›", () => moveDate(1));
    nav.append(
      ui.previousButton,
      ui.title,
      ui.nextButton,
      today,
    );
    actions.appendChild(ui.viewModes);
    actions.appendChild(nav);

    ui.refreshButton = el("button", "button", "Refresh");
    ui.refreshButton.type = "button";
    ui.refreshButton.addEventListener("click", () => load({ force: true }));
    actions.appendChild(ui.refreshButton);

    actions.appendChild(iconButton("Close Caro Week View", "×", () => ui.onClose?.()));

    header.append(heading, actions);

    const main = el("main");
    ui.notice = el("div", "notice");
    ui.notice.hidden = true;
    ui.notice.setAttribute("role", "status");
    ui.success = el("div", "notice success");
    ui.success.hidden = true;
    ui.success.setAttribute("role", "status");
    ui.body = el("div", "wg-body");
    main.append(ui.notice, ui.success, ui.body);

    fragment.append(header, main);
    return fragment;
  }

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */

  async function start() {
    let pins;
    [state.session, state.cachedGroups, state.settings, pins] = await Promise.all([
      get(cfg.storageKeys.session),
      get(cfg.storageKeys.groups),
      get(cfg.storageKeys.settings),
      get(cfg.storageKeys.pins),
    ]);
    if (!ui.root) return;

    state.pins = O.normalizePins(pins);
    state.allResources = Array.isArray(state.cachedGroups?.resources) ? state.cachedGroups.resources : [];
    applyScope();
    state.webAddress = state.session?.webAddress || cfg.portal.webAddress;
    state.origin = state.session?.origin || cfg.portal.origin;

    ui.onStorageChanged = onStorageChanged;
    chrome.storage.onChanged.addListener(onStorageChanged);

    render();
    await load();
    if (!ui.root) return;

    ui.timer = setInterval(() => {
      if (!ui.doc.hidden && !state.loading && !dialogs.hasOpenModal()) load();
    }, Number(weekCfg().refreshMs) || 60 * 1000);
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !ui.root) return;
    if (changes[cfg.storageKeys.session]) {
      state.session = changes[cfg.storageKeys.session].newValue || null;
      state.webAddress = state.session?.webAddress || cfg.portal.webAddress;
      state.origin = state.session?.origin || cfg.portal.origin;
      state.weeks = {};
      dialogs.reset();
      load();
    }
    if (changes[cfg.storageKeys.settings]) {
      const hadMachineColors = state.settings?.machineColors !== false;
      state.settings = changes[cfg.storageKeys.settings].newValue || null;
      const hasMachineColors = state.settings?.machineColors !== false;
      let shouldRender = hadMachineColors !== hasMachineColors;
      if (!eventsEnabled() && state.events.length) {
        state.events = [];
        state.eventsStatus = "idle";
        buildModel();
        shouldRender = true;
      }
      if (shouldRender) render();
    }
  }

  /** The resources a mode shows, from the whole published list. */
  function resourcesFor(mode, resources) {
    const list = Array.isArray(resources) ? resources.filter(Boolean) : [];
    const scope = state.scope;
    if (!scope) return list;
    if (mode === "single") return list.filter((resource) => resource.id === scope.resourceId);
    if (mode === "mine") {
      const entry = currentWeek();
      const ids = W.ownedResourceIds(entry?.records, { mine: entry?.mine, me: entry?.me });
      return list.filter((resource) => ids.has(resource.id));
    }
    if (mode === "pinned") {
      const ids = new Set(
        state.pins.filter((pin) => !pin.type || !scope.type || pin.type === scope.type).map((pin) => pin.id),
      );
      return list.filter((resource) => ids.has(resource.id) && (!scope.type || resource.type === scope.type));
    }
    if (mode.startsWith("cat:")) {
      const other = otherCategories().find((entry) => entry.id === mode);
      return other ? S.filterResources(list, { type: other.type, group: other.group }) : [];
    }
    return S.filterResources(list, { type: scope.type, group: scope.group });
  }

  /**
   * The other categories the member has pins in (a laser is open, a CNC is
   * pinned): one extra mode each, showing that whole category.
   */
  function otherCategories() {
    const scope = state.scope;
    if (!scope) return [];
    const seen = new Set([`${scope.type}|${scope.group}`]);
    const result = [];
    for (const pin of state.pins) {
      // The published list is current; the pin's own group may be stale.
      const live = state.allResources.find((resource) => resource && resource.id === pin.id);
      const type = live?.type || pin.type || scope.type;
      const group = live ? live.group : pin.group;
      const key = `${type}|${group}`;
      if (!group || seen.has(key) || (!scope.group && type === scope.type)) continue;
      seen.add(key);
      result.push({
        id: `cat:${result.length}`,
        type,
        group,
        label: G.displayGroupName(group, cfg.nav.stripGroupPrefix) || G.typeLabel(type),
      });
    }
    return result.filter((entry) => S.filterResources(state.allResources, entry).length);
  }

  /** Modes worth offering: a pinned-origin view, the pins of the type, the category. */
  function availableModes() {
    const scope = state.scope;
    if (!scope) return [];
    const modes = [];
    if (scope.resourceId) modes.push({ id: "single", label: scope.label });
    if (resourcesFor("pinned", state.allResources).length > (scope.resourceId ? 1 : 0)) {
      modes.push({ id: "pinned", label: "Pinned" });
    }
    modes.push({ id: "category", label: scope.categoryLabel });
    for (const other of otherCategories()) modes.push({ id: other.id, label: other.label });
    modes.push({ id: "mine", label: "My bookings" });
    return modes;
  }

  function applyScope() {
    let modes = availableModes();
    if (!modes.some((mode) => mode.id === state.mode)) state.mode = modes[0]?.id || "category";
    state.resources = scopedResources(state.allResources);
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    state.notice = "";
    applyScope();
    buildModel();
    render();
  }

  function scopedResources(resources) {
    const seen = new Set();
    return resourcesFor(state.mode, resources)
      .filter((resource) => !seen.has(resource.id) && seen.add(resource.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
  }

  function currentSession() {
    const session = state.session;
    if (!session || !session.accessToken) return { status: "missing" };
    if (typeof session.expiresAt === "number" && session.expiresAt > 0 && session.expiresAt <= Date.now()) {
      return { status: "expired" };
    }
    return {
      status: "ok",
      token: session.accessToken,
      webAddress: session.webAddress || cfg.portal.webAddress,
    };
  }

  function portalOrigin() {
    const origin = ui.doc?.defaultView?.location?.origin;
    if (origin && origin !== "null") return origin;
    return state.origin || cfg.portal.origin;
  }

  function weekStart() {
    const offset = state.viewMode === "day"
      ? Math.floor((weekdayIndex() + state.dayOffset) / 7)
      : state.weekOffset;
    return W.weekRange(new Date(), offset).start;
  }

  function weekdayIndex(date = new Date()) {
    return (date.getDay() + 6) % 7;
  }

  function selectedDay() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + state.dayOffset);
    return date;
  }

  function dayKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function setViewMode(mode) {
    if (mode === state.viewMode) return;
    const scroll = ui.body?.querySelector(".wg-scroll");
    if (scroll) scroll.scrollLeft = 0;
    const weekday = weekdayIndex();
    if (mode === "day") {
      state.dayOffset = state.weekOffset === 0 ? 0 : state.weekOffset * 7 - weekday;
    } else {
      state.weekOffset = Math.floor((weekday + state.dayOffset) / 7);
    }
    state.viewMode = mode === "day" ? "day" : "week";
    state.notice = "";
    buildModel();
    render();
    load();
  }

  function moveDate(delta) {
    if (state.viewMode === "day") goToDay(state.dayOffset + delta);
    else goToWeek(state.weekOffset + delta);
  }

  function goToDay(offset, reload = false) {
    if (state.viewMode === "day" && offset === state.dayOffset && !reload) return;
    state.viewMode = "day";
    state.dayOffset = offset;
    state.notice = "";
    buildModel();
    render();
    load();
  }

  function currentWeek() {
    return state.weeks[weekStart().getTime()] || null;
  }

  function goToWeek(offset, reload = false) {
    if (state.viewMode === "week" && offset === state.weekOffset && !reload) return;
    state.viewMode = "week";
    state.weekOffset = offset;
    state.notice = "";
    buildModel();
    render();
    load();
  }

  function isStale(entry) {
    return !entry || Date.now() - entry.fetchedAt > (Number(weekCfg().cacheTtlMs) || 30 * 1000);
  }

  async function load({ force = false } = {}) {
    if (!ui.root) return;
    if (ui.controller) ui.controller.abort();
    const controller = new AbortController();
    ui.controller = controller;

    const session = currentSession();
    state.error = null;
    state.resourcesError = null;
    if (session.status !== "ok") {
      state.loading = false;
      state.model = null;
      render();
      return;
    }

    const start = weekStart();
    const key = start.getTime();
    const needsWeek = force || isStale(state.weeks[key]);
    const needsResourceDetails =
      force || !state.allResources.length || state.allResources.some((resource) => !Number.isFinite(resource.allocation));
    state.loading = needsWeek || needsResourceDetails;
    buildModel();
    render();

    try {
      await Promise.all([
        needsResourceDetails ? loadResources(session, controller) : Promise.resolve(),
        needsWeek ? loadWeek(session, start, controller) : Promise.resolve(),
        loadEvents(),
      ]);
      if (!ui.root || controller.signal.aborted) return;
      state.updatedAt = new Date();
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
    }
    if (!ui.root || controller.signal.aborted) return;
    state.loading = false;
    buildModel();
    render();
  }

  async function loadResources(session, controller) {
    try {
      const url = `${U.apiBaseUrl(session.webAddress)}${cfg.api.resourcesPath}`;
      const payload = await fetchJson(session, url, { signal: controller.signal });
      const allocationById = new Map(
        G.resourcesFromPayload(payload)
          .filter((resource) => resource && resource.Id != null)
          .map((resource) => [String(resource.Id), Number(resource.Allocation)]),
      );
      const resources = G.resourceListFromPayload(payload).map((resource) => {
        const allocation = allocationById.get(resource.id);
        return {
          ...resource,
          allocation: Number.isFinite(allocation) && allocation > 0 ? Math.floor(allocation) : 1,
        };
      });
      if (!resources.length) throw new Error("The portal returned no published resources.");
      state.allResources = resources;
      applyScope();
    } catch (error) {
      if (controller.signal.aborted) return;
      state.resourcesError = error;
      if (!state.resources.length && Array.isArray(state.cachedGroups?.resources)) {
        state.allResources = state.cachedGroups.resources;
        applyScope();
      }
    }
  }

  async function loadWeek(session, start, controller) {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const base = U.apiBaseUrl(session.webAddress);
    const params = new URLSearchParams({ start: O.toPortalIso(start), end: O.toPortalIso(end) });
    const bookingParams = new URLSearchParams(params);
    bookingParams.set("showAll", "");

    const [bookings, reserved, mine] = await Promise.allSettled([
      fetchJson(session, `${base}/en/bookings/fullCalendarBookings?${bookingParams}`, {
        signal: controller.signal,
      }),
      fetchJson(session, `${base}/en/bookings/fullCalendarEvents?${params}`, { signal: controller.signal }),
      fetchMine(session, start, end, controller),
    ]);
    if (controller.signal.aborted) return;

    if (bookings.status === "rejected") throw bookings.reason;
    if (!Array.isArray(bookings.value)) throw new Error("Unexpected calendar response.");

    const entry = {
      fetchedAt: Date.now(),
      records: S.normalizeRecords(bookings.value, O.parseTimestamp, { perResource: true }),
      reserved: reserved.status === "fulfilled" ? reservedFrom(reserved.value) : [],
      mine: mine.status === "fulfilled" ? mine.value.mine : [],
      me: mine.status === "fulfilled" ? mine.value.me : currentWeek()?.me || null,
    };
    state.weeks[start.getTime()] = entry;
  }

  function reservedFrom(payload) {
    return (Array.isArray(payload) ? payload : [])
      .filter((record) => record && record.resourceId != null && String(record.resourceId) !== "0")
      .map((record) => {
        const from = O.parseTimestamp(record.start);
        const to = O.parseTimestamp(record.end);
        if (!from || !to) return null;
        return {
          resourceId: String(record.resourceId),
          start: from.stamp,
          end: to.stamp,
          name: String(record.title || record.shortDescription || "Reserved"),
        };
      })
      .filter(Boolean);
  }

  /**
   * `/api/public/bookings/my` lists only active bookings, so it also tells the
   * grid who the member is (the first record that names its coworker) to
   * recognise finished bookings in the calendar feed.
   */
  async function fetchMine(session, start, end, controller) {
    const base = U.apiBaseUrl(session.webAddress);
    const records = [];
    for (let page = 1; page <= 5; page += 1) {
      const params = new URLSearchParams({
        from_Booking_FromTime: O.toQueryTimestamp(start),
        to_Booking_FromTime: O.toQueryTimestamp(end),
        orderBy: "FromTime",
        dir: "0",
        size: "100",
        page: String(page),
      });
      const payload = await fetchJson(session, `${base}/api/public/bookings/my?${params}`, {
        signal: controller.signal,
      });
      if (!Array.isArray(payload?.Records)) break;
      records.push(...payload.Records);
      if (!payload.HasNextPage) break;
    }

    const own = records.filter((record) => record && record.Cancelled !== true);
    const mine = own
      .map((record) => {
        const from = O.parseTimestamp(record.FromTime || record.fromTime || record.start);
        const to = O.parseTimestamp(record.ToTime || record.toTime || record.end);
        if (!from || !to) return null;
        return {
          id: record.Id != null ? String(record.Id) : "",
          resourceId: record.ResourceId != null ? String(record.ResourceId) : "",
          start: from.stamp,
          end: to.stamp,
        };
      })
      .filter(Boolean);
    const who = own.find((record) => record.CoworkerId != null || record.CoworkerFullName);
    const me = who
      ? {
          id: who.CoworkerId != null ? String(who.CoworkerId) : "",
          name: String(who.CoworkerFullName || "").trim(),
        }
      : null;
    return { mine, me };
  }

  /** Luma events follow the overview's *Luma events* switch. */
  function eventsEnabled() {
    if (!cfg.luma?.source || !chrome?.runtime?.sendMessage) return false;
    if (cfg.portal?.origin && String(portalOrigin()).replace(/\/+$/, "") !== cfg.portal.origin) return false;
    return state.settings && typeof state.settings.lumaEvents === "boolean"
      ? state.settings.lumaEvents
      : cfg.luma.enabled !== false;
  }

  async function loadEvents() {
    if (!eventsEnabled() || state.eventsStatus !== "idle") return;
    state.eventsStatus = "loading";
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "onejob:luma-events" }, (value) => {
          void chrome.runtime.lastError;
          resolve(value);
        });
      });
      state.eventsStatus = "ready";
      if (!response?.ok) return;
      state.events = (response.entries || [])
        .map((entry) => O.normalizeLumaEvent(entry))
        .filter(Boolean)
        .map((event) => ({ start: event.stamp, end: event.endStamp, name: event.coworker }));
    } catch {
      state.eventsStatus = "ready";
    }
  }

  async function fetchJson(session, url, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort);
    }

    const timeout = setTimeout(() => controller.abort(), cfg.api.timeoutMs || 15000);
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        credentials: "omit",
        signal: controller.signal,
        body: options.body,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          "x-nx-app-name": "portal",
          "X-Use-Timezone": "true",
          ...(options.headers || {}),
        },
      });

      if (response.status === 401 || response.status === 403) {
        const error = new Error("Your portal session expired.");
        error.code = "session-expired";
        throw error;
      }

      if (options.allowErrorBody) {
        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        return { status: response.status, data };
      }

      if (!response.ok) throw new Error(`The portal returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        if (!options.signal?.aborted) throw new Error("The request timed out.");
        const aborted = new Error("The request was cancelled.");
        aborted.code = "aborted";
        throw aborted;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  function get(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (result) => resolve(result[key])));
  }

  /* ------------------------------------------------------------------ *
   * Model
   * ------------------------------------------------------------------ */

  function buildModel() {
    state.resources = scopedResources(state.allResources);
    if (!state.resources.length) {
      state.model = null;
      return;
    }
    const entry = currentWeek();
    state.model = W.weekGrid(entry?.records || [], state.resources, {
      weekStart: weekStart(),
      hourFrom: weekCfg().hourFrom,
      hourTo: weekCfg().hourTo,
      mine: entry?.mine || [],
      me: entry?.me || null,
      events: eventsEnabled() ? state.events : [],
      reserved: entry?.reserved || [],
    });
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function render() {
    if (!ui.root) return;
    const session = currentSession();
    const start = weekStart();
    const dayView = state.viewMode === "day";

    ui.refreshButton.disabled = state.loading;
    ui.refreshButton.textContent = state.loading ? "Refreshing…" : "Refresh";
    ui.heading.textContent = dayView ? "Day view" : weekCfg().label || "Caro Week View";
    ui.nav.setAttribute("aria-label", dayView ? "Day" : "Week");
    ui.previousButton.title = dayView ? "Previous day" : "Previous week";
    ui.previousButton.setAttribute("aria-label", ui.previousButton.title);
    ui.nextButton.title = dayView ? "Next day" : "Next week";
    ui.nextButton.setAttribute("aria-label", ui.nextButton.title);
    ui.title.textContent = dayView ? DAY_TITLE.format(selectedDay()) : W.weekTitle(start);
    for (const button of ui.viewModes.children) {
      button.setAttribute("aria-pressed", String(button.dataset.viewMode === state.viewMode));
    }
    renderModes();
    ui.summary.textContent = summaryText(session);

    renderNotice(session);
    renderSuccess();
    renderBody(session);
  }

  function renderModes() {
    const modes = availableModes();
    ui.modes.replaceChildren();
    if (modes.length < 2) {
      if (modes[0]) ui.modes.appendChild(el("span", "wg-scope", modes[0].label));
      return;
    }
    for (const mode of modes) {
      const button = el("button", "wg-mode", mode.label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(mode.id === state.mode));
      button.addEventListener("click", () => setMode(mode.id));
      ui.modes.appendChild(button);
    }
  }

  function summaryText(session) {
    if (session.status !== "ok") return "Not connected";
    const count = state.resources.length;
    const noun = count === 1 ? "resource" : "resources";
    const updated = state.updatedAt
      ? ` · updated ${state.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
      : "";
    return state.loading && !state.model ? "Loading…" : `${count} ${noun}${updated}`;
  }

  function renderNotice(session) {
    let message = "";
    if (session.status !== "ok") {
      message =
        session.status === "expired"
          ? "Your portal session expired. Reload the portal to sign in again."
          : "Open the members portal while signed in so this view can read your bookings.";
    } else if (state.error) {
      message =
        state.error.code === "session-expired"
          ? state.error.message
          : `Couldn't load bookings: ${state.error.message || "unknown error"}`;
    } else if (state.notice) {
      message = state.notice;
    } else if (state.resourcesError && !state.resources.length) {
      message = `Couldn't load the resource list: ${state.resourcesError.message || "unknown error"}`;
    } else if (state.resourcesError && state.allResources.some((resource) => !Number.isFinite(resource.allocation))) {
      message = "Couldn't load resource capacity; multi-unit availability may be incomplete. Try Refresh.";
    }
    ui.notice.hidden = !message;
    ui.notice.textContent = message;
  }

  function renderSuccess() {
    ui.success.hidden = !state.success;
    ui.success.replaceChildren();
    if (!state.success) return;

    const heading = el("h2", null, state.success.title || "Booking created");
    const text = el("p", null, state.success.message || "");
    if (state.success.href) {
      text.append(" ");
      const link = el("a", null, state.success.linkLabel || "Open in the portal ↗");
      link.href = state.success.href;
      link.target = "_blank";
      link.rel = "noopener";
      text.append(link);
    }
    ui.success.append(heading, text);
  }

  function showSuccess(success) {
    state.success = success;
    renderSuccess();
    if (ui.successTimer) clearTimeout(ui.successTimer);
    ui.successTimer = setTimeout(() => {
      if (!ui.root) return;
      ui.successTimer = 0;
      state.success = null;
      renderSuccess();
    }, SUCCESS_MS);
  }

  function renderBody(session) {
    ui.cells = new Map();
    ui.ghost = null;
    const previous = ui.body.querySelector(".wg-scroll");
    const scrollTop = previous ? previous.scrollTop : 0;
    const scrollLeft = previous ? previous.scrollLeft : 0;
    ui.body.replaceChildren();

    if (session.status !== "ok") return;
    if (!state.model) {
      ui.body.appendChild(
        el(
          "p",
          "stats-loading",
          state.loading
            ? "Loading…"
            : state.mode === "mine"
              ? "You have no bookings this week."
              : "No bookable resources found for this category.",
        ),
      );
      return;
    }

    const model = state.model;
    const count = model.resources.length;
    const selectedDate = selectedDay();
    const days = state.viewMode === "day"
      ? model.days.filter((day) => day.key === dayKey(selectedDate))
      : W.visibleDays(model.days);
    const colorsEnabled = state.settings?.machineColors !== false;
    const colors = colorsEnabled ? W.machineColorMap(state.allResources) : null;
    const scroll = el("div", "wg-scroll");
    scroll.style.setProperty("--wg-count", String(count));
    scroll.style.setProperty("--wg-days", String(days.length));
    scroll.style.setProperty(
      "--wg-units",
      String(Math.max(
        1,
        ...days.map((day) => day.columns.reduce((sum, column) => sum + column.visibleLanes, 0)),
      )),
    );
    // Tall enough for the longest name, so "Prusa - MK4 Enclosure 1" and "… 2"
    // do not both end up as "Prusa - MK4 Enc…".
    const longest = model.resources.reduce((max, resource) => Math.max(max, resource.name.length), 0);
    scroll.style.setProperty("--wg-names", `${Math.min(14, Math.max(6.5, 1 + longest * 0.42)).toFixed(1)}rem`);
    if (count === 1) scroll.classList.add("is-single");
    if (count <= 2) scroll.classList.add("is-wide");
    if (colorsEnabled) scroll.classList.add("has-machine-colors");
    scroll.style.setProperty("--wg-hours", String(model.hourTo - model.hourFrom));
    if (state.loading) scroll.classList.add("is-loading");

    const grid = el("div", "wg");

    const head = el("div", "wg-head");
    head.appendChild(el("div", "wg-corner"));
    for (const day of days) head.appendChild(dayHeader(day, model, colors));

    const body = el("div", "wg-cols");
    body.appendChild(axis(model));
    for (const day of days) body.appendChild(dayColumns(day, model, colors));

    grid.append(head, body);
    scroll.appendChild(grid);
    ui.body.appendChild(scroll);
    scroll.scrollTop = scrollTop;
    scroll.scrollLeft = scrollLeft;

    const hint = el(
      "p",
      "wg-hint",
      `Click free space to book, or one of your own bookings to cancel it.${
        model.resources.some((resource) => resource.allocation > 1)
          ? " Each day shows peak concurrent usage plus one spare lane where capacity permits; lanes are shared capacity, not numbered physical machines."
          : ""
      }`,
    );
    ui.body.appendChild(hint);
  }

  function dayClasses(day) {
    return [day.isToday ? "is-today" : "", day.isWeekend ? "is-weekend" : "", day.isPast ? "is-past" : ""]
      .filter(Boolean)
      .join(" ");
  }

  function dayHeader(day, model, colors) {
    const node = el("div", `wg-dayhead ${dayClasses(day)}`.trim());
    const label = el("div", "wg-daylabel");
    label.append(el("span", "wg-weekday", WEEKDAY.format(day.date)), el("span", "wg-date", DAY_NUMBER.format(day.date)));
    node.appendChild(label);

    const names = el("div", "wg-names");
    names.style.gridTemplateColumns = resourceTracks(day.columns);
    for (const [index, resource] of model.resources.entries()) {
      const column = day.columns[index];
      const visibleLanes = column?.visibleLanes || 1;
      const name = el("span", "wg-name");
      const capacity = Number(resource.allocation) > 1 ? Math.floor(Number(resource.allocation)) : 1;
      const laneLabel = visibleLanes === 1 ? "lane" : "lanes";
      name.title = capacity > 1
        ? `${resource.name} · ${capacity} bookable units · showing ${visibleLanes} ${laneLabel} (peak usage plus spare where capacity permits)`
        : resource.name;
      name.append(el("span", null, capacity > 1 ? `${resource.name} · ${capacity} units` : resource.name));
      applyMachineColor(name, resource.id, colors);
      names.appendChild(name);
    }
    node.appendChild(names);
    return node;
  }

  function axis(model) {
    const node = el("div", "wg-axis");
    for (const hour of model.hours) {
      const label = el("span", "wg-hour", hour.label);
      node.appendChild(label);
    }
    return node;
  }

  function dayColumns(day, model, colors) {
    const node = el("div", `wg-day ${dayClasses(day)}`.trim());
    node.style.gridTemplateColumns = resourceTracks(day.columns);

    for (const event of day.events) {
      const band = el("div", "wg-event");
      band.style.top = `${event.top}%`;
      band.style.height = `${event.height}%`;
      band.title = `${CLOCK.format(new Date(event.start))} ${event.name}`.trim();
      node.appendChild(band);
    }

    for (const column of day.columns) {
      const cell = el("div", "wg-col");
      cell.dataset.resourceId = column.resourceId;
      if (column.visibleLanes > 1) {
        cell.classList.add("has-capacity");
        cell.style.setProperty("--wg-capacity", column.visibleLanes);
        for (let lane = 1; lane < column.visibleLanes; lane += 1) {
          const divider = el("span", "wg-capacity-divider");
          divider.style.left = `${(lane / column.visibleLanes) * 100}%`;
          cell.appendChild(divider);
        }
      }
      applyMachineColor(cell, column.resourceId, colors);
      ui.cells.set(cell, { day, column });

      for (const block of column.blocks) cell.appendChild(blockNode(block, column));

      cell.addEventListener("click", onCellClick);
      cell.addEventListener("pointermove", onCellPointerMove);
      cell.addEventListener("pointerleave", hideGhost);
      node.appendChild(cell);
    }

    if (day.isToday) {
      const position = nowPosition(day, model);
      if (position != null) {
        const line = el("div", "wg-now");
        line.style.top = `${position}%`;
        node.appendChild(line);
      }
    }
    return node;
  }

  function nowPosition(day, model) {
    const hours = (Date.now() - day.date.getTime()) / 3600000;
    if (hours < model.hourFrom || hours > model.hourTo) return null;
    return ((hours - model.hourFrom) / (model.hourTo - model.hourFrom)) * 100;
  }

  function resourceTracks(resources) {
    return resources
      .map((resource) => `${Math.max(1, Number(resource.visibleLanes ?? resource.capacity ?? resource.allocation) || 1)}fr`)
      .join(" ");
  }

  function applyMachineColor(node, resourceId, colors) {
    const color = colors?.get(String(resourceId));
    if (!color) return;
    node.classList.add("is-machine-colored");
    node.style.setProperty("--wg-machine-color", `var(--wg-family-${color.paletteIndex})`);
    node.style.setProperty("--wg-machine-shade", `${color.shade}%`);
  }

  function range(block) {
    return `${CLOCK.format(new Date(block.rawStart))}–${CLOCK.format(new Date(block.rawEnd))}`;
  }

  function blockNode(block, column) {
    const node = el("div", "wg-block");
    node.style.top = `${block.top}%`;
    node.style.height = `${block.height}%`;
    if (block.lanes > 1) {
      node.style.left = `calc(${(block.lane / block.lanes) * 100}% + 1px)`;
      node.style.right = `calc(${((block.lanes - block.lane - block.unitCount) / block.lanes) * 100}% + 1px)`;
    }
    node.dataset.blockId = block.id;

    const classes = [];
    if (block.mine) classes.push("is-mine");
    if (block.linked) classes.push("is-linked");
    if (block.reserved) classes.push("is-reserved");
    if (block.rawStart < block.start) classes.push("continues-before");
    if (block.rawEnd > block.end) classes.push("continues-after");
    node.classList.add(...classes);

    const parts = [column.name, range(block)];
    if (block.name) parts.push(block.name);
    if (block.mine && !block.reserved) parts.push("your booking");
    if (block.count > 1) parts.push(`${block.count} bookings in this slot`);
    if (block.linked) parts.push("linked: booked on a connected machine, which blocks this one too");
    node.title = parts.join(" · ");

    const label = [CLOCK.format(new Date(block.rawStart)), block.name, block.count > 1 ? `×${block.count}` : ""]
      .filter(Boolean)
      .join(" ");
    node.appendChild(el("span", "wg-block-name", label));
    return node;
  }

  /* ------------------------------------------------------------------ *
   * Interaction
   * ------------------------------------------------------------------ */

  function stampAt(cell, event, entry) {
    const rect = cell.getBoundingClientRect();
    if (!rect.height) return null;
    const fraction = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const model = state.model;
    const hours = model.hourFrom + fraction * (model.hourTo - model.hourFrom);
    return entry.day.date.getTime() + hours * 3600000;
  }

  function snapMinutes() {
    return Number(cfg.overview?.booking?.slotSnapMinutes) || 15;
  }

  function slotFor(cell, event) {
    const entry = ui.cells.get(cell);
    if (!entry || !state.model) return null;
    const stamp = stampAt(cell, event, entry);
    if (stamp == null) return null;
    const rect = cell.getBoundingClientRect();
    const laneCount = Math.max(1, Number(entry.column.visibleLanes) || 1);
    // The preview follows the visible capacity lane under the pointer.
    const fraction = rect.width
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0;
    const laneIndex = Math.min(laneCount - 1, Math.floor(fraction * laneCount));
    return {
      entry,
      laneIndex,
      laneCount,
      slot: W.slotAt(entry.column, stamp, { snapMinutes: snapMinutes() }),
    };
  }

  function onCellPointerMove(event) {
    const cell = event.currentTarget;
    if (event.target.closest?.(".wg-block")) {
      hideGhost();
      return;
    }
    const hit = slotFor(cell, event);
    if (!hit || hit.slot.occupied || hit.slot.past) {
      hideGhost();
      return;
    }

    const model = state.model;
    const windowMs = (model.hourTo - model.hourFrom) * 3600000;
    const base = hit.entry.day.date.getTime() + model.hourFrom * 3600000;
    const length = Math.min(hit.slot.gapMinutes, snapMinutes()) * 60000;
    if (!ui.ghost) ui.ghost = el("div", "wg-ghost");
    if (ui.ghost.parentNode !== cell) cell.appendChild(ui.ghost);
    ui.ghost.style.left = `calc(${(hit.laneIndex / hit.laneCount) * 100}% + 1px)`;
    ui.ghost.style.right = `calc(${((hit.laneCount - hit.laneIndex - 1) / hit.laneCount) * 100}% + 1px)`;
    ui.ghost.style.top = `${((hit.slot.start - base) / windowMs) * 100}%`;
    ui.ghost.style.height = `${(length / windowMs) * 100}%`;
    ui.ghost.title = `Book from ${CLOCK.format(new Date(hit.slot.start))}${
      hit.slot.capacity > 1 ? ` · ${hit.slot.availableUnits} of ${hit.slot.capacity} units available` : ""
    }`;
  }

  function hideGhost() {
    ui.ghost?.remove();
  }

  function onCellClick(event) {
    const cell = event.currentTarget;
    const hit = slotFor(cell, event);
    if (!hit) return;
    const { entry, slot } = hit;
    const name = entry.column.name;
    const clickedBlock = event.target.closest?.(".wg-block");
    const targetBlock = clickedBlock
      ? entry.column.blocks.find((block) => block.id === clickedBlock.dataset.blockId)
      : null;
    if (clickedBlock && !targetBlock) return;

    const occupied = targetBlock || slot.occupied;
    if (occupied) {
      if (!occupied.mine || occupied.reserved) return;
      if (occupied.rawStart <= Date.now()) {
        state.notice = "That booking already started and can't be cancelled here.";
        renderNotice(currentSession());
        return;
      }
      openCancel(occupied, entry);
      return;
    }

    if (slot.past) {
      state.notice = "That time has already passed.";
      renderNotice(currentSession());
      return;
    }

    state.notice = "";
    renderNotice(currentSession());
    hideGhost();
    dialogs.openBooking({
      resourceId: entry.column.resourceId,
      resourceName: name,
      startStamp: slot.start,
      gapMs: slot.gapMinutes * 60000,
    });
  }

  function openCancel(block, entry) {
    const start = new Date(block.rawStart);
    const end = new Date(block.rawEnd);
    const pad = (value) => String(value).padStart(2, "0");
    dialogs.openCancel({
      resourceName: entry.column.name,
      booking: {
        id: block.id,
        resourceId: block.resourceId,
        resourceName: entry.column.name,
        day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
        startTime: CLOCK.format(start),
        endTime: CLOCK.format(end),
        stamp: block.rawStart,
      },
    });
  }
})();
