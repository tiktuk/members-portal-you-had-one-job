/**
 * Turns the portal's calendar payload into the model rendered by overview.html.
 *
 * The page and the unit tests both load this file, so it must stay
 * dependency-free and must not touch `chrome` or `document`.
 */
(() => {
  "use strict";

  /** Same lookahead as the dashboard widgets in the web app. */
  const LOOKAHEAD_DAYS = 14;
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** Mirrors MAX_EVENTS in the web app: at most this many Luma events per card. */
  const MAX_LUMA_EVENTS = 10;

  /**
   * Both `/en/...` feeds return UTC instants, despite the `ignoreTimezone:
   * true` flag. The portal calendar and the web app convert them to the space
   * timezone; read them in the browser's timezone (a `08:00Z` booking shows at
   * 09:00 and a `10:00Z` workshop at 11:00 in Berlin).
   */
  function parseTimestamp(value) {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return {
      day: [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-"),
      time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
      stamp: date.getTime(),
    };
  }

  function localStamp(now) {
    return now.getTime();
  }

  function dayStamp(day) {
    const [year, month, date] = String(day).split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  }

  function dayKey(now) {
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  }

  /** Mirrors the web app's short_day_label: Today, weekday, then "29 Oct". */
  function dayLabel(day, today) {
    const diff = Math.round((dayStamp(day) - dayStamp(today)) / DAY_MS);
    if (diff === 0) return "Today";
    if (diff > 0 && diff < 7) {
      return new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        timeZone: "UTC",
      }).format(new Date(dayStamp(day)));
    }
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(dayStamp(day)));
  }

  function rangeFor(now) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + LOOKAHEAD_DAYS,
      23,
      59,
      59,
      999,
    );
    return { start, end };
  }

  /** ISO timestamp with the browser's offset, like the portal sends. */
  function toPortalIso(date) {
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const absolute = Math.abs(offset);
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
      `.${pad(date.getMilliseconds(), 3)}` +
      `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
    );
  }

  /** `YYYY-MM-DDTHH:MM` local time, the format `/api/public/bookings/my` expects. */
  function toQueryTimestamp(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  function lookaheadEnd(now) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + LOOKAHEAD_DAYS,
      23,
      59,
      59,
      999,
    ).getTime();
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

  const ICON_KEYWORDS = [
    ["podcast", "🎙️"],
    ["bus", "🚌"],
    ["laser", "⚡"],
    ["lazer", "⚡"],
    ["xtool", "⚡"],
    ["sewing", "🧵"],
    ["textile", "🧵"],
    ["welding", "🌩️"],
    ["picomig", "🌩️"],
    ["saw", "🪚"],
    ["cnc", "⚙️"],
    ["lathe", "⚙️"],
    ["metal", "⚙️"],
    ["sandblasting", "💨"],
    ["transfer press", "👕"],
    ["press", "👕"],
    ["iron", "♨️"],
    ["plotter", "✂️"],
    ["3d", "🖨️"],
    ["printer", "🖨️"],
    ["prusa", "🖨️"],
    ["formlabs", "🖨️"],
    ["flashforge", "🖨️"],
    ["wasp", "🖨️"],
    ["planer", "🪵"],
    ["thicknesser", "🪵"],
    ["wood", "🪵"],
    ["gallery", "🖼️"],
    ["main stage", "🎤"],
    ["cafeteria", "☕"],
    ["e-lab", "🔌"],
    ["handtool", "🔨"],
    ["outdoor", "🌲"],
    ["focus", "🎯"],
    ["green", "🌿"],
    ["hackerspace", "💻"],
    ["009", "💬"],
  ];

  /** Same keyword table as the web app's resource_icon(). */
  function resourceIcon(pin) {
    const haystack = `${pin?.name || ""} ${pin?.group || ""} ${pin?.type || ""}`.toLowerCase();
    for (const [keyword, icon] of ICON_KEYWORDS) {
      if (haystack.includes(keyword)) return icon;
    }
    return "";
  }

  function normalizeItem(record, resourceId, kind) {
    const start = parseTimestamp(record.start);
    const end = parseTimestamp(record.end);
    if (!start || !end) return null;

    const isEvent = kind === "event" || record.event === true;
    const fallbackId = `${resourceId}-${start.stamp}`;

    return {
      id: isEvent ? `event-${record.id ?? fallbackId}` : String(record.id ?? fallbackId),
      kind: isEvent ? "event" : "booking",
      luma: false,
      resourceId,
      day: start.day,
      startTime: start.time,
      endTime: end.time,
      allDay: Boolean(record.allDay),
      coworker: isEvent
        ? String(record.title || "Untitled event")
        : String(record.coworkerFullName || "—"),
      tentative: !isEvent && Boolean(record.tentative),
      event: isEvent,
      mine: false,
      description: isEvent ? String(record.shortDescription || "") : "",
      url: isEvent ? String(record.url || "") : "",
      stamp: start.stamp,
      endStamp: end.stamp,
    };
  }

  function normalizeBooking(record, resourceId) {
    return normalizeItem(record, resourceId, "booking");
  }

  function normalizeEvent(record, resourceId) {
    return normalizeItem(record, resourceId, "event");
  }

  /**
   * Luma list entries look like `{ api_id, event: { api_id, name, start_at,
   * end_at, url, geo_address_info } }`. `start_at`/`end_at` are UTC instants,
   * so `parseTimestamp` converts them to the browser timezone like the portal
   * feeds. The description is loaded lazily from `/event/get` when a row is
   * expanded, mirroring the web app's HTMX endpoint.
   */
  function normalizeLumaEvent(entry) {
    const event = entry && entry.event;
    if (!event || typeof event !== "object") return null;

    const eventId = String(event.api_id || entry.api_id || "");
    const start = parseTimestamp(event.start_at);
    const end = parseTimestamp(event.end_at);
    if (!eventId || !start || !end) return null;

    const rawUrl = String(event.url || "");
    const url = rawUrl
      ? /^https?:\/\//i.test(rawUrl)
        ? rawUrl
        : `https://luma.com/${rawUrl.replace(/^\/+/, "")}`
      : "";

    return {
      id: `luma-${eventId}`,
      eventId,
      kind: "luma",
      luma: true,
      event: true,
      resourceId: "",
      day: start.day,
      startTime: start.time,
      endTime: end.time,
      allDay: false,
      coworker: String(event.name || "Untitled event"),
      tentative: false,
      mine: false,
      description: "",
      descriptionLoaded: false,
      url,
      stamp: start.stamp,
      endStamp: end.stamp,
    };
  }

  function groupByDay(items, today) {
    const sections = [];
    for (const item of items) {
      const last = sections[sections.length - 1];
      if (last && last.day === item.day) last.bookings.push(item);
      else {
        sections.push({
          day: item.day,
          label: dayLabel(item.day, today),
          bookings: [item],
        });
      }
    }
    return sections;
  }

  /** Upcoming Luma events in the lookahead window, capped like the web app. */
  function upcomingLumaEvents(records, nowStamp, rangeEnd) {
    const items = [];
    for (const record of Array.isArray(records) ? records : []) {
      const item = normalizeLumaEvent(record);
      if (!item) continue;
      if (item.endStamp <= nowStamp) continue;
      if (item.stamp >= rangeEnd) continue;
      items.push(item);
    }

    items.sort((a, b) => a.stamp - b.stamp || a.id.localeCompare(b.id));
    return items.slice(0, MAX_LUMA_EVENTS);
  }

  /**
   * Builds one card per pinned resource, mirroring the web app's widgets:
   * bookings, resource events and space-wide Luma events grouped into day
   * sections, only upcoming items inside the lookahead window, sorted by start
   * time. Luma events are merged into every card (and My bookings), because
   * they happen at the space rather than occupying a single resource.
   */
  function buildModel(pins, records, now, events = [], lumaEvents = []) {
    const today = dayKey(now);
    const nowStamp = localStamp(now);
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rangeEnd = lookaheadEnd(now);

    const pinsById = new Map();
    for (const pin of normalizePins(pins)) pinsById.set(pin.id, pin);

    const byResource = new Map();
    const addItem = (record, normalize) => {
      if (!record || record.resourceId == null) return;
      const resourceId = String(record.resourceId);
      if (!pinsById.has(resourceId)) return;

      const item = normalize(record, resourceId);
      if (!item) return;
      if (item.endStamp <= nowStamp) return;
      if (item.stamp >= rangeEnd) return;

      let items = byResource.get(resourceId);
      if (!items) {
        items = new Map();
        byResource.set(resourceId, items);
      }
      if (!items.has(item.id)) items.set(item.id, item);
    };

    for (const record of Array.isArray(records) ? records : []) addItem(record, normalizeBooking);
    for (const record of Array.isArray(events) ? events : []) addItem(record, normalizeEvent);

    const lumaItems = upcomingLumaEvents(lumaEvents, nowStamp, rangeEnd);

    let bookingCount = 0;
    let eventCount = 0;
    let lumaCount = 0;
    const seenLuma = new Set();
    const cards = [];
    for (const pin of pinsById.values()) {
      const merged = new Map(byResource.get(pin.id) || []);
      for (const item of lumaItems) merged.set(item.id, item);

      const bookings = [...merged.values()].sort(
        (a, b) => a.stamp - b.stamp || a.id.localeCompare(b.id),
      );

      for (const booking of bookings) {
        if (booking.luma) {
          // The same event is shown in every card; count it once.
          if (!seenLuma.has(booking.id)) {
            seenLuma.add(booking.id);
            lumaCount += 1;
          }
        } else if (booking.event) {
          eventCount += 1;
        } else {
          bookingCount += 1;
        }
      }

      cards.push({
        pin,
        icon: resourceIcon(pin),
        groupLabel: String(pin.group || "").trim(),
        bookings,
        sections: groupByDay(bookings, today),
      });
    }

    const total = bookingCount + eventCount + lumaCount;
    return {
      cards,
      total,
      bookingCount,
      eventCount,
      lumaCount,
      today,
      rangeStart,
      rangeEnd,
    };
  }

  /**
   * `/api/public/bookings/my` returns the member's bookings across every
   * resource with naive local `FromTime`/`ToTime` values, so no timezone
   * conversion is needed.
   */
  function normalizeMyBooking(record) {
    const start = parseTimestamp(record.FromTime || record.fromTime || record.start);
    const end = parseTimestamp(record.ToTime || record.toTime || record.end);
    if (!start || !end) return null;

    const resourceName = String(record.ResourceName || record.Resource?.Name || "—").trim();

    return {
      id: String(record.Id ?? `${record.ResourceId}-${start.stamp}`),
      kind: "booking",
      luma: false,
      resourceId: record.ResourceId != null ? String(record.ResourceId) : "",
      resourceName,
      /** Names the member, so a booking can be created even without a profile fetch. */
      coworkerId: record.CoworkerId != null ? String(record.CoworkerId) : "",
      day: start.day,
      startTime: start.time,
      endTime: end.time,
      allDay: Boolean(record.AllDay),
      coworker: resourceName,
      tentative: Boolean(record.Tentative),
      event: false,
      mine: true,
      description: "",
      url: "",
      stamp: start.stamp,
      endStamp: end.stamp,
    };
  }

  function buildMyBookings(records, now, lumaEvents = []) {
    const today = dayKey(now);
    const nowStamp = localStamp(now);
    const rangeEnd = lookaheadEnd(now);

    const items = [];
    const seen = new Set();
    let count = 0;
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || record.Cancelled === true) continue;
      const item = normalizeMyBooking(record);
      if (!item) continue;
      if (item.endStamp <= nowStamp) continue;
      if (item.stamp >= rangeEnd) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      count += 1;
    }

    const lumaItems = upcomingLumaEvents(lumaEvents, nowStamp, rangeEnd);
    for (const item of lumaItems) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }

    items.sort((a, b) => a.stamp - b.stamp || a.id.localeCompare(b.id));
    return {
      items,
      sections: groupByDay(items, today),
      count,
      eventCount: lumaItems.length,
    };
  }

  /**
   * Marks the pinned-card rows that also appear in the member's own bookings.
   * Only those have a booking page the member can open; other members'
   * bookings are not editable through the portal.
   */
  function markOwnedBookings(model, myModel) {
    const mineIds = new Set((myModel?.items || []).map((item) => item.id));
    for (const card of model?.cards || []) {
      for (const item of card.bookings) item.mine = mineIds.has(item.id);
    }
    return model;
  }

  /* ------------------------------------------------------------------ *
   * Booking the gap before or after a row
   * ------------------------------------------------------------------ */

  /**
   * The slot that butts up against `booking`: "before" keeps its start as the
   * new end, "after" keeps its end as the new start. Returns epoch stamps, or
   * null when there is no usable duration or side.
   */
  function bookingWindow(booking, side, minutes) {
    if (!booking || (side !== "before" && side !== "after")) return null;
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return null;

    const edge = side === "before" ? booking.stamp : booking.endStamp;
    if (!Number.isFinite(edge)) return null;

    const delta = value * 60 * 1000;
    return side === "before"
      ? { start: edge - delta, end: edge }
      : { start: edge, end: edge + delta };
  }

  /**
   * The portal's checkout basket item, exactly as its own booking form posts
   * it. `FromTime`/`ToTime` are absolute instants, so the portal's
   * `X-Use-Timezone` handling puts them in the space timezone.
   */
  function basketBody({ resourceId, coworkerId, coworkerName, start, end }) {
    const booking = {
      ResourceId: Number(resourceId),
      FromTime: new Date(start).toISOString(),
      ToTime: new Date(end).toISOString(),
      FloorPlanDeskId: null,
      CoworkerId: Number(coworkerId),
      ChargeNow: false,
      BookingVisitors: [],
      BookingProducts: [],
      CustomFields: { Data: [] },
      Id: 0,
    };
    if (coworkerName) booking.CoworkerFullName = String(coworkerName);

    return {
      Basket: [{ Type: "booking", Booking: booking }],
      agreedTermsAndConditions: true,
      createZeroValueInvoice: true,
    };
  }

  /**
   * `/api/public/coworkers/profiles` lists every profile the session may book
   * for; the portal starts on the default one.
   */
  function defaultProfile(payload) {
    const profiles = Array.isArray(payload?.Profiles) ? payload.Profiles : [];
    const profile = profiles.find((item) => item && item.IsDefaultProfile) || profiles[0];
    if (!profile || profile.Id == null || Number(profile.Id) <= 0) return null;
    return { id: Number(profile.Id), name: String(profile.FullName || "").trim() };
  }

  /** A resource's booking increment (`IntervalLimit`), in minutes. */
  function resourceInterval(resource) {
    const value = Number(resource?.IntervalLimit);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }

  /** "30 min", "1 h", "1 h 30 min" — the portal's duration wording. */
  function durationLabel(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) return `${rest} min`;
    if (!rest) return `${hours} h`;
    return `${hours} h ${rest} min`;
  }

  /**
   * The checkout endpoint reports failures as a `PropertyName` code plus an
   * optional `AttemptedValue` (the interval or duration limit). Mirrors the
   * portal's own table; returns null for codes it does not know, so the caller
   * can show the server's message instead.
   */
  function bookingError(code, param) {
    const limit = Number(param) > 0 ? durationLabel(param) : "";
    switch (code) {
      case "INVALID_SHIFT":
        return "The selected start and end times are invalid for this resource. Pick a valid time slot.";
      case "INVALID_INTERVAL":
        return limit
          ? `Duration must be in blocks of ${limit}.`
          : "You cannot make a booking of this length.";
      case "BOOKING_CONFLICT":
        return "The resource is already booked at that time.";
      case "EVENT_CONFLICT":
        return "There is an event already scheduled at that time.";
      case "RESOURCE_FULL":
        return "The resource is fully booked. Pick another date or time.";
      case "AREA_FULL":
        return "The area this resource is in is fully booked. Pick another date or time.";
      case "NO_PAST_BOOKINGS":
        return "Bookings cannot end in the past.";
      case "HARD_LIMIT_WEEK":
        return "You have made too many bookings this week.";
      case "HARD_LIMIT_MONTH":
        return "You have made too many bookings this month.";
      case "INVALID_TARIFF":
        return "You are not on the plan that can book this resource.";
      case "INVALID_TEAM":
        return "You are not in the team that can book this resource.";
      case "FOR_CONTACTS_ONLY":
        return "Only customers without a plan can book this resource.";
      case "FOR_MEMBERS_ONLY":
        return "Only members with an active plan can book this resource.";
      case "NOT_AVAILABLE":
        return "This resource is not available at that time.";
      case "START_TIME_TOO_EARLY":
        return "You cannot book this resource this far in advance.";
      case "START_TIME_TOO_LATE":
        return "You cannot book this resource this late.";
      case "TOO_LONG":
        return limit ? `The booking is too long. Maximum duration is ${limit}.` : "The booking is too long.";
      case "TOO_SHORT":
        return limit ? `The booking is too short. Minimum duration is ${limit}.` : "The booking is too short.";
      case "NO_RETURN_POLICY":
        return "This resource cannot be booked this soon after another booking.";
      case "NO_CREDIT":
        return "You do not have enough credit to book this resource.";
      case "INVALID_DESK":
        return "That desk is not connected to this resource.";
      case "CHECKOUT TC MISSING":
        return "You must agree to the terms and conditions before checking out.";
      default:
        return null;
    }
  }

  /**
   * The portal's cancellation reasons, in its own order. The API rejects a
   * cancellation without one, and "Other" needs a free-text detail.
   */
  const CANCEL_REASONS = [
    { value: "", label: "-" },
    { value: "NoLongerNeeded", label: "No longer needed" },
    { value: "TooExpensive", label: "Too expensive" },
    { value: "BadPreviousExperience", label: "Bad previous experience" },
    { value: "RebookedForADifferentTime", label: "Re-booked for a different time" },
    { value: "Other", label: "Other" },
  ];

  /** The body the portal sends to `DELETE /api/public/bookings/<id>`. */
  function cancelBody(id, reason, details) {
    return {
      id: Number(id),
      cancellationReason: String(reason || ""),
      cancellationReasonDetails: reason === "Other" ? String(details || "") : "",
    };
  }

  /**
   * `DELETE /api/public/bookings/<id>` refuses with a code in `Message` (or a
   * `BREAKS_CANCELLATION_POLICY|<minutes>` variant). Mirrors the portal's
   * `getBookingError`; null for codes it does not know.
   */
  function cancelError(code) {
    const value = String(code || "");
    if (value.startsWith("BREAKS_CANCELLATION_POLICY")) {
      const minutes = Number(value.split("|").pop());
      return Number(minutes) > 0
        ? `This booking cannot be cancelled: cancellations must be made at least ${durationLabel(minutes)} before the start.`
        : "This booking cannot be cancelled because it is inside the cancellation policy window.";
    }

    switch (value) {
      case "ALREADY_INVOICED":
        return "This booking has already been invoiced, so it cannot be cancelled. Contact your administrator.";
      case "NO_ACCESS":
        return "You do not have permission to cancel this booking.";
      case "CHANGE_NOT_ALLOWED":
        return "You cannot change this booking. Contact your administrator.";
      case "CANNOT_CANCEL_IF_STARTED":
        return "You cannot cancel a booking that already started.";
      default:
        return null;
    }
  }

  /**
   * Milliseconds of free time immediately before/after `booking` on its
   * resource; Infinity when no row is in the way, and <= 0 when the resource is
   * busy up to that edge (back-to-back or overlapping rows).
   *
   * Overlapping rows count as busy, so this looks at the frontier of every row
   * that starts earlier (or ends later), not just the neighbouring row in the
   * list. Luma events are space-wide and occupy nothing, so they are ignored.
   */
  function rowGap(items, booking, side) {
    if (!booking || (side !== "before" && side !== "after")) return 0;
    if (!Number.isFinite(booking.stamp) || !Number.isFinite(booking.endStamp)) return 0;

    const rows = (Array.isArray(items) ? items : []).filter(
      (item) =>
        item &&
        item !== booking &&
        item.resourceId &&
        item.resourceId === booking.resourceId &&
        item.kind !== "luma",
    );

    if (side === "before") {
      let frontier = -Infinity;
      for (const item of rows) {
        if (item.stamp < booking.stamp) frontier = Math.max(frontier, item.endStamp);
      }
      return frontier === -Infinity ? Infinity : booking.stamp - frontier;
    }

    let frontier = Infinity;
    for (const item of rows) {
      if (item.endStamp > booking.endStamp) frontier = Math.min(frontier, item.stamp);
    }
    return frontier === Infinity ? Infinity : frontier - booking.endStamp;
  }

  globalThis.OneJobOverview = {
    CANCEL_REASONS,
    LOOKAHEAD_DAYS,
    MAX_LUMA_EVENTS,
    basketBody,
    bookingError,
    bookingWindow,
    buildModel,
    buildMyBookings,
    cancelBody,
    cancelError,
    dayLabel,
    defaultProfile,
    durationLabel,
    markOwnedBookings,
    normalizeLumaEvent,
    normalizePins,
    parseTimestamp,
    rangeFor,
    resourceIcon,
    resourceInterval,
    rowGap,
    toPortalIso,
    toQueryTimestamp,
  };
})();
