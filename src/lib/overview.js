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
   * Builds one card per pinned resource, mirroring the web app's widgets:
   * bookings and resource events grouped into day sections, only upcoming items
   * inside the lookahead window, sorted by start time.
   */
  function buildModel(pins, records, now, events = []) {
    const today = dayKey(now);
    const nowStamp = localStamp(now);
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rangeEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + LOOKAHEAD_DAYS,
      23,
      59,
      59,
      999,
    ).getTime();

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

    let total = 0;
    let bookingCount = 0;
    let eventCount = 0;
    const cards = [];
    for (const pin of pinsById.values()) {
      const bookings = [...(byResource.get(pin.id)?.values() || [])].sort(
        (a, b) => a.stamp - b.stamp || a.id.localeCompare(b.id),
      );

      const sections = [];
      for (const booking of bookings) {
        const last = sections[sections.length - 1];
        if (last && last.day === booking.day) last.bookings.push(booking);
        else {
          sections.push({
            day: booking.day,
            label: dayLabel(booking.day, today),
            bookings: [booking],
          });
        }
      }

      for (const booking of bookings) {
        total += 1;
        if (booking.event) eventCount += 1;
        else bookingCount += 1;
      }

      cards.push({
        pin,
        icon: resourceIcon(pin),
        groupLabel: String(pin.group || "").trim(),
        bookings,
        sections,
      });
    }

    return { cards, total, bookingCount, eventCount, today, rangeStart, rangeEnd };
  }

  globalThis.NXPlusOverview = {
    LOOKAHEAD_DAYS,
    buildModel,
    dayLabel,
    normalizePins,
    parseTimestamp,
    rangeFor,
    resourceIcon,
    toPortalIso,
  };
})();
