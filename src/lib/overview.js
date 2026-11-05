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

  globalThis.OneJobOverview = {
    LOOKAHEAD_DAYS,
    MAX_LUMA_EVENTS,
    buildModel,
    buildMyBookings,
    dayLabel,
    markOwnedBookings,
    normalizeLumaEvent,
    normalizePins,
    parseTimestamp,
    rangeFor,
    resourceIcon,
    toPortalIso,
    toQueryTimestamp,
  };
})();
