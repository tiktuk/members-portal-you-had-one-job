/* global chrome, NXPlusConfig, NXPlusUrl, NXPlusOverview */
(() => {
  "use strict";

  const cfg = NXPlusConfig;
  const U = NXPlusUrl;
  const O = NXPlusOverview;

  const REFRESH_MS = 60 * 1000;

  const summary = document.getElementById("summary");
  const notice = document.getElementById("notice");
  const cards = document.getElementById("cards");
  const myBookings = document.getElementById("my-bookings");
  const refreshButton = document.getElementById("refresh");
  const portalLink = document.getElementById("portal-link");

  const PERSON_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>';

  const state = {
    pins: [],
    session: null,
    webAddress: cfg.portal.webAddress,
    model: null,
    myModel: null,
    loading: false,
    error: null,
    eventsError: null,
    myBookingsError: null,
    updatedAt: null,
  };

  init();

  async function init() {
    portalLink.href = `${cfg.portal.origin}/`;
    refreshButton.addEventListener("click", () => load());

    [state.pins, state.session] = await Promise.all([
      get(cfg.storageKeys.pins),
      get(cfg.storageKeys.session),
    ]);
    state.pins = O.normalizePins(state.pins);
    state.webAddress = state.session?.webAddress || state.webAddress;

    chrome.storage.onChanged.addListener(onStorageChanged);

    render();
    await load();

    setInterval(() => {
      if (!document.hidden && !state.loading) load();
    }, REFRESH_MS);
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    let reload = false;

    if (changes[cfg.storageKeys.pins]) {
      state.pins = O.normalizePins(changes[cfg.storageKeys.pins].newValue);
      state.model = null;
      reload = true;
    }
    if (changes[cfg.storageKeys.session]) {
      state.session = changes[cfg.storageKeys.session].newValue || null;
      state.webAddress = state.session?.webAddress || cfg.portal.webAddress;
      reload = true;
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

  async function load() {
    const session = currentSession();
    if (session.status !== "ok") {
      state.loading = false;
      state.model = null;
      state.myModel = null;
      state.error = null;
      state.eventsError = null;
      state.myBookingsError = null;
      render();
      return;
    }

    const hasPins = state.pins.length > 0;
    state.loading = true;
    state.error = null;
    state.eventsError = null;
    state.myBookingsError = null;
    render();

    try {
      const [myResult, bookingsResult, eventsResult] = await Promise.allSettled([
        fetchMyBookings(session),
        hasPins ? fetchBookings(session) : Promise.resolve([]),
        hasPins ? fetchEvents(session) : Promise.resolve([]),
      ]);

      state.myBookingsError = myResult.status === "rejected" ? myResult.reason : null;
      state.myModel =
        myResult.status === "fulfilled" ? O.buildMyBookings(myResult.value, new Date()) : null;

      if (hasPins) {
        if (bookingsResult.status === "rejected") throw bookingsResult.reason;
        const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
        state.eventsError = eventsResult.status === "rejected" ? eventsResult.reason : null;
        state.model = O.buildModel(state.pins, bookingsResult.value, new Date(), events);
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
    const session = currentSession();
    refreshButton.disabled = state.loading;
    refreshButton.textContent = state.loading ? "Refreshing…" : "Refresh";

    summary.textContent = summaryText(session);
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
      return `${plural(state.myModel.count, "booking")} of yours in the next 14 days${updated}`;
    }

    if (!state.model) return "Loading bookings…";

    const parts = [
      plural(state.pins.length, "pinned resource"),
      plural(state.model.bookingCount, "booking"),
    ];
    if (state.model.eventCount) parts.push(plural(state.model.eventCount, "event"));
    return `${parts.join(" · ")} in the next 14 days${updated}`;
  }

  function renderNotice(session) {
    if (session.status === "missing") {
      showNotice({
        title: "Connect to the members portal",
        message:
          "Open the portal once while signed in so the extension can use your session to load bookings.",
        linkLabel: "Open members portal ↗",
        href: `${cfg.portal.origin}/`,
      });
      return;
    }

    if (session.status === "expired") {
      showNotice({
        title: "Your portal session expired",
        message: "Open the members portal, then refresh this page to load bookings again.",
        linkLabel: "Open members portal ↗",
        href: `${cfg.portal.origin}/`,
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
        href: `${cfg.portal.origin}/`,
        error: true,
      });
      return;
    }

    const warnings = [];
    if (state.myBookingsError) warnings.push("your own bookings");
    if (state.eventsError) warnings.push("workshop reservations");
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
    notice.hidden = false;
    notice.className = `notice${error ? " error" : warning ? " warning" : ""}`;
    notice.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = title;

    const text = document.createElement("p");
    text.textContent = message;
    if (linkLabel && href) {
      text.append(" ");
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = linkLabel;
      text.append(link);
    }

    notice.append(heading, text);
  }

  function hideNotice() {
    notice.hidden = true;
    notice.replaceChildren();
  }

  function renderMyBookings(session) {
    myBookings.replaceChildren();
    if (session.status === "ok") myBookings.appendChild(myBookingsCard());
  }

  function myBookingsCard() {
    const article = document.createElement("article");
    article.className = "card my-bookings-card";

    const head = document.createElement("div");
    head.className = "card-head";

    const icon = document.createElement("div");
    icon.className = "resource-icon my-bookings-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = PERSON_ICON;

    const titles = document.createElement("div");
    titles.className = "card-titles";
    const heading = document.createElement("h2");
    heading.textContent = "My bookings";
    const subtitle = document.createElement("p");
    subtitle.className = "card-subtitle";
    if (state.myBookingsError) {
      subtitle.textContent = "Across every resource · unavailable";
    } else if (state.myModel) {
      subtitle.textContent = `Across every resource · ${plural(state.myModel.count, "booking")}`;
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
      const list = document.createElement("div");
      list.className = "booking-list";
      for (const section of state.myModel.sections) list.appendChild(dayRow(section));
      article.appendChild(list);
    }

    return article;
  }

  function cardMessage(text) {
    const element = document.createElement("p");
    element.className = "card-empty";
    element.textContent = text;
    return element;
  }

  function renderCards(session) {
    cards.replaceChildren();

    if (!state.pins.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const heading = document.createElement("h2");
      heading.textContent = "No pinned resources yet";
      const text = document.createElement("p");
      text.textContent =
        "Open the members portal, expand a group in the Filters menu and press the pin icon next to a resource.";
      empty.append(heading, text);
      cards.appendChild(empty);
      return;
    }

    if (session.status !== "ok" || !state.model) return;

    for (const card of state.model.cards) {
      cards.appendChild(cardElement(card));
    }
  }

  function cardElement(card) {
    const article = document.createElement("article");
    article.className = "card";

    const head = document.createElement("div");
    head.className = "card-head";

    const icon = document.createElement("div");
    icon.className = `resource-icon type-${typeClass(card.pin.type)}`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = card.icon || firstLetter(card.pin.name);

    const titles = document.createElement("div");
    titles.className = "card-titles";
    const heading = document.createElement("h2");
    heading.textContent = card.pin.name || `Resource ${card.pin.id}`;
    const subtitle = document.createElement("p");
    subtitle.className = "card-subtitle";
    subtitle.textContent = card.groupLabel || typeLabel(card.pin.type);
    titles.append(heading, subtitle);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const link = document.createElement("a");
    link.className = "card-link";
    link.href = calendarHref(card.pin);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Calendar ↗";
    link.title = `Open ${card.pin.name || "resource"} in the calendar`;

    const unpin = document.createElement("button");
    unpin.type = "button";
    unpin.className = "unpin";
    unpin.title = "Unpin resource";
    unpin.setAttribute("aria-label", `Unpin ${card.pin.name || card.pin.id}`);
    unpin.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>';
    unpin.addEventListener("click", () => unpinResource(card.pin));

    actions.append(link, unpin);
    head.append(icon, titles, actions);
    article.appendChild(head);

    if (!card.sections.length) {
      const empty = document.createElement("p");
      empty.className = "card-empty";
      empty.textContent = "No bookings or events in the next 14 days.";
      article.appendChild(empty);
      return article;
    }

    const list = document.createElement("div");
    list.className = "booking-list";
    for (const section of card.sections) {
      list.appendChild(dayRow(section));
    }
    article.appendChild(list);
    return article;
  }

  function dayRow(section) {
    const row = document.createElement("div");
    row.className = "day-row";

    const label = document.createElement("div");
    label.className = "day-label";
    label.textContent = section.label;

    const items = document.createElement("div");
    items.className = "day-bookings";

    for (const booking of section.bookings) {
      items.appendChild(booking.event ? eventEntry(booking) : bookingEntry(booking));
    }

    row.append(label, items);
    return row;
  }

  function bookingEntry(booking) {
    const entry = document.createElement("div");
    entry.className = "booking";

    const who = document.createElement("span");
    who.className = "booking-who";
    who.textContent = booking.coworker;

    entry.append(timeLabel(booking), who);
    if (booking.tentative) entry.appendChild(badge("Tentative"));
    return entry;
  }

  function eventEntry(booking) {
    const entry = document.createElement("div");
    entry.className = "booking booking-event";
    entry.appendChild(timeLabel(booking));

    const title = document.createElement("span");
    title.className = "booking-who";
    title.textContent = booking.coworker;

    if (!booking.description && !booking.url) {
      entry.append(title, badge("Reserved", "badge-event"));
      return entry;
    }

    const details = document.createElement("details");
    details.className = "event-details";

    const summary = document.createElement("summary");
    summary.className = "event-summary";
    summary.append(title, badge("Reserved", "badge-event"));

    const body = document.createElement("div");
    body.className = "event-body";
    if (booking.description) {
      const description = document.createElement("p");
      description.textContent = booking.description;
      body.appendChild(description);
    }
    if (booking.url) {
      const link = document.createElement("a");
      link.href = eventHref(booking.url);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View event ↗";
      body.appendChild(link);
    }

    details.append(summary, body);
    entry.appendChild(details);
    return entry;
  }

  function timeLabel(booking) {
    const time = document.createElement("span");
    time.className = "booking-time";
    time.textContent = booking.allDay ? "All day" : `${booking.startTime}–${booking.endTime}`;
    return time;
  }

  function badge(label, extraClass) {
    const element = document.createElement("span");
    element.className = `badge${extraClass ? ` ${extraClass}` : ""}`;
    element.textContent = label;
    return element;
  }

  function eventHref(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `${cfg.portal.origin}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  function calendarHref(pin) {
    const path = U.bookingHref({
      webAddress: state.webAddress,
      type: pin.type || "all",
      view: "calendar",
      group: pin.group,
      resource: pin.id,
    });
    return `${cfg.portal.origin}${path}`;
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
