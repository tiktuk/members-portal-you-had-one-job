/* global chrome, OneJobConfig, OneJobUrl, OneJobOverview */

/**
 * The pinned resources overview, shared by the standalone page (overview.html)
 * and the in-portal overlay opened from the Filters menu. Both mount the same
 * markup and stylesheet; only the surrounding shell differs.
 */
(() => {
  "use strict";

  const cfg = OneJobConfig;
  const U = OneJobUrl;
  const O = OneJobOverview;

  const REFRESH_MS = 60 * 1000;

  const PERSON_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>';

  function emptyState() {
    return {
      pins: [],
      session: null,
      settings: null,
      webAddress: cfg.portal.webAddress,
      /** Origin of the portal the session came from; absolute links use it. */
      origin: cfg.portal.origin,
      model: null,
      myModel: null,
      lumaEnabled: false,
      loading: false,
      error: null,
      eventsError: null,
      lumaError: null,
      myBookingsError: null,
      updatedAt: null,
    };
  }

  const state = emptyState();

  const ui = {
    root: null,
    doc: null,
    variant: "page",
    onClose: null,
    summary: null,
    notice: null,
    cards: null,
    myBookings: null,
    refreshButton: null,
    lumaButton: null,
    portalLink: null,
    timer: null,
    onStorageChanged: null,
  };

  globalThis.OneJobOverviewView = { mount, destroy };

  /**
   * Renders the overview into `root`.
   *   variant "page"  — standalone page: eyebrow, "Open portal" link, footer.
   *   variant "panel" — overlay: compact header with a close button.
   */
  function mount(root, options = {}) {
    destroy();

    ui.root = root;
    ui.doc = root.ownerDocument;
    ui.variant = options.variant === "panel" ? "panel" : "page";
    ui.onClose = typeof options.onClose === "function" ? options.onClose : null;

    root.classList.add("overview", ui.variant === "panel" ? "is-panel" : "is-page");
    root.replaceChildren(buildShell());

    start();
    return { refresh: () => load(), destroy };
  }

  function destroy() {
    if (ui.timer) clearInterval(ui.timer);
    if (ui.onStorageChanged && typeof chrome?.storage?.onChanged?.removeListener === "function") {
      chrome.storage.onChanged.removeListener(ui.onStorageChanged);
    }
    if (ui.root) ui.root.replaceChildren();

    ui.root = null;
    ui.doc = null;
    ui.onClose = null;
    ui.summary = null;
    ui.notice = null;
    ui.cards = null;
    ui.myBookings = null;
    ui.refreshButton = null;
    ui.lumaButton = null;
    ui.portalLink = null;
    ui.timer = null;
    ui.onStorageChanged = null;

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
    if (ui.variant === "page") heading.appendChild(el("p", "eyebrow", "Nexudus, you had one job"));
    heading.appendChild(el("h1", null, "Pinned resources"));
    ui.summary = el("p", "summary", "Loading…");
    heading.appendChild(ui.summary);

    const actions = el("div", "actions");

    if (cfg.luma?.source) {
      ui.lumaButton = el("button", "button button-toggle", "Events");
      ui.lumaButton.type = "button";
      ui.lumaButton.setAttribute("aria-pressed", "false");
      ui.lumaButton.hidden = !lumaAvailable();
      ui.lumaButton.addEventListener("click", toggleLumaEvents);
      actions.appendChild(ui.lumaButton);
    }

    ui.refreshButton = el("button", "button", "Refresh");
    ui.refreshButton.type = "button";
    ui.refreshButton.addEventListener("click", () => load({ force: true }));
    actions.appendChild(ui.refreshButton);

    if (ui.variant === "page") {
      ui.portalLink = el("a", "button button-ghost", "Open portal ↗");
      ui.portalLink.href = `${portalOrigin()}/`;
      ui.portalLink.target = "_blank";
      ui.portalLink.rel = "noopener";
      actions.appendChild(ui.portalLink);
    } else {
      const close = el("button", "button button-icon", "×");
      close.type = "button";
      close.title = "Close overview";
      close.setAttribute("aria-label", "Close overview");
      close.addEventListener("click", () => ui.onClose?.());
      actions.appendChild(close);
    }

    header.append(heading, actions);

    const main = el("main");
    ui.notice = el("div", "notice");
    ui.notice.hidden = true;
    ui.notice.setAttribute("role", "status");
    ui.myBookings = el("div", "my-bookings");
    ui.cards = el("div", "cards");
    ui.cards.setAttribute("aria-live", "polite");
    main.append(ui.notice, ui.myBookings, ui.cards);

    fragment.append(header, main);

    if (ui.variant === "page") {
      const footer = el("footer", "footer");
      footer.append(
        "Pins are managed from the ",
        el("strong", null, "Filters"),
        " menu in the members portal.",
      );
      fragment.appendChild(footer);
    }

    return fragment;
  }

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */

  async function start() {
    [state.pins, state.session, state.settings] = await Promise.all([
      get(cfg.storageKeys.pins),
      get(cfg.storageKeys.session),
      get(cfg.storageKeys.settings),
    ]);
    if (!ui.root) return;

    state.pins = O.normalizePins(state.pins);
    state.webAddress = state.session?.webAddress || state.webAddress;
    state.origin = state.session?.origin || state.origin;
    state.lumaEnabled = isLumaEnabled(state.settings);

    ui.onStorageChanged = onStorageChanged;
    chrome.storage.onChanged.addListener(onStorageChanged);

    render();
    await load();
    if (!ui.root) return;

    ui.timer = setInterval(() => {
      if (!ui.doc.hidden && !state.loading) load();
    }, REFRESH_MS);
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !ui.root) return;
    let reload = false;

    if (changes[cfg.storageKeys.pins]) {
      state.pins = O.normalizePins(changes[cfg.storageKeys.pins].newValue);
      state.model = null;
      reload = true;
    }
    if (changes[cfg.storageKeys.session]) {
      state.session = changes[cfg.storageKeys.session].newValue || null;
      state.webAddress = state.session?.webAddress || cfg.portal.webAddress;
      state.origin = state.session?.origin || cfg.portal.origin;
      reload = true;
    }
    if (changes[cfg.storageKeys.settings]) {
      state.settings = changes[cfg.storageKeys.settings].newValue || null;
      const enabled = isLumaEnabled(state.settings);
      if (enabled !== state.lumaEnabled) {
        state.lumaEnabled = enabled;
        reload = true;
      }
    }
    if (reload) load();
  }

  /**
   * Absolute links must point at the portal this overview is about. The overlay
   * runs inside that portal, so it can just read its own origin; the standalone
   * page uses the origin of the portal that last mirrored a session.
   */
  function portalOrigin() {
    if (ui.variant === "panel") {
      const origin = ui.doc?.defaultView?.location?.origin;
      if (origin && origin !== "null") return origin;
    }
    return state.origin || cfg.portal.origin;
  }

  /**
   * `config.luma.source` is the built-in portal's Luma calendar, so merging
   * events on another space would show the wrong space's events.
   */
  function lumaAvailable() {
    if (!cfg.luma?.source) return false;
    if (!cfg.portal?.origin) return true;
    return String(portalOrigin()).replace(/\/+$/, "") === cfg.portal.origin;
  }

  /** The popup toggle; `config.luma.enabled` is only the default. */
  function isLumaEnabled(settings) {
    if (!lumaAvailable()) return false;
    const stored = settings && typeof settings.lumaEvents === "boolean"
      ? settings.lumaEvents
      : cfg.luma.enabled !== false;
    return stored;
  }

  /**
   * The header's *Events* button and the popup switch write the same setting,
   * so every open overview and the popup stay in sync.
   */
  async function toggleLumaEvents() {
    const enabled = !state.lumaEnabled;
    state.lumaEnabled = enabled;
    state.settings = { ...(state.settings || {}), lumaEvents: enabled };
    render();

    await set(cfg.storageKeys.settings, state.settings);
    if (ui.root) load();
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

  async function load(options = {}) {
    if (!ui.root) return;

    const session = currentSession();
    if (session.status !== "ok") {
      state.loading = false;
      state.model = null;
      state.myModel = null;
      state.error = null;
      state.eventsError = null;
      state.lumaError = null;
      state.myBookingsError = null;
      render();
      return;
    }

    const hasPins = state.pins.length > 0;
    const lumaEnabled = state.lumaEnabled;
    state.loading = true;
    state.error = null;
    state.eventsError = null;
    state.lumaError = null;
    state.myBookingsError = null;
    render();

    try {
      const [myResult, bookingsResult, eventsResult, lumaResult] = await Promise.allSettled([
        fetchMyBookings(session),
        hasPins ? fetchBookings(session) : Promise.resolve([]),
        hasPins ? fetchEvents(session) : Promise.resolve([]),
        lumaEnabled ? fetchLumaEvents(Boolean(options.force)) : Promise.resolve([]),
      ]);
      if (!ui.root) return;

      const lumaEvents = lumaResult.status === "fulfilled" ? lumaResult.value : [];
      state.lumaError = lumaResult.status === "rejected" ? lumaResult.reason : null;

      state.myBookingsError = myResult.status === "rejected" ? myResult.reason : null;
      state.myModel =
        myResult.status === "fulfilled"
          ? O.buildMyBookings(myResult.value, new Date(), lumaEvents)
          : null;

      if (hasPins) {
        if (bookingsResult.status === "rejected") throw bookingsResult.reason;
        const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
        state.eventsError = eventsResult.status === "rejected" ? eventsResult.reason : null;
        state.model = O.buildModel(state.pins, bookingsResult.value, new Date(), events, lumaEvents);
        O.markOwnedBookings(state.model, state.myModel);
      } else {
        state.model = null;
      }

      state.updatedAt = new Date();
      state.webAddress = session.webAddress;
    } catch (error) {
      state.error = error;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function fetchBookings(session) {
    return fetchCalendar(session, "fullCalendarBookings");
  }

  async function fetchEvents(session) {
    return fetchCalendar(session, "fullCalendarEvents");
  }

  /**
   * Luma's public API only allows https://luma.com as a CORS origin, so both
   * the extension page and the in-portal overlay ask the background worker to
   * fetch it (the extension's host permission covers api.luma.com).
   */
  async function fetchLumaEvents(force) {
    const response = await sendMessage({ type: "onejob:luma-events", force });
    return Array.isArray(response.entries) ? response.entries : [];
  }

  function fetchLumaDescription(eventId) {
    return sendMessage({ type: "onejob:luma-description", eventId }).then(
      (response) => String(response.description || ""),
    );
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error("Luma events are unavailable."));
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || "Luma events are unavailable."));
          return;
        }
        if (!response) {
          reject(new Error("Luma events are unavailable."));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || "Luma request failed."));
          return;
        }
        resolve(response);
      });
    });
  }

  async function fetchCalendar(session, endpoint) {
    const { start, end } = O.rangeFor(new Date());
    const params = new URLSearchParams({
      start: O.toPortalIso(start),
      end: O.toPortalIso(end),
    });
    if (endpoint === "fullCalendarBookings") params.set("showAll", "");

    const url = `${U.apiBaseUrl(session.webAddress)}/en/bookings/${endpoint}?${params.toString()}`;
    const payload = await fetchJson(session, url);
    if (!Array.isArray(payload)) throw new Error("Unexpected calendar response.");
    return payload;
  }

  async function fetchMyBookings(session) {
    const { start, end } = O.rangeFor(new Date());
    const base = U.apiBaseUrl(session.webAddress);
    const records = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        from_Booking_FromTime: O.toQueryTimestamp(start),
        to_Booking_FromTime: O.toQueryTimestamp(end),
        orderBy: "FromTime",
        dir: "0",
        size: "100",
        page: String(page),
      });
      const payload = await fetchJson(session, `${base}/api/public/bookings/my?${params.toString()}`);
      if (!payload || !Array.isArray(payload.Records)) {
        throw new Error("Unexpected bookings response.");
      }
      records.push(...payload.Records);
      if (!payload.HasNextPage || page >= 20) break;
      page += 1;
    }

    return records;
  }

  async function fetchJson(session, url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.api.timeoutMs || 15000);
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
      if (error.name === "AbortError") throw new Error("The request timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function render() {
    if (!ui.root) return;

    const session = currentSession();
    ui.refreshButton.disabled = state.loading;
    ui.refreshButton.textContent = state.loading ? "Refreshing…" : "Refresh";

    if (ui.lumaButton) {
      ui.lumaButton.hidden = !lumaAvailable();
      ui.lumaButton.setAttribute("aria-pressed", String(state.lumaEnabled));
      ui.lumaButton.classList.toggle("is-active", state.lumaEnabled);
      ui.lumaButton.title = state.lumaEnabled ? "Hide Luma events" : "Show Luma events";
    }

    if (ui.portalLink) ui.portalLink.href = `${portalOrigin()}/`;

    ui.summary.textContent = summaryText(session);
    renderNotice(session);
    renderMyBookings(session);
    renderCards(session);
  }

  function updatedSuffix() {
    if (!state.updatedAt) return "";
    return ` · updated ${state.updatedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`;
  }

  function summaryText(session) {
    const updated = updatedSuffix();

    if (session.status !== "ok") {
      return state.pins.length
        ? `${plural(state.pins.length, "pinned resource")} · not connected`
        : "Not connected to the members portal";
    }

    if (!state.pins.length) {
      if (state.myBookingsError) return "Couldn't load your bookings.";
      if (!state.myModel) return "Loading your bookings…";
      const parts = [`${plural(state.myModel.count, "booking")} of yours`];
      if (state.myModel.eventCount) parts.push(plural(state.myModel.eventCount, "event"));
      return `${parts.join(" · ")} in the next 14 days${updated}`;
    }

    if (!state.model) return "Loading bookings…";

    const parts = [
      plural(state.pins.length, "pinned resource"),
      plural(state.model.bookingCount, "booking"),
    ];
    const events = state.model.eventCount + state.model.lumaCount;
    if (events) parts.push(plural(events, "event"));
    return `${parts.join(" · ")} in the next 14 days${updated}`;
  }

  function renderNotice(session) {
    if (session.status === "missing") {
      showNotice({
        title: "Connect to the members portal",
        message:
          "Open the portal once while signed in so the extension can use your session to load bookings.",
        linkLabel: "Open members portal ↗",
        href: `${portalOrigin()}/`,
      });
      return;
    }

    if (session.status === "expired") {
      showNotice({
        title: "Your portal session expired",
        message: "Open the members portal, then refresh this page to load bookings again.",
        linkLabel: "Open members portal ↗",
        href: `${portalOrigin()}/`,
        error: true,
      });
      return;
    }

    if (state.error) {
      const expired = state.error.code === "session-expired";
      showNotice({
        title: expired ? "Your portal session expired" : "Couldn't load bookings",
        message: expired ? "Open the members portal, then refresh this page." : state.error.message,
        linkLabel: "Open members portal ↗",
        href: `${portalOrigin()}/`,
        error: true,
      });
      return;
    }

    const warnings = [];
    if (state.myBookingsError) warnings.push("your own bookings");
    if (state.eventsError) warnings.push("workshop reservations");
    if (state.lumaError) warnings.push("Luma events");
    if (warnings.length) {
      showNotice({
        title: "Some data couldn't load",
        message: `Showing the rest of the overview; ${warnings.join(" and ")} may be missing.`,
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

  function renderMyBookings(session) {
    ui.myBookings.replaceChildren();
    if (session.status === "ok") ui.myBookings.appendChild(myBookingsCard());
  }

  function myBookingsCard() {
    const article = el("article", "card my-bookings-card");

    const head = el("div", "card-head");

    const icon = el("div", "resource-icon my-bookings-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = PERSON_ICON;

    const titles = el("div", "card-titles");
    const heading = el("h2");
    const titleLink = el("a", "card-title-link", "My bookings");
    titleLink.href = `${portalOrigin()}/${state.webAddress}/user/activity/bookings`;
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
    titleLink.title = "Open My bookings in the portal";
    heading.appendChild(titleLink);
    const subtitle = el("p", "card-subtitle");
    if (state.myBookingsError) {
      subtitle.textContent = "Across every resource · unavailable";
    } else if (state.myModel) {
      const parts = [plural(state.myModel.count, "booking")];
      if (state.myModel.eventCount) parts.push(plural(state.myModel.eventCount, "event"));
      subtitle.textContent = `Across every resource · ${parts.join(" · ")}`;
    } else {
      subtitle.textContent = "Across every resource";
    }
    titles.append(heading, subtitle);
    head.append(icon, titles);
    article.appendChild(head);

    if (state.myBookingsError) {
      article.appendChild(cardMessage("Couldn't load your bookings."));
    } else if (!state.myModel) {
      article.appendChild(cardMessage("Loading your bookings…"));
    } else if (!state.myModel.sections.length) {
      article.appendChild(cardMessage("No bookings in the next 14 days."));
    } else {
      const list = el("div", "booking-list");
      for (const section of state.myModel.sections) list.appendChild(dayRow(section));
      article.appendChild(list);
    }

    return article;
  }

  function cardMessage(text) {
    return el("p", "card-empty", text);
  }

  function renderCards(session) {
    ui.cards.replaceChildren();

    if (!state.pins.length) {
      const empty = el("div", "empty-state");
      empty.append(
        el("h2", null, "No pinned resources yet"),
        el(
          "p",
          null,
          "Open the members portal, expand a group in the Filters menu and press the pin icon next to a resource.",
        ),
      );
      ui.cards.appendChild(empty);
      return;
    }

    if (session.status !== "ok" || !state.model) return;

    for (const card of state.model.cards) {
      ui.cards.appendChild(cardElement(card));
    }
  }

  function cardElement(card) {
    const article = el("article", "card");

    const head = el("div", "card-head");

    const icon = el("div", `resource-icon type-${typeClass(card.pin.type)}`);
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = card.icon || firstLetter(card.pin.name);

    const titles = el("div", "card-titles");
    const heading = el("h2");
    const titleLink = el("a", "card-title-link", card.pin.name || `Resource ${card.pin.id}`);
    titleLink.href = calendarHref(card.pin);
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
    titleLink.title = `Open ${card.pin.name || "resource"} in the calendar`;
    heading.appendChild(titleLink);
    const subtitle = el("p", "card-subtitle", card.groupLabel || typeLabel(card.pin.type));
    titles.append(heading, subtitle);

    const actions = el("div", "card-actions");

    const unpin = el("button", "unpin");
    unpin.type = "button";
    unpin.title = "Unpin resource";
    unpin.setAttribute("aria-label", `Unpin ${card.pin.name || card.pin.id}`);
    unpin.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>';
    unpin.addEventListener("click", () => unpinResource(card.pin));

    actions.append(unpin);
    head.append(icon, titles, actions);
    article.appendChild(head);

    if (!card.sections.length) {
      article.appendChild(el("p", "card-empty", "No bookings or events in the next 14 days."));
      return article;
    }

    const list = el("div", "booking-list");
    for (const section of card.sections) {
      list.appendChild(dayRow(section));
    }
    article.appendChild(list);
    return article;
  }

  function dayRow(section) {
    const row = el("div", "day-row");
    const label = el("div", "day-label", section.label);
    const items = el("div", "day-bookings");

    for (const booking of section.bookings) {
      items.appendChild(
        booking.luma ? lumaEntry(booking) : booking.event ? eventEntry(booking) : bookingEntry(booking),
      );
    }

    row.append(label, items);
    return row;
  }

  function bookingEntry(booking) {
    const entry = el("div", "booking");

    const href = booking.mine ? bookingHref(booking) : "";
    const who = el(href ? "a" : "span", `booking-who${href ? " booking-link" : ""}`, booking.coworker);
    if (href) {
      who.href = href;
      who.target = "_blank";
      who.rel = "noopener";
      who.title = "Open booking in the portal";
    }

    entry.append(timeLabel(booking), who);
    if (booking.tentative) entry.appendChild(badge("Tentative"));
    return entry;
  }

  function bookingHref(booking) {
    if (!booking.id || !booking.resourceId) return "";
    const params = new URLSearchParams({
      id: booking.id,
      resource_id: booking.resourceId,
    });
    return `${portalOrigin()}/${state.webAddress}/public/bookings/edit?${params.toString()}`;
  }

  function eventEntry(booking) {
    const entry = el("div", "booking booking-event");
    entry.appendChild(timeLabel(booking));

    const title = el("span", "booking-who", booking.coworker);

    if (!booking.description && !booking.url) {
      entry.append(title, badge("Reserved", "badge-event"));
      return entry;
    }

    const details = el("details", "event-details");
    const summary = el("summary", "event-summary");
    summary.append(title, badge("Reserved", "badge-event"));

    const body = el("div", "event-body");
    if (booking.description) {
      body.appendChild(el("p", null, booking.description));
    }
    if (booking.url) {
      const link = el("a", null, "View event ↗");
      link.href = eventHref(booking.url);
      link.target = "_blank";
      link.rel = "noopener";
      body.appendChild(link);
    }

    details.append(summary, body);
    entry.appendChild(details);
    return entry;
  }

  /**
   * Luma events are space-wide happenings, so they get a purple *Event* badge
   * instead of the orange *Reserved* one. The description is fetched on the
   * first expand, like the web app's HTMX endpoint.
   */
  function lumaEntry(item) {
    const entry = el("div", "booking booking-event booking-luma");
    entry.appendChild(timeLabel(item));

    const details = el("details", "event-details");
    const summary = el("summary", "event-summary");
    summary.append(el("span", "booking-who", item.coworker), badge("Event", "badge-luma"));

    const body = el("div", "event-body");
    const description = el("p", "event-description");
    body.appendChild(description);

    if (item.url) {
      const link = el("a", null, "View event on Luma ↗");
      link.href = eventHref(item.url);
      link.target = "_blank";
      link.rel = "noopener";
      body.appendChild(link);
    }

    details.addEventListener("toggle", () => {
      if (details.open) fillLumaDescription(item, description);
    });

    details.append(summary, body);
    entry.appendChild(details);
    return entry;
  }

  function fillLumaDescription(item, node) {
    if (item.descriptionLoaded) {
      node.textContent = item.description || item.descriptionError || "No description.";
      node.classList.toggle("error", Boolean(item.descriptionError));
      return;
    }
    if (item.descriptionLoading) return;

    item.descriptionLoading = true;
    node.textContent = "Loading description…";
    node.classList.remove("error");

    fetchLumaDescription(item.eventId)
      .then((description) => {
        item.descriptionLoaded = true;
        item.description = description;
        item.descriptionError = "";
        if (!ui.root) return;
        node.textContent = description || "No description.";
      })
      .catch((error) => {
        item.descriptionLoaded = true;
        item.description = "";
        item.descriptionError = error.message || "Couldn't load the description.";
        if (!ui.root) return;
        node.textContent = item.descriptionError;
        node.classList.add("error");
      })
      .finally(() => {
        item.descriptionLoading = false;
      });
  }

  function timeLabel(booking) {
    return el(
      "span",
      "booking-time",
      booking.allDay ? "All day" : `${booking.startTime}–${booking.endTime}`,
    );
  }

  function badge(label, extraClass) {
    return el("span", `badge${extraClass ? ` ${extraClass}` : ""}`, label);
  }

  function eventHref(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `${portalOrigin()}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  function calendarHref(pin) {
    const path = U.bookingHref({
      webAddress: state.webAddress,
      type: pin.type || "all",
      view: "calendar",
      group: pin.group,
      resource: pin.id,
    });
    return `${portalOrigin()}${path}`;
  }

  function typeClass(type) {
    return String(type || "other").replace(/[^a-z0-9-]/gi, "") || "other";
  }

  function typeLabel(type) {
    return String(type || "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function firstLetter(name) {
    return String(name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function plural(count, label) {
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  }

  async function unpinResource(pin) {
    const name = pin.name || pin.id;
    if (!window.confirm(`Unpin ${name}?`)) return;

    const next = state.pins.filter((item) => item.id !== pin.id);
    await set(cfg.storageKeys.pins, next);
    state.pins = next;
    await load();
  }

  function get(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (result) => resolve(result[key])));
  }

  function set(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  }
})();
