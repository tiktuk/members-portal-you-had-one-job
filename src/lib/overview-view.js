/* global chrome, OneJobConfig, OneJobUrl, OneJobOverview */

/**
 * The pinned resources overview, shared by the standalone page (overview.html)
 * and the in-portal overlay opened from the Resources menu. Both mount the same
 * markup and stylesheet; only the surrounding shell differs.
 */
(() => {
  "use strict";

  const cfg = OneJobConfig;
  const U = OneJobUrl;
  const O = OneJobOverview;

  const REFRESH_MS = 60 * 1000;
  /** How long the "Booking created" toast stays up. */
  const SUCCESS_MS = 8 * 1000;

  const PERSON_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>';

  const PLUS_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2"/></svg>';

  const CANCEL_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>';

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
      /** Member profile bookings are created for: { id, name } | null. */
      coworker: null,
      coworkerError: null,
      coworkerTried: false,
      /** Resource id -> { interval } once the booking dialog has asked. */
      resourceInfo: {},
      /** Transient "booking created" notice. */
      success: null,
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
    success: null,
    cards: null,
    myBookings: null,
    refreshButton: null,
    portalLink: null,
    timer: null,
    successTimer: null,
    onStorageChanged: null,
  };

  /**
   * The one booking dialog, if it is open. Kept outside `ui` because the
   * dialog outlives a render and needs its own request bookkeeping.
   */
  const dialogState = {
    node: null,
    parts: null,
    resourceId: "",
    resourceName: "",
    booking: null,
    side: "after",
    interval: 15,
    coworker: null,
    coworkerError: "",
    preview: null,
    previewError: "",
    previewing: false,
    submitError: "",
    busy: false,
    /** Whether the member has touched the duration field. */
    edited: false,
    abort: null,
    timer: null,
    token: 0,
  };

  let checkoutSession = "";

  /** The cancel dialog, when it is the open one. */
  const cancelState = {
    node: null,
    parts: null,
    booking: null,
    resourceName: "",
    fee: null,
    error: "",
    busy: false,
    abort: null,
    timer: null,
    token: 0,
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
    return {
      refresh: () => load(),
      destroy,
      hasOpenModal: () => Boolean(dialogState.node?.open || cancelState.node?.open),
    };
  }

  function destroy() {
    closeDialog();
    if (ui.timer) clearInterval(ui.timer);
    if (ui.successTimer) clearTimeout(ui.successTimer);
    if (ui.onStorageChanged && typeof chrome?.storage?.onChanged?.removeListener === "function") {
      chrome.storage.onChanged.removeListener(ui.onStorageChanged);
    }
    if (ui.root) ui.root.replaceChildren();

    ui.root = null;
    ui.doc = null;
    ui.onClose = null;
    ui.summary = null;
    ui.notice = null;
    ui.success = null;
    ui.cards = null;
    ui.myBookings = null;
    ui.refreshButton = null;
    ui.portalLink = null;
    ui.timer = null;
    ui.successTimer = null;
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
    if (ui.variant === "page") heading.appendChild(el("p", "eyebrow", "Members portal, you had one job"));
    heading.appendChild(el("h1", null, "Pinned resources"));
    ui.summary = el("p", "summary", "Loading…");
    heading.appendChild(ui.summary);

    const actions = el("div", "actions");

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
    ui.success = el("div", "notice success");
    ui.success.hidden = true;
    ui.success.setAttribute("role", "status");
    ui.myBookings = el("div", "my-bookings");
    ui.cards = el("div", "cards");
    ui.cards.setAttribute("aria-live", "polite");
    main.append(ui.notice, ui.success, ui.myBookings, ui.cards);

    fragment.append(header, main);

    if (ui.variant === "page") {
      const footer = el("footer", "footer");
      footer.append(
        "Pins are managed from the ",
        el("strong", null, cfg.nav.label),
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
      state.coworker = null;
      state.coworkerError = null;
      state.coworkerTried = false;
      state.resourceInfo = {};
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

  /** The popup's *Luma events in overview* switch; `config.luma.enabled` is only the default. */
  function isLumaEnabled(settings) {
    if (!lumaAvailable()) return false;
    const stored = settings && typeof settings.lumaEvents === "boolean"
      ? settings.lumaEvents
      : cfg.luma.enabled !== false;
    return stored;
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
    state.success = null;
    if (ui.successTimer) {
      clearTimeout(ui.successTimer);
      ui.successTimer = null;
    }

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

  /**
   * `allowErrorBody` reads the body of a 4xx instead of throwing — the checkout
   * endpoints report a refused booking as `Errors` — and returns
   * `{ status, data }` so the caller can tell a refusal from a create. The
   * invoice endpoint's success body is not a fixed envelope, so the status is
   * the only thing that can be trusted there.
   */
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
        return { status: response.status, data: await readJsonBody(response) };
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

  /** A checkout response may be empty or non-JSON; that is not an error. */
  async function readJsonBody(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
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

    if (ui.portalLink) ui.portalLink.href = `${portalOrigin()}/`;

    ui.summary.textContent = summaryText(session);
    renderNotice(session);
    renderSuccess();
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

  /**
   * The toast floats over the content, because the confirmation arrives after
   * a refresh that can leave the member scrolled past the top of the list.
   */
  function showSuccess(success) {
    state.success = success;
    render();

    if (ui.successTimer) clearTimeout(ui.successTimer);
    ui.successTimer = setTimeout(() => {
      if (!ui.root) return;
      ui.successTimer = null;
      state.success = null;
      render();
    }, SUCCESS_MS);
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
          `Open the members portal, expand a group in the ${cfg.nav.label} menu and press the pin icon next to a resource.`,
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
      list.appendChild(dayRow(section, card.pin.name));
    }
    article.appendChild(list);
    return article;
  }

  function dayRow(section, resourceName) {
    const row = el("div", "day-row");
    const label = el("div", "day-label", section.label);
    const items = el("div", "day-bookings");

    for (const booking of section.bookings) {
      items.appendChild(
        booking.luma
          ? lumaEntry(booking)
          : booking.event
            ? eventEntry(booking, resourceName)
            : bookingEntry(booking, resourceName),
      );
    }

    row.append(label, items);
    return row;
  }

  /**
   * The title with the "book the gap" buttons around it, plus the cancel
   * button on the member's own rows. A row whose resource is unknown (Luma
   * events) gets the title alone.
   */
  function titleWithGaps(title, booking, resourceName) {
    const main = el("span", "booking-main");
    if (!booking.resourceId) {
      main.appendChild(title);
      return main;
    }

    main.append(
      gapButton(booking, "before", resourceName),
      title,
      gapButton(booking, "after", resourceName),
    );
    if (booking.mine && cancelId(booking)) main.appendChild(cancelButton(booking, resourceName));
    return main;
  }

  /** The numeric booking id a cancellation needs, or "" when it has none. */
  function cancelId(booking) {
    const id = Number(booking?.id);
    return Number.isFinite(id) && id > 0 ? String(id) : "";
  }

  function cancelButton(booking, resourceName) {
    const button = el("button", "booking-gap gap-cancel");
    button.type = "button";
    button.innerHTML = CANCEL_ICON;

    const name = resourceName || booking.resourceName || "this booking";
    const started = booking.stamp <= Date.now();
    button.title = started ? "This booking already started" : `Cancel the ${booking.startTime} booking`;
    button.setAttribute("aria-label", started ? button.title : `Cancel ${name} at ${booking.startTime}`);
    button.disabled = started;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCancelDialog({ booking, resourceName: name });
    });

    return button;
  }

  function gapButton(booking, side, resourceName) {
    const button = el("button", `booking-gap gap-${side}`);
    button.type = "button";
    button.innerHTML = PLUS_ICON;

    const name = resourceName || booking.resourceName || "this resource";
    const edge = side === "before" ? booking.startTime : booking.endTime;
    const started = side === "before" && booking.stamp <= Date.now();

    button.title = started
      ? "This booking already started"
      : side === "before"
        ? `Book ${name} so it ends at ${edge}`
        : `Book ${name} so it starts at ${edge}`;
    button.setAttribute("aria-label", button.title);
    button.disabled = started;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBookingDialog({ resourceId: booking.resourceId, resourceName: name, booking, side });
    });

    return button;
  }

  function bookingEntry(booking, resourceName) {
    const entry = el("div", "booking");

    const href = booking.mine ? bookingHref(booking) : "";
    const who = el(href ? "a" : "span", `booking-who${href ? " booking-link" : ""}`, booking.coworker);
    if (href) {
      who.href = href;
      who.target = "_blank";
      who.rel = "noopener";
      who.title = "Open booking in the portal";
    }

    entry.append(timeLabel(booking), titleWithGaps(who, booking, resourceName));
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

  function eventEntry(booking, resourceName) {
    const entry = el("div", "booking booking-event");
    entry.appendChild(timeLabel(booking));

    const title = el("span", "booking-who", booking.coworker);
    const main = titleWithGaps(title, booking, resourceName);

    if (!booking.description && !booking.url) {
      entry.append(main, badge("Reserved", "badge-event"));
      return entry;
    }

    const details = el("details", "event-details");
    const summary = el("summary", "event-summary");
    summary.append(main, badge("Reserved", "badge-event"));

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

  /* ------------------------------------------------------------------ *
   * Booking the gap before or after a row
   *
   * The portal has no plain "create booking" call: its own form posts a
   * basket item to /api/public/checkout/basket/invoice (after a preview
   * call), so the dialog asks for the one thing that is not derivable — the
   * duration — and builds that body from the row, the card and the session.
   * ------------------------------------------------------------------ */

  function bookingCfg() {
    return cfg.overview?.booking || {};
  }

  function maxDuration() {
    return Number(bookingCfg().maxDurationMinutes) || 24 * 60;
  }

  function openBookingDialog({ resourceId, resourceName, booking, side }) {
    if (!ui.root || !booking) return;

    const id = String(resourceId || booking.resourceId || "");
    if (!id) return;

    closeDialog();

    const settings = bookingCfg();
    const interval = Number(settings.intervalMinutes) || 15;

    dialogState.resourceId = id;
    dialogState.resourceName = String(resourceName || booking.resourceName || `Resource ${id}`);
    dialogState.booking = booking;
    dialogState.side = side === "before" ? "before" : "after";
    dialogState.interval = interval;
    dialogState.coworker = state.coworker;
    dialogState.coworkerError = state.coworkerError || "";
    dialogState.preview = null;
    dialogState.previewError = "";
    dialogState.previewing = false;
    dialogState.submitError = "";
    dialogState.busy = false;
    dialogState.edited = false;
    dialogState.token += 1;
    const token = dialogState.token;

    const { node, form, body, actions } = dialogShell({
      title:
        dialogState.side === "before" ? `Book before ${booking.startTime}` : `Book after ${booking.endTime}`,
      subtitle: `${dialogState.resourceName} · ${dayLabelOf(booking.day)}`,
      describedBy: "onejob-booking-range",
    });

    const field = el("div", "booking-dialog-field");
    const label = el("label", null, "Duration");
    label.htmlFor = "onejob-booking-duration";

    const durationRow = el("div", "booking-duration");
    const input = ui.doc.createElement("input");
    input.type = "number";
    input.id = "onejob-booking-duration";
    input.inputMode = "numeric";
    input.min = String(interval);
    input.max = String(maxDuration());
    input.step = String(interval);
    input.value = String(defaultMinutes(interval));
    input.addEventListener("input", () => {
      dialogState.edited = true;
      onDurationChanged();
    });
    durationRow.append(input, el("span", "booking-duration-unit", "min"));

    const presets = el("div", "booking-presets");
    const presetButtons = [];
    for (const value of settings.presets || []) {
      if (!(value > 0) || value > maxDuration()) continue;
      const preset = el("button", "booking-preset", O.durationLabel(value));
      preset.type = "button";
      preset.dataset.minutes = String(value);
      preset.addEventListener("click", () => {
        dialogState.edited = true;
        input.value = String(value);
        onDurationChanged();
      });
      presets.appendChild(preset);
      presetButtons.push(preset);
    }

    field.append(label, durationRow, presets);

    const range = el("p", "booking-dialog-range");
    range.id = "onejob-booking-range";
    const price = el("p", "booking-dialog-price");
    const error = el("p", "booking-dialog-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const fallback = el("p", "booking-dialog-fallback");
    fallback.hidden = true;

    const terms = el("p", "booking-dialog-terms");
    terms.append("By confirming you agree to the portal's ");
    const termsLink = el("a", null, "terms and conditions");
    termsLink.href = `${portalOrigin()}/${state.webAddress}/?action=terms`;
    termsLink.target = "_blank";
    termsLink.rel = "noopener";
    terms.append(termsLink, ".");

    body.append(field, range, price, error, fallback, terms);

    const cancel = el("button", "button button-ghost", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeDialog);
    const confirm = el("button", "button button-primary", "Confirm booking");
    confirm.type = "submit";
    actions.append(cancel, confirm);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitBooking();
    });

    dialogState.node = node;
    dialogState.parts = { input, range, price, error, fallback, confirm, presets: presetButtons };

    renderDialog();
    input.focus();
    input.select?.();

    loadBookingContext(token);
  }

  /** Closes whichever dialog is open (booking or cancel) and drops its work. */
  function closeDialog() {
    const nodes = [];

    for (const item of [dialogState, cancelState]) {
      clearTimeout(item.timer);
      item.timer = null;
      item.abort?.abort();
      item.abort = null;
      item.token += 1;
      if (item.node) nodes.push(item.node);
      item.node = null;
      item.parts = null;
    }

    for (const node of nodes) {
      try {
        node.close();
      } catch {
        /* not open */
      }
      node.remove();
    }
  }

  /**
   * The frame both dialogs share: a native <dialog> in the top layer, with a
   * title, a subtitle and a close button.
   */
  function dialogShell({ title, subtitle, describedBy }) {
    const node = ui.doc.createElement("dialog");
    node.className = "booking-dialog";
    node.setAttribute("aria-labelledby", "onejob-dialog-title");
    if (describedBy) node.setAttribute("aria-describedby", describedBy);

    const form = el("form", "booking-dialog-form");
    form.noValidate = true;

    const head = el("header", "booking-dialog-head");
    const titles = el("div", "booking-dialog-titles");
    const heading = el("h2", null, title);
    heading.id = "onejob-dialog-title";
    const sub = el("p", "booking-dialog-sub", subtitle);
    titles.append(heading, sub);

    const close = el("button", "button button-icon", "×");
    close.type = "button";
    close.title = "Close";
    close.setAttribute("aria-label", "Close dialog");
    close.addEventListener("click", closeDialog);

    const body = el("div", "booking-dialog-body");
    const actions = el("footer", "booking-dialog-actions");

    head.append(titles, close);
    form.append(head, body, actions);
    node.appendChild(form);

    node.addEventListener("close", () => {
      if (dialogState.node === node || cancelState.node === node) closeDialog();
    });

    ui.root.appendChild(node);
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");

    return { node, form, body, actions };
  }

  /** The first duration the dialog offers: an hour, snapped to the interval. */
  function defaultMinutes(interval) {
    const max = maxDuration();
    const step = Number(interval) > 0 ? Number(interval) : 15;
    const snapped = Math.max(step, Math.round(Math.min(60, max) / step) * step);
    return Math.min(snapped, max);
  }

  /** "" when the duration can be sent, otherwise the reason it cannot. */
  function validateMinutes(minutes) {
    const value = Math.round(Number(minutes));
    if (!Number.isFinite(value) || value <= 0) return "Enter a duration in minutes.";
    if (value % dialogState.interval !== 0) {
      return `Duration must be in ${O.durationLabel(dialogState.interval)} steps.`;
    }
    if (value < dialogState.interval) {
      return `The shortest booking is ${O.durationLabel(dialogState.interval)}.`;
    }
    if (value > maxDuration()) return `The longest booking is ${O.durationLabel(maxDuration())}.`;
    return "";
  }

  function onDurationChanged() {
    clearTimeout(dialogState.timer);
    dialogState.timer = null;
    dialogState.abort?.abort();
    dialogState.abort = null;
    dialogState.preview = null;
    dialogState.previewError = "";
    dialogState.submitError = "";
    dialogState.previewing = false;
    renderDialog();

    const minutes = Math.round(Number(dialogState.parts?.input?.value));
    if (validateMinutes(minutes) || !dialogState.coworker) return;

    dialogState.previewing = true;
    renderDialog();
    dialogState.timer = setTimeout(() => previewBooking(dialogState.token), 350);
  }

  function renderDialog() {
    if (!dialogState.node || !dialogState.parts) return;
    const { input, range, price, error, fallback, confirm, presets } = dialogState.parts;

    const minutes = Math.round(Number(input.value));
    const slot = O.bookingWindow(dialogState.booking, dialogState.side, minutes);
    range.textContent = slot ? formatWindow(slot.start, slot.end) : "Choose a duration.";

    for (const preset of presets) {
      const value = Number(preset.dataset.minutes);
      preset.hidden = value % dialogState.interval !== 0;
      preset.classList.toggle("is-active", value === minutes);
    }

    const message =
      dialogState.submitError ||
      dialogState.previewError ||
      validateMinutes(minutes) ||
      (dialogState.coworker ? "" : dialogState.coworkerError || "Checking your member profile…");
    error.hidden = !message;
    error.textContent = message || "";

    const total = dialogState.preview?.total ?? 0;
    const currency = dialogState.preview?.currency || "";
    if (dialogState.previewing) price.textContent = "Checking the price…";
    else if (!dialogState.preview) price.textContent = "";
    else if (total > 0) price.textContent = `${formatPrice(total, currency)} due after booking`;
    else price.textContent = "Free.";

    const needsFallback = Boolean(dialogState.submitError || dialogState.coworkerError);
    fallback.hidden = !needsFallback;
    fallback.replaceChildren();
    if (needsFallback && slot) {
      fallback.append("Or ");
      const link = el("a", null, "book it in the portal ↗");
      link.href = portalBookingHref(slot);
      link.target = "_blank";
      link.rel = "noopener";
      fallback.append(link, ".");
    }

    const ready =
      Boolean(dialogState.coworker) &&
      Boolean(dialogState.preview) &&
      !dialogState.previewing &&
      !dialogState.busy &&
      !dialogState.previewError &&
      !dialogState.submitError &&
      !validateMinutes(minutes);
    confirm.disabled = !ready;
    confirm.textContent = dialogState.busy
      ? "Booking…"
      : total > 0
        ? `Book and pay ${formatPrice(total, currency)}`
        : "Confirm booking";
  }

  async function loadBookingContext(token) {
    const session = currentSession();
    if (session.status !== "ok") {
      dialogState.coworkerError = "Your portal session expired.";
      renderDialog();
      return;
    }

    const [interval] = await Promise.all([
      resolveInterval(session, dialogState.resourceId),
      resolveCoworker(session),
    ]);
    if (token !== dialogState.token || !dialogState.node) return;

    if (interval) {
      dialogState.interval = interval;
      const input = dialogState.parts.input;
      input.min = String(interval);
      input.step = String(interval);
      const current = Math.round(Number(input.value));
      // Only snap the default; never overwrite what the member already typed.
      if (!dialogState.edited && (!(current > 0) || current % interval !== 0)) {
        input.value = String(defaultMinutes(interval));
      }
    }

    dialogState.coworker = state.coworker;
    dialogState.coworkerError = state.coworker ? "" : state.coworkerError || "Couldn't find your member profile.";
    renderDialog();
    onDurationChanged();
  }

  /** The member profile a booking is created for; cached for the mount. */
  async function resolveCoworker(session) {
    if (state.coworker) return state.coworker;

    if (!state.coworkerTried) {
      state.coworkerTried = true;
      try {
        const url = `${U.apiBaseUrl(session.webAddress)}/api/public/coworkers/profiles?f=1`;
        state.coworker = O.defaultProfile(await fetchJson(session, url));
        if (!state.coworker) state.coworkerError = "Couldn't find your member profile.";
      } catch (error) {
        state.coworkerError = error.message || "Couldn't load your member profile.";
      }
    }

    if (!state.coworker) {
      const own = (state.myModel?.items || []).find((item) => item.coworkerId);
      if (own) {
        state.coworker = { id: Number(own.coworkerId), name: "" };
        state.coworkerError = "";
      }
    }
    return state.coworker;
  }

  /** The resource's booking increment, so the duration field steps honestly. */
  async function resolveInterval(session, resourceId) {
    if (!resourceId) return null;
    if (state.resourceInfo[resourceId]) return state.resourceInfo[resourceId].interval || null;

    try {
      const url = `${U.apiBaseUrl(session.webAddress)}/api/public/resources/published/${encodeURIComponent(resourceId)}`;
      const interval = O.resourceInterval(await fetchJson(session, url));
      state.resourceInfo[resourceId] = { interval };
      return interval;
    } catch {
      state.resourceInfo[resourceId] = { interval: null };
      return null;
    }
  }

  async function previewBooking(token) {
    if (token !== dialogState.token || !dialogState.node) return;

    const session = currentSession();
    if (session.status !== "ok") {
      dialogState.previewing = false;
      dialogState.previewError = "Your portal session expired.";
      renderDialog();
      return;
    }

    const slot = O.bookingWindow(
      dialogState.booking,
      dialogState.side,
      Number(dialogState.parts.input.value),
    );
    if (!slot || !dialogState.coworker) return;

    const controller = new AbortController();
    dialogState.abort = controller;

    try {
      const { status, data } = await postBasket(session, "preview", basketBodyFor(slot), controller.signal);
      if (token !== dialogState.token || controller.signal.aborted) return;
      if (!isBasketResponse(data)) {
        throw new Error(
          status >= 400
            ? `The portal returned HTTP ${status}.`
            : "The portal returned an unexpected response.",
        );
      }

      const failure = basketFailure(data);
      dialogState.previewing = false;
      dialogState.previewError = failure;
      dialogState.preview = failure
        ? null
        : {
            total: basketTotal(data),
            currency: data?.preview?.Currency?.Code || data?.checkout?.Currency?.Code || "",
          };
    } catch (error) {
      if (token !== dialogState.token || error.code === "aborted") return;
      dialogState.previewing = false;
      dialogState.preview = null;
      dialogState.previewError = error.message || "Couldn't check that slot.";
    }
    renderDialog();
  }

  async function submitBooking() {
    if (dialogState.busy || !dialogState.node) return;

    const session = currentSession();
    if (session.status !== "ok") {
      dialogState.submitError = "Your portal session expired.";
      renderDialog();
      return;
    }

    const minutes = Math.round(Number(dialogState.parts.input.value));
    const slot = O.bookingWindow(dialogState.booking, dialogState.side, minutes);
    if (!slot || validateMinutes(minutes) || !dialogState.coworker) return;

    dialogState.busy = true;
    dialogState.submitError = "";
    renderDialog();

    try {
      // The invoice endpoint's success body is not a fixed envelope (it is not
      // the preview's `checkout`/`preview` shape), so a 2xx that does not say
      // `WasSuccessful: false` means the booking was created. Do not re-check
      // the shape here: that reported an error after a successful create.
      const { status, data } = await postBasket(session, "invoice", basketBodyFor(slot));
      if (status >= 400) {
        throw new Error(basketFailure(data) || `The portal returned HTTP ${status}.`);
      }
      if (data && data.WasSuccessful === false) {
        throw new Error(basketFailure(data) || "The portal couldn't create this booking.");
      }

      const total = basketTotal(data);
      const currency =
        data?.preview?.Currency?.Code ||
        data?.checkout?.Currency?.Code ||
        data?.Currency?.Code ||
        data?.CurrencyCode ||
        "";
      const invoiceId = data?.Id ?? data?.Invoice?.Id ?? data?.InvoiceId ?? "";
      const paymentUrl = total > 0 && invoiceId ? paymentHref(invoiceId) : "";
      const label = formatWindow(slot.start, slot.end);

      closeDialog();

      // `ui.doc` is cleared when the panel closes, so keep it for the redirect.
      const view = ui.doc?.defaultView || window;

      if (paymentUrl) {
        if (ui.variant === "panel") {
          // The portal's own modal closes and navigates to the payment page.
          ui.onClose?.();
          view.location.assign(paymentUrl);
          return;
        }
        view.open(paymentUrl, "_blank", "noopener");
      }

      await load();
      if (!ui.root) return;

      state.success = paymentUrl
        ? {
            title: "Booking created",
            message: `Booked ${label}. ${formatPrice(total, currency)} is due; pay it in the portal.`,
            linkLabel: "Pay in the portal ↗",
            href: paymentUrl,
          }
        : { title: "Booking created", message: `Booked ${label}.` };
      showSuccess(state.success);
    } catch (error) {
      if (!ui.root) return;
      dialogState.busy = false;
      dialogState.submitError = error.message || "Couldn't create the booking.";
      renderDialog();
    }
  }

  /* ------------------------------------------------------------------ *
   * Cancelling one of the member's own bookings
   *
   * The portal's edit page deletes with a reason body:
   * DELETE /api/public/bookings/<id> { id, cancellationReason,
   * cancellationReasonDetails }, and warns about a fee read from
   * /api/public/bookings/<id>/cancellationFee.
   * ------------------------------------------------------------------ */

  function openCancelDialog({ booking, resourceName }) {
    if (!ui.root || !booking || !cancelId(booking)) return;

    closeDialog();

    cancelState.booking = booking;
    cancelState.resourceName = String(resourceName || booking.resourceName || `Resource ${booking.resourceId}`);
    cancelState.fee = null;
    cancelState.error = "";
    cancelState.busy = false;
    cancelState.token += 1;
    const token = cancelState.token;

    const { node, form, body, actions } = dialogShell({
      title: "Cancel booking",
      subtitle: `${cancelState.resourceName} · ${dayLabelOf(booking.day)}, ${booking.startTime}–${booking.endTime}`,
    });

    const field = el("div", "booking-dialog-field");
    const label = el("label", null, "Cancellation reason");
    label.htmlFor = "onejob-cancel-reason";
    const select = ui.doc.createElement("select");
    select.id = "onejob-cancel-reason";
    for (const reason of O.CANCEL_REASONS) {
      const option = ui.doc.createElement("option");
      option.value = reason.value;
      option.textContent = reason.label;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      cancelState.error = "";
      renderCancelDialog();
    });
    field.append(label, select);

    const detailsField = el("div", "booking-dialog-field");
    detailsField.hidden = true;
    const detailsLabel = el("label", null, "Please specify");
    detailsLabel.htmlFor = "onejob-cancel-details";
    const details = ui.doc.createElement("textarea");
    details.id = "onejob-cancel-details";
    details.rows = 3;
    details.maxLength = 1024;
    detailsField.append(detailsLabel, details);

    const fee = el("p", "booking-dialog-fee");
    fee.hidden = true;
    const warning = el(
      "p",
      "booking-dialog-terms",
      "Once a booking is cancelled it cannot be changed. You will need to make a new booking if needed.",
    );
    const error = el("p", "booking-dialog-error");
    error.setAttribute("role", "alert");
    error.hidden = true;

    body.append(field, detailsField, fee, warning, error);

    const keep = el("button", "button button-ghost", "Keep booking");
    keep.type = "button";
    keep.addEventListener("click", closeDialog);
    const confirm = el("button", "button button-danger", "Cancel booking");
    confirm.type = "submit";
    actions.append(keep, confirm);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCancel();
    });

    cancelState.node = node;
    cancelState.parts = { select, details, detailsField, fee, error, confirm };

    renderCancelDialog();
    select.focus();

    loadCancellationFee(token);
  }

  function renderCancelDialog() {
    if (!cancelState.node || !cancelState.parts) return;
    const { select, detailsField, fee, error, confirm } = cancelState.parts;

    detailsField.hidden = select.value !== "Other";

    confirm.disabled = !select.value || cancelState.busy;
    confirm.textContent = cancelState.busy ? "Cancelling…" : "Cancel booking";

    error.hidden = !cancelState.error;
    error.textContent = cancelState.error || "";

    const amount = cancelState.fee?.amount || 0;
    fee.hidden = !(amount > 0);
    const amountLabel = cancelState.fee?.currency
      ? formatPrice(amount, cancelState.fee.currency)
      : amount.toFixed(2);
    fee.textContent = amount > 0 ? `A cancellation fee of ${amountLabel} applies.` : "";
  }

  async function loadCancellationFee(token) {
    const booking = cancelState.booking;
    const session = currentSession();
    if (!booking || session.status !== "ok") return;

    try {
      const url = `${U.apiBaseUrl(session.webAddress)}/api/public/bookings/${encodeURIComponent(booking.id)}/cancellationFee`;
      const data = await fetchJson(session, url);
      if (token !== cancelState.token || !cancelState.node) return;

      const amount = Number(data?.cancellationFee ?? data?.CancellationFee ?? 0);
      const currency = data?.currency?.Code || data?.Currency?.Code || data?.CurrencyCode || "";
      const charged = data?.hasCancellationFee ?? data?.HasCancellationFee;
      cancelState.fee = charged && amount > 0 ? { amount, currency } : null;
      renderCancelDialog();
    } catch {
      /* the fee is only a warning; a failed lookup must not block cancelling */
    }
  }

  async function submitCancel() {
    if (cancelState.busy || !cancelState.node) return;

    const session = currentSession();
    const booking = cancelState.booking;
    if (!booking) return;
    if (session.status !== "ok") {
      cancelState.error = "Your portal session expired.";
      renderCancelDialog();
      return;
    }

    const reason = cancelState.parts.select.value;
    if (!reason) return;
    const details = reason === "Other" ? cancelState.parts.details.value.trim().slice(0, 1024) : "";
    const name = cancelState.resourceName;
    const label = `${dayLabelOf(booking.day)}, ${booking.startTime}–${booking.endTime}`;

    cancelState.busy = true;
    cancelState.error = "";
    renderCancelDialog();

    try {
      const url = `${U.apiBaseUrl(session.webAddress)}/api/public/bookings/${encodeURIComponent(booking.id)}`;
      const { status, data } = await fetchJson(session, url, {
        method: "DELETE",
        body: JSON.stringify(O.cancelBody(booking.id, reason, details)),
        allowErrorBody: true,
        headers: { "Content-Type": "application/json" },
      });
      if (status >= 400) {
        throw new Error(cancelMessage(data) || `The portal returned HTTP ${status}.`);
      }

      closeDialog();
      await load();
      if (!ui.root) return;
      showSuccess({ title: "Booking cancelled", message: `Cancelled ${name} on ${label}.` });
    } catch (error) {
      if (!ui.root) return;
      cancelState.busy = false;
      cancelState.error = error.message || "Couldn't cancel the booking.";
      renderCancelDialog();
    }
  }

  /** The cancellation's refusal code or message, translated when known. */
  function cancelMessage(data) {
    const raw = data?.Message || data?.message || data?.Errors?.[0]?.PropertyName || "";
    if (!raw) return "";
    const translated = O.cancelError(raw);
    if (translated) return translated;
    return /^[A-Z][A-Z_ |]+$/.test(raw) ? "" : String(raw);
  }

  function basketBodyFor(slot) {
    return O.basketBody({
      resourceId: dialogState.resourceId,
      coworkerId: dialogState.coworker.id,
      coworkerName: dialogState.coworker.name,
      start: slot.start,
      end: slot.end,
    });
  }

  /**
   * The checkout endpoints answer with `Errors` (a code plus an attempted
   * value) rather than an HTTP failure, so 4xx bodies are read too.
   */
  function postBasket(session, kind, body, signal) {
    const url = `${U.apiBaseUrl(session.webAddress)}/api/public/checkout/basket/${kind}`;
    return fetchJson(session, url, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
      allowErrorBody: true,
      headers: {
        "Content-Type": "application/json",
        "X-Nexudus-Client-Session": clientSessionId(),
      },
    });
  }

  /** The portal groups basket requests under a per-tab session id. */
  function clientSessionId() {
    if (checkoutSession) return checkoutSession;
    const key = "onejob:checkout-session";
    try {
      const stored = sessionStorage.getItem(key);
      if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) {
        checkoutSession = stored;
        return stored;
      }
    } catch {
      /* storage can be unavailable */
    }

    checkoutSession = newSessionId();
    try {
      sessionStorage.setItem(key, checkoutSession);
    } catch {
      /* storage can be unavailable */
    }
    return checkoutSession;
  }

  function newSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "");
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }

  function isBasketResponse(data) {
    return Boolean(
      data &&
        typeof data === "object" &&
        ("preview" in data ||
          "checkout" in data ||
          "WasSuccessful" in data ||
          "TransactionTotalAmount" in data ||
          "Errors" in data),
    );
  }

  function basketTotal(data) {
    const value = Number(
      data?.preview?.TotalAmount ??
        data?.checkout?.TransactionTotalAmount ??
        data?.TransactionTotalAmount ??
        data?.Invoice?.TransactionTotalAmount ??
        0,
    );
    return Number.isFinite(value) ? value : 0;
  }

  /** The first readable reason the checkout refused the slot, or "". */
  function basketFailure(data) {
    const entry =
      data?.checkout?.Errors?.[0] ||
      data?.preview?.Errors?.[0] ||
      (Array.isArray(data?.Errors) ? data.Errors[0] : null);

    if (entry) {
      const message = O.bookingError(entry.PropertyName, entry.AttemptedValue);
      if (message) return message;
    }

    const raw = data?.preview?.Message || data?.Message;
    if (typeof raw === "string" && raw && !/^[A-Z][A-Z_ ]+$/.test(raw)) return raw;
    if (entry?.PropertyName) return `The portal refused this booking (${entry.PropertyName}).`;
    return "";
  }

  function portalBookingHref(slot) {
    const params = new URLSearchParams({
      resource_id: dialogState.resourceId,
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end).toISOString(),
    });
    return `${portalOrigin()}/${state.webAddress}/public/bookings/edit?${params.toString()}`;
  }

  function paymentHref(invoiceId) {
    return `${portalOrigin()}/${state.webAddress}/checkout/payment?invoice_id=${encodeURIComponent(invoiceId)}`;
  }

  function formatWindow(start, end) {
    const from = new Date(start);
    const to = new Date(end);
    if (from.toDateString() === to.toDateString()) {
      return `${clockLabel(from)} – ${clockLabel(to)} · ${dateLabel(from)}`;
    }
    return `${dateLabel(from)}, ${clockLabel(from)} – ${dateLabel(to)}, ${clockLabel(to)}`;
  }

  function clockLabel(date) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function dateLabel(date) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  }

  function dayLabelOf(day) {
    const [year, month, date] = String(day || "").split("-").map(Number);
    if (!year || !month || !date) return "";
    return dateLabel(new Date(year, month - 1, date));
  }

  function formatPrice(total, currency) {
    const value = Number(total) || 0;
    if (value <= 0) return "";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "EUR",
      }).format(value);
    } catch {
      return `${currency || ""} ${value.toFixed(2)}`.trim();
    }
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
