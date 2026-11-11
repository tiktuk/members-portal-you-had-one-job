/* global chrome, OneJobConfig, OneJobUrl, OneJobOverview, OneJobGroups, OneJobStats */

/**
 * The resource statistics screen. Mounted into the in-portal overlay by
 * content.js; the markup lives in a shadow root so its generic class names
 * cannot collide with the portal's Bootstrap styles.
 */
(() => {
  "use strict";

  const cfg = OneJobConfig;
  const U = OneJobUrl;
  const O = OneJobOverview;
  const G = OneJobGroups;
  const S = OneJobStats;

  const REFRESH_LABEL = "Refresh";
  const BAND_LABELS = ["No bookings", "Quiet", "Moderate", "Busy", "Very busy"];
  const HEAT_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function emptyState() {
    return {
      session: null,
      cachedGroups: null,
      resources: [],
      months: {},
      period: cfg.stats?.defaultPeriod || "12m",
      periodInfo: null,
      /** { type, group, label } when opened from a menu group. */
      scope: null,
      type: "all",
      sort: "busy",
      loading: false,
      loadingMonths: { done: 0, total: 0 },
      failedMonths: [],
      error: null,
      resourcesError: null,
      updatedAt: null,
      webAddress: cfg.portal.webAddress,
      origin: cfg.portal.origin,
      model: null,
      heat: null,
    };
  }

  const state = emptyState();

  const ui = {
    root: null,
    doc: null,
    onClose: null,
    summary: null,
    notice: null,
    body: null,
    refreshButton: null,
    periodButtons: [],
    timer: 0,
    onStorageChanged: null,
    controller: null,
  };

  globalThis.OneJobStatsView = { mount, destroy };

  function mount(root, options = {}) {
    destroy();

    ui.root = root;
    ui.doc = root.ownerDocument;
    ui.onClose = typeof options.onClose === "function" ? options.onClose : null;
    state.scope = normalizeScope(options.scope);

    root.classList.add("overview", "stats", "is-panel");
    root.replaceChildren(buildShell());

    start();
    return { refresh: () => load({ force: true }), destroy };
  }

  function normalizeScope(scope) {
    if (!scope || typeof scope !== "object") return null;
    const type = String(scope.type || "");
    const group = String(scope.group || "");
    if (!type && !group) return null;
    return {
      type,
      group,
      label: String(scope.label || group || type),
    };
  }

  function destroy() {
    if (ui.timer) {
      clearTimeout(ui.timer);
      ui.timer = 0;
      // Keep the months fetched before the screen was closed.
      saveCache();
    }
    if (ui.controller) ui.controller.abort();
    if (ui.onStorageChanged && typeof chrome?.storage?.onChanged?.removeListener === "function") {
      chrome.storage.onChanged.removeListener(ui.onStorageChanged);
    }
    if (ui.root) ui.root.replaceChildren();

    ui.root = null;
    ui.doc = null;
    ui.onClose = null;
    ui.summary = null;
    ui.notice = null;
    ui.body = null;
    ui.refreshButton = null;
    ui.periodButtons = [];
    ui.timer = 0;
    ui.onStorageChanged = null;
    ui.controller = null;

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

  function buildShell() {
    const fragment = ui.doc.createDocumentFragment();

    const header = el("header", "page-header");
    const heading = el("div", "page-heading");
    heading.appendChild(el("h1", null, cfg.stats?.label || "Resource statistics"));
    if (state.scope) heading.appendChild(el("p", "stats-scope", state.scope.label));
    ui.summary = el("p", "summary", "Loading…");
    ui.summary.setAttribute("aria-live", "polite");
    heading.appendChild(ui.summary);

    const actions = el("div", "actions");

    const periods = el("div", "stats-periods");
    periods.setAttribute("role", "group");
    periods.setAttribute("aria-label", "Period");
    ui.periodButtons = S.PERIODS.map((period) => {
      const button = el("button", "button stats-period", period.label);
      button.type = "button";
      button.dataset.period = period.id;
      button.setAttribute("aria-pressed", String(period.id === state.period));
      button.addEventListener("click", () => {
        if (state.period === period.id) return;
        state.period = period.id;
        state.periodInfo = S.periodFor(state.period, new Date());
        buildModel();
        render();
        load();
      });
      periods.appendChild(button);
      return button;
    });
    actions.appendChild(periods);

    ui.refreshButton = el("button", "button", REFRESH_LABEL);
    ui.refreshButton.type = "button";
    ui.refreshButton.addEventListener("click", () => load({ force: true }));
    actions.appendChild(ui.refreshButton);

    const close = el("button", "button button-icon", "×");
    close.type = "button";
    close.title = "Close statistics";
    close.setAttribute("aria-label", "Close statistics");
    close.addEventListener("click", () => ui.onClose?.());
    actions.appendChild(close);

    header.append(heading, actions);

    const main = el("main");
    ui.notice = el("div", "notice");
    ui.notice.hidden = true;
    ui.notice.setAttribute("role", "status");
    ui.body = el("div", "stats-body");
    main.append(ui.notice, ui.body);

    fragment.append(header, main);
    return fragment;
  }

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */

  async function start() {
    [state.session, state.cachedGroups] = await Promise.all([
      get(cfg.storageKeys.session),
      get(cfg.storageKeys.groups),
    ]);
    if (!ui.root) return;

    state.resources = Array.isArray(state.cachedGroups?.resources) ? state.cachedGroups.resources : [];
    state.webAddress = state.session?.webAddress || cfg.portal.webAddress;
    state.origin = state.session?.origin || cfg.portal.origin;

    ui.onStorageChanged = onStorageChanged;
    chrome.storage.onChanged.addListener(onStorageChanged);

    render();
    await load();
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !ui.root) return;
    let reload = false;

    if (changes[cfg.storageKeys.session]) {
      state.session = changes[cfg.storageKeys.session].newValue || null;
      state.webAddress = state.session?.webAddress || cfg.portal.webAddress;
      state.origin = state.session?.origin || cfg.portal.origin;
      reload = true;
    }

    if (changes[cfg.storageKeys.groups]) {
      state.cachedGroups = changes[cfg.storageKeys.groups].newValue || null;
      if (!state.resources.length && Array.isArray(state.cachedGroups?.resources)) {
        state.resources = state.cachedGroups.resources;
        buildModel();
        render();
      }
    }

    if (reload) load();
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

  async function load({ force = false } = {}) {
    if (!ui.root) return;
    if (ui.controller) ui.controller.abort();
    const controller = new AbortController();
    ui.controller = controller;

    const session = currentSession();
    state.loading = true;
    state.error = null;
    state.resourcesError = null;
    state.failedMonths = [];
    state.loadingMonths = { done: 0, total: 0 };
    state.periodInfo = S.periodFor(state.period, new Date());
    render();

    if (session.status !== "ok") {
      state.loading = false;
      state.model = null;
      state.heat = null;
      render();
      return;
    }

    const period = state.periodInfo;

    try {
      const cache = await readCache();
      if (!ui.root || controller.signal.aborted) return;
      state.months = { ...cache.months, ...state.months };

      const resourcesPromise = !state.resources.length || force
        ? loadResources(session, controller)
        : Promise.resolve();

      const keys = S.monthKeys(period.start, period.end);
      const now = Date.now();
      const toFetch = keys.filter((key) => force || isStale(key, state.months[key], now));
      state.loadingMonths = { done: 0, total: toFetch.length };
      buildModel();
      render();

      await Promise.all([
        resourcesPromise,
        toFetch.length ? fetchMonths(session, period, toFetch, controller) : Promise.resolve(),
      ]);
      if (!ui.root || controller.signal.aborted) return;

      const newest = newestFetchedAt(period);
      state.updatedAt = newest ? new Date(newest) : new Date();
      state.loading = false;
      buildModel();
      render();
      scheduleSave();
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
      state.loading = false;
      buildModel();
      render();
    }
  }

  async function loadResources(session, controller) {
    try {
      const url = `${U.apiBaseUrl(session.webAddress)}${cfg.api.resourcesPath}`;
      const payload = await fetchJson(session, url, controller.signal);
      const resources = G.resourceListFromPayload(payload);
      if (!resources.length) throw new Error("The portal returned no published resources.");
      state.resources = resources;
      state.resourcesError = null;
    } catch (error) {
      if (controller.signal.aborted) return;
      state.resourcesError = error;
      if (!state.resources.length && Array.isArray(state.cachedGroups?.resources)) {
        state.resources = state.cachedGroups.resources;
      }
    }

    if (!ui.root || controller.signal.aborted) return;
    buildModel();
    render();
  }

  async function fetchMonths(session, period, keys, controller) {
    let index = 0;
    let stop = false;

    const worker = async () => {
      while (!stop && !controller.signal.aborted) {
        const key = keys[index];
        index += 1;
        if (!key) return;

        try {
          const entry = await fetchMonth(session, key, period, controller);
          if (!ui.root || controller.signal.aborted) return;
          state.months[key] = entry;
          state.loadingMonths.done += 1;
          buildModel();
          render();
          scheduleSave();
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error.code === "session-expired") {
            state.error = error;
            stop = true;
            return;
          }
          state.failedMonths.push(key);
          state.loadingMonths.done += 1;
          render();
        }
      }
    };

    const count = Math.min(Math.max(1, Number(cfg.stats?.concurrency) || 3), keys.length);
    await Promise.all(Array.from({ length: count }, worker));
  }

  async function fetchMonth(session, key, period, controller) {
    const start = S.monthStart(key);
    const end = new Date(Math.min(S.nextMonthStart(key).getTime(), period.end.getTime()));
    if (start.getTime() >= end.getTime()) {
      return { fetchedAt: Date.now(), records: [] };
    }

    const payload = await fetchCalendar(session, start, end, controller.signal);
    return {
      fetchedAt: Date.now(),
      records: S.normalizeRecords(payload, O.parseTimestamp),
    };
  }

  async function fetchCalendar(session, start, end, signal) {
    const params = new URLSearchParams({
      start: O.toPortalIso(start),
      end: O.toPortalIso(end),
      showAll: "",
    });
    const url = `${U.apiBaseUrl(session.webAddress)}/en/bookings/fullCalendarBookings?${params.toString()}`;
    const payload = await fetchJson(session, url, signal);
    if (!Array.isArray(payload)) throw new Error("Unexpected calendar response.");
    return payload;
  }

  async function fetchJson(session, url, signal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.api.timeoutMs || 15000);
    const abort = () => controller.abort();

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abort, { once: true });
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          "x-nx-app-name": "portal",
          "X-Use-Timezone": "true",
        },
      });

      if (response.status === 401 || response.status === 403) {
        const error = new Error("Your portal session expired.");
        error.code = "session-expired";
        throw error;
      }
      if (!response.ok) throw new Error(`The portal returned HTTP ${response.status}.`);

      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        if (signal?.aborted) throw error;
        throw new Error("The request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }

  async function readCache() {
    const stored = await get(cfg.storageKeys.statsCache);
    const version = cfg.cache?.statsVersion || 1;
    if (!stored || stored.version !== version) return { months: {} };
    if (stored.webAddress && stored.webAddress !== state.webAddress) return { months: {} };

    const months = {};
    for (const [key, entry] of Object.entries(stored.months || {})) {
      if (!entry || !Array.isArray(entry.records)) continue;
      months[key] = {
        fetchedAt: Number(entry.fetchedAt) || 0,
        records: entry.records
          .filter(isValidRecord)
          .map(([id, resourceId, start, end]) => ({
            id: String(id),
            resourceId: String(resourceId),
            start: Number(start),
            end: Number(end),
          })),
      };
    }
    return { months };
  }

  function isValidRecord(record) {
    return (
      Array.isArray(record) &&
      record.length >= 4 &&
      record[0] != null &&
      record[1] != null &&
      Number.isFinite(Number(record[2])) &&
      Number.isFinite(Number(record[3]))
    );
  }

  function isStale(key, entry, now) {
    if (!entry || !Array.isArray(entry.records)) return true;
    const current = S.monthKey(new Date());
    const ttl = key === current
      ? Number(cfg.stats?.cacheTtlMs) || 15 * 60 * 1000
      : Number(cfg.stats?.pastCacheTtlMs) || 24 * 60 * 60 * 1000;
    return now - (Number(entry.fetchedAt) || 0) > ttl;
  }

  function scheduleSave() {
    if (ui.timer) clearTimeout(ui.timer);
    ui.timer = setTimeout(() => {
      ui.timer = 0;
      saveCache();
    }, 300);
  }

  function saveCache() {
    if (!ui.root || !state.webAddress) return;

    const pruned = pruneMonths(state.months);
    const months = {};
    for (const [key, entry] of Object.entries(pruned)) {
      months[key] = {
        fetchedAt: entry.fetchedAt,
        records: entry.records.map(compactRecord),
      };
    }

    set(cfg.storageKeys.statsCache, {
      version: cfg.cache?.statsVersion || 1,
      webAddress: state.webAddress,
      months,
    });
  }

  function pruneMonths(months) {
    const keys = Object.keys(months || {}).sort();
    const keep = new Set(keys.slice(-13));
    const pruned = {};
    for (const key of keys) {
      if (keep.has(key)) pruned[key] = months[key];
    }

    const maxBytes = Number(cfg.stats?.maxCacheBytes) || 2000000;
    const oldest = keys.filter((key) => keep.has(key));
    let json = JSON.stringify(pruned);
    while (json.length > maxBytes && oldest.length > 1) {
      delete pruned[oldest.shift()];
      json = JSON.stringify(pruned);
    }
    return pruned;
  }

  function compactRecord(record) {
    if (Array.isArray(record)) return record;
    return [record.id, record.resourceId, record.start, record.end];
  }

  function recordsForPeriod(period) {
    const keys = S.monthKeys(period.start, period.end);
    const records = [];
    for (const key of keys) {
      const entry = state.months[key];
      if (entry && Array.isArray(entry.records)) records.push(...entry.records);
    }
    return records;
  }

  /** The newest fetch time among the months the period uses. */
  function newestFetchedAt(period) {
    let newest = 0;
    for (const key of S.monthKeys(period.start, period.end)) {
      const entry = state.months[key];
      if (entry) newest = Math.max(newest, Number(entry.fetchedAt) || 0);
    }
    return newest;
  }

  function buildModel() {
    const period = state.periodInfo || S.periodFor(state.period, new Date());
    state.periodInfo = period;
    const records = recordsForPeriod(period);
    const base = state.resources.length ? state.resources : deriveResources(records);
    const resources = S.filterResources(base, state.scope);
    state.model = S.aggregate(records, resources, period, { bands: cfg.stats?.bands });
    state.heat = S.heatmap(state.model, period);
  }

  function deriveResources(records) {
    const seen = new Map();
    for (const record of records) {
      if (!record.resourceId || seen.has(record.resourceId)) continue;
      seen.set(record.resourceId, {
        id: record.resourceId,
        name: `Resource ${record.resourceId}`,
        group: "",
        type: "other-resources",
      });
    }
    return [...seen.values()];
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function render() {
    if (!ui.root) return;
    const session = currentSession();

    ui.refreshButton.disabled = state.loading;
    ui.refreshButton.textContent = state.loading ? "Refreshing…" : REFRESH_LABEL;

    for (const button of ui.periodButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.period === state.period));
    }

    ui.summary.textContent = summaryText(session);
    renderNotice(session);
    renderBody(session);
  }

  function summaryText(session) {
    if (session.status === "missing") return "Not connected to the members portal";
    if (session.status === "expired") return "Your portal session expired";

    const period = S.periodLabel(state.period);
    const updated = updatedSuffix();
    if (state.loading && !state.model) return "Loading…";
    if (!state.model) return `${period} · loading…`;

    const totals = state.model.totals;
    const parts = [
      period,
      `${formatNumber(totals.bookings)} ${totals.bookings === 1 ? "booking" : "bookings"}`,
      S.formatHours(totals.hours),
    ];
    if (totals.resourceCount) {
      parts.push(`${totals.activeResources} of ${totals.resourceCount} resources booked`);
    }
    const progress = state.loadingMonths.total > state.loadingMonths.done
      ? ` · loading ${state.loadingMonths.done} of ${state.loadingMonths.total} months`
      : "";
    return `${parts.join(" · ")}${progress}${updated}`;
  }

  function updatedSuffix() {
    if (!state.updatedAt) return "";
    return ` · updated ${state.updatedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`;
  }

  function renderNotice(session) {
    if (session.status === "missing") {
      showNotice({
        title: "Connect to the members portal",
        message:
          "Open the portal once while signed in so the extension can use your session to load statistics.",
        linkLabel: "Open members portal ↗",
        href: `${portalOrigin()}/`,
      });
      return;
    }

    if (session.status === "expired") {
      showNotice({
        title: "Your portal session expired",
        message: "Open the members portal, then refresh this screen.",
        linkLabel: "Open members portal ↗",
        href: `${portalOrigin()}/`,
        error: true,
      });
      return;
    }

    if (state.error) {
      const expired = state.error.code === "session-expired";
      showNotice({
        title: expired ? "Your portal session expired" : "Couldn't load statistics",
        message: expired ? "Open the members portal, then refresh this screen." : state.error.message,
        linkLabel: "Open members portal ↗",
        href: `${portalOrigin()}/`,
        error: true,
      });
      return;
    }

    const warnings = [];
    if (state.resourcesError) warnings.push("the live resource list");
    if (state.failedMonths.length) {
      warnings.push(`bookings for ${state.failedMonths.map((key) => S.monthLabel(key)).join(", ")}`);
    }
    if (warnings.length) {
      showNotice({
        title: "Some data couldn't load",
        message: `Showing the rest of the statistics; ${warnings.join(" and ")} couldn't load.`,
        warning: true,
      });
      return;
    }

    hideNotice();
  }

  function showNotice({ title, message, linkLabel, href, error, warning }) {
    ui.notice.hidden = false;
    ui.notice.className = `notice${error ? " error" : warning ? " warning" : ""}`;
    ui.notice.replaceChildren();

    const heading = el("h2", null, title);
    const text = el("p", null, message);
    if (linkLabel && href) {
      text.append(" ");
      const link = el("a", null, linkLabel);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      text.append(link);
    }

    ui.notice.append(heading, text);
  }

  function hideNotice() {
    ui.notice.hidden = true;
    ui.notice.replaceChildren();
  }

  function renderBody(session) {
    ui.body.replaceChildren();
    if (session.status !== "ok") return;

    if (!state.model) {
      ui.body.appendChild(el("p", "stats-loading", state.loading ? "Loading bookings…" : "No data."));
      return;
    }

    const groups = groupResources(state.model.resources);
    if (state.type !== "all" && !groups.some((group) => group.slug === state.type)) {
      state.type = "all";
    }

    ui.body.append(
      summaryTiles(),
      heatmapSection(),
      chartsSection(),
      lengthsSection(),
      resourcesSection(groups),
      footerNote(),
    );
  }

  function summaryTiles() {
    const totals = state.model.totals;
    const busiest = state.model.busiest;
    const grid = el("div", "stats-tiles");

    grid.append(
      tile("Bookings", formatNumber(totals.bookings), S.periodLabel(state.period)),
      tile(
        "Booked hours",
        S.formatHours(totals.hours),
        state.scope ? "across this group" : "across all resources",
      ),
      tile("Average booking", totals.bookings ? S.formatHours(totals.avgHours) : "—", "per booking"),
      tile(
        "Active resources",
        totals.resourceCount ? `${totals.activeResources} of ${totals.resourceCount}` : "—",
        "booked at least once",
      ),
      tile(
        "Busiest weekday",
        busiest.weekday ? busiest.weekday.label : "—",
        busiest.weekday ? S.formatHours(busiest.weekday.hours) : "no bookings",
      ),
      tile(
        "Busiest time of day",
        busiest.hour ? `${busiest.hour.label}–${pad((busiest.hour.hour + 1) % 24)}:00` : "—",
        busiest.hour ? S.formatHours(busiest.hour.hours) : "no bookings",
      ),
    );

    return grid;
  }

  function tile(label, value, hint) {
    const node = el("div", "stats-tile");
    node.append(
      el("span", "stats-tile-label", label),
      el("strong", "stats-tile-value", value),
      el("span", "stats-tile-hint", hint),
    );
    return node;
  }

  function heatmapSection() {
    const section = el("section", "stats-section");
    const head = el("div", "stats-section-head");
    head.append(
      el("h2", null, "Bookings per day"),
      el(
        "p",
        "stats-section-note",
        state.scope
          ? "Booked hours for this group; darker means busier."
          : "Booked hours across every resource; darker means busier.",
      ),
    );
    section.appendChild(head);

    if (!state.model.totals.bookings) {
      section.appendChild(el("p", "stats-empty", "No bookings in this period."));
      return section;
    }

    const heat = state.heat;
    const wrap = el("div", "stats-heatmap");
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", heatSummary());

    const weekdays = el("div", "stats-heat-weekdays");
    weekdays.appendChild(el("span", "stats-heat-spacer"));
    for (const label of HEAT_WEEKDAYS) weekdays.appendChild(el("span", null, label));

    const weeks = el("div", "stats-heat-weeks");
    for (const week of heat.weeks) {
      const column = el("div", "stats-heat-week");
      column.appendChild(el("span", "stats-heat-month", week.month || ""));
      for (const day of week.days) {
        const cell = el(
          "span",
          `stats-heat-day${day.inPeriod ? ` stats-level-${day.level}` : " is-outside"}`,
        );
        if (day.inPeriod) cell.title = heatDayLabel(day);
        else cell.setAttribute("aria-hidden", "true");
        column.appendChild(cell);
      }
      weeks.appendChild(column);
    }

    wrap.append(weekdays, weeks);
    section.append(wrap, heatLegend());
    return section;
  }

  function heatLegend() {
    const legend = el("div", "stats-legend");
    legend.append(el("span", "stats-legend-label", "Less"));
    for (let level = 0; level <= 4; level += 1) {
      legend.appendChild(el("span", `stats-legend-swatch stats-level-${level}`));
    }
    legend.append(el("span", "stats-legend-label", "More"));
    return legend;
  }

  function heatDayLabel(day) {
    const date = day.date instanceof Date ? day.date : parseDayKey(day.key);
    const label = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
    return `${label} · ${plural(day.count, "booking")} · ${S.formatHours(day.hours)}`;
  }

  function heatSummary() {
    const totals = state.model.totals;
    const busiest = state.model.busiest.day;
    if (!busiest) return "No bookings in this period.";

    const label = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(parseDayKey(busiest.key));
    return `${formatNumber(totals.bookings)} ${totals.bookings === 1 ? "booking" : "bookings"} over ${totals.days} days. Busiest day: ${label} with ${S.formatHours(busiest.hours)}.`;
  }

  function chartsSection() {
    const section = el("section", "stats-section");
    const head = el("div", "stats-section-head");
    head.append(
      el("h2", null, state.scope ? "When these resources are busy" : "When the space is busy"),
      el("p", "stats-section-note", "Booked hours by weekday and time of day."),
    );

    const grid = el("div", "stats-chart-grid");
    grid.append(weekdayChart(), hourChart());
    section.append(head, grid);
    return section;
  }

  function weekdayChart() {
    const card = el("div", "stats-chart");
    card.appendChild(el("h3", null, "By weekday"));

    const max = Math.max(...state.model.weekdays.map((day) => day.hours), 0);
    if (!max) {
      card.appendChild(el("p", "stats-empty", "No bookings."));
      return card;
    }

    const items = state.model.weekdays.map((day) => ({
      ...day,
      title: `${day.label} · ${S.formatHours(day.hours)}`,
    }));
    card.appendChild(barChart(items, { max, showValues: true }));
    return card;
  }

  function hourChart() {
    const card = el("div", "stats-chart");
    card.appendChild(el("h3", null, "By time of day"));

    const max = Math.max(...state.model.hours.map((hour) => hour.hours), 0);
    if (!max) {
      card.appendChild(el("p", "stats-empty", "No bookings."));
      return card;
    }

    const items = state.model.hours.map((hour) => ({
      ...hour,
      index: hour.hour,
      title: `${hour.label}–${pad((hour.hour + 1) % 24)}:00 · ${S.formatHours(hour.hours)}`,
    }));
    card.appendChild(barChart(items, { max, showValues: false, labelEvery: 3 }));
    return card;
  }

  function barChart(items, { max, showValues, labelEvery = 1 }) {
    const bars = el("div", `stats-bars${items.length > 12 ? " stats-bars-24" : ""}`);
    bars.setAttribute("role", "img");
    bars.setAttribute(
      "aria-label",
      items.map((item) => `${item.label}: ${S.formatHours(item.hours)}`).join(", "),
    );

    for (const item of items) {
      const bar = el("div", "stats-bar");
      bar.title = item.title;

      if (showValues) {
        bar.appendChild(el("span", "stats-bar-value", formatNumber(Math.round(item.hours))));
      }

      const track = el("span", "stats-bar-track");
      const fill = el("span", "stats-bar-fill");
      fill.style.height = `${max > 0 && item.hours > 0 ? Math.max(2, (item.hours / max) * 100) : 0}%`;
      track.appendChild(fill);
      bar.appendChild(track);

      const showLabel = labelEvery <= 1 || item.index % labelEvery === 0;
      bar.appendChild(el("span", "stats-bar-label", showLabel ? item.label : ""));
      bars.appendChild(bar);
    }

    return bars;
  }

  function lengthsSection() {
    const section = el("section", "stats-section");
    const head = el("div", "stats-section-head");
    head.append(
      el("h2", null, "Booking length"),
      el("p", "stats-section-note", "How long a typical booking is."),
    );
    section.appendChild(head);

    const max = Math.max(...state.model.lengths.map((bucket) => bucket.count), 0);
    if (!max) {
      section.appendChild(el("p", "stats-empty", "No bookings in this period."));
      return section;
    }

    const list = el("div", "stats-lengths");
    for (const bucket of state.model.lengths) {
      const row = el("div", "stats-length");
      row.appendChild(el("span", "stats-length-label", bucket.label));

      const track = el("span", "stats-length-track");
      const fill = el("span", "stats-length-fill");
      fill.style.width = `${(bucket.count / max) * 100}%`;
      track.appendChild(fill);

      row.append(track, el("span", "stats-length-value", formatNumber(bucket.count)));
      list.appendChild(row);
    }

    section.appendChild(list);
    return section;
  }

  function resourcesSection(groups) {
    const section = el("section", "stats-section stats-resources");
    const head = el("div", "stats-section-head");
    head.append(
      el("h2", null, "How booked each resource is"),
      el("p", "stats-section-note", "Booked hours per day; darker tiles are busier."),
    );
    section.appendChild(head);

    if (!state.model.resources.length) {
      section.appendChild(
        el(
          "p",
          "stats-empty",
          state.resourcesError
            ? "The resource list couldn't load. Open the portal and try Refresh."
            : "No published resources found.",
        ),
      );
      return section;
    }

    section.appendChild(resourceControls(groups));
    section.appendChild(resourceLegend());

    for (const group of groups) {
      if (state.type !== "all" && group.slug !== state.type) continue;
      section.appendChild(typeSection(group));
    }

    return section;
  }

  function resourceControls(groups) {
    const controls = el("div", "stats-controls");

    // A group-scoped screen is already filtered by the menu, so the type
    // chips would only repeat the scope.
    if (!state.scope) {
      const filters = el("div", "stats-filters");
      filters.setAttribute("role", "group");
      filters.setAttribute("aria-label", "Resource type");

      const all = el("button", "button stats-filter", `All resources ${state.model.resources.length}`);
      all.type = "button";
      all.dataset.type = "all";
      all.setAttribute("aria-pressed", String(state.type === "all"));
      all.addEventListener("click", () => {
        state.type = "all";
        render();
      });
      filters.appendChild(all);

      for (const group of groups) {
        const button = el("button", "button stats-filter", `${group.label} ${group.resources.length}`);
        button.type = "button";
        button.dataset.type = group.slug;
        button.setAttribute("aria-pressed", String(state.type === group.slug));
        button.addEventListener("click", () => {
          state.type = group.slug;
          render();
        });
        filters.appendChild(button);
      }
      controls.appendChild(filters);
    }

    const sort = el("div", "stats-sort");
    sort.setAttribute("role", "group");
    sort.setAttribute("aria-label", "Sort resources");
    for (const [id, label] of [["busy", "Busiest first"], ["name", "Name A–Z"]]) {
      const button = el("button", "button stats-filter", label);
      button.type = "button";
      button.dataset.sort = id;
      button.setAttribute("aria-pressed", String(state.sort === id));
      button.addEventListener("click", () => {
        state.sort = id;
        render();
      });
      sort.appendChild(button);
    }
    controls.appendChild(sort);

    return controls;
  }

  function resourceLegend() {
    const legend = el("div", "stats-legend stats-resource-legend");
    const bands = cfg.stats?.bands || [0.5, 1.5, 3];
    const labels = [
      "none",
      `≤${bands[0]} h/day`,
      `≤${bands[1]} h/day`,
      `≤${bands[2]} h/day`,
      `>${bands[2]} h/day`,
    ];

    legend.append(el("span", "stats-legend-label", "Less booked"));
    for (let band = 0; band <= 4; band += 1) {
      const item = el("span", "stats-legend-item");
      item.append(
        el("span", `stats-legend-swatch stats-band-${band}`),
        el("span", "stats-legend-text", labels[band]),
      );
      legend.appendChild(item);
    }
    legend.append(el("span", "stats-legend-label", "More booked"));
    return legend;
  }

  function groupResources(resources) {
    const byType = new Map();
    for (const resource of resources) {
      const slug = resource.type || "other-resources";
      if (!byType.has(slug)) byType.set(slug, []);
      byType.get(slug).push(resource);
    }

    const order = Array.isArray(cfg.resourceTypeOrder) ? cfg.resourceTypeOrder : [];
    const slugs = [...byType.keys()].sort((a, b) => {
      const left = order.indexOf(a);
      const right = order.indexOf(b);
      if (left !== right) {
        return (left === -1 ? order.length : left) - (right === -1 ? order.length : right);
      }
      return G.typeLabel(a).localeCompare(G.typeLabel(b));
    });

    return slugs.map((slug) => {
      const list = byType.get(slug).slice();
      if (state.sort === "name") {
        list.sort((a, b) => a.name.localeCompare(b.name));
      } else {
        list.sort((a, b) => b.rate - a.rate || b.bookings - a.bookings || a.name.localeCompare(b.name));
      }

      const hours = list.reduce((sum, resource) => sum + resource.hours, 0);
      const bookings = list.reduce((sum, resource) => sum + resource.bookings, 0);
      const share = state.model.totals.hours > 0 ? hours / state.model.totals.hours : 0;
      return { slug, label: G.typeLabel(slug), resources: list, hours, bookings, share };
    });
  }

  function typeSection(group) {
    const section = el("div", "stats-type");
    const head = el("div", "stats-type-head");
    head.appendChild(el("h3", null, group.label));

    const meta = [plural(group.resources.length, "resource"), S.formatHours(group.hours)];
    // On a scoped screen every booking belongs to the scope, so the share
    // would always be 100%.
    if (!state.scope) meta.push(`${Math.round(group.share * 100)}% of booked hours`);
    head.appendChild(el("p", "stats-type-meta", meta.join(" · ")));
    section.appendChild(head);

    const grid = el("div", "stats-grid");
    for (const resource of group.resources) grid.appendChild(resourceTile(resource));
    section.appendChild(grid);
    return section;
  }

  function resourceTile(resource) {
    const tile = el("a", `stats-resource stats-band-${resource.band}`);
    tile.href = calendarHref(resource);
    tile.target = "_blank";
    tile.rel = "noopener";

    const name = resource.name || `Resource ${resource.id}`;
    const group = displayGroup(resource.group) || G.typeLabel(resource.type);
    const bandLabel = BAND_LABELS[resource.band] || "";
    tile.title = `${name} · ${S.formatRate(resource.rate)} · ${plural(resource.bookings, "booking")} · ${S.formatHours(resource.hours)}`;
    tile.setAttribute(
      "aria-label",
      `${name}, ${group}: ${S.formatRate(resource.rate)}, ${plural(resource.bookings, "booking")}, ${S.formatHours(resource.hours)}. ${bandLabel}.`,
    );

    const icon = el("span", `resource-icon type-${typeClass(resource.type)} stats-resource-icon`);
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = O.resourceIcon(resource) || firstLetter(name);
    tile.appendChild(icon);

    const body = el("span", "stats-resource-body");
    body.appendChild(el("span", "stats-resource-name", name));
    body.appendChild(el("span", "stats-resource-group", group));
    body.appendChild(el("span", "stats-resource-rate", S.formatRate(resource.rate)));
    body.appendChild(
      el(
        "span",
        "stats-resource-meta",
        `${plural(resource.bookings, "booking")} · ${S.formatHours(resource.hours)}`,
      ),
    );

    const bar = el("span", "stats-resource-bar");
    const fill = el("span");
    const maxRate = (cfg.stats?.bands?.[2] ?? 3) || 3;
    fill.style.width = `${Math.min(100, (resource.rate / maxRate) * 100)}%`;
    bar.appendChild(fill);
    body.appendChild(bar);

    tile.appendChild(body);
    return tile;
  }

  function calendarHref(resource) {
    const path = U.bookingHref({
      webAddress: state.webAddress,
      type: resource.type || "all",
      view: "calendar",
      group: resource.group,
      resource: resource.id,
    });
    return `${portalOrigin()}${path}`;
  }

  function footerNote() {
    return el(
      "p",
      "footer stats-footer",
      "Counts member bookings on published resources only; workshop reservations and Luma events are not included. Statistics are cached on this device without member names.",
    );
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function displayGroup(group) {
    return G.displayGroupName(group || "", cfg.nav?.stripGroupPrefix !== false);
  }

  function typeClass(type) {
    return String(type || "other").replace(/[^a-z0-9-]/gi, "") || "other";
  }

  function firstLetter(name) {
    return String(name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function plural(count, label) {
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-GB").format(Number(value) || 0);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseDayKey(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function get(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (result) => resolve(result[key])));
  }

  function set(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  }
})();
