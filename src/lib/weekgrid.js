/**
 * The category week grid: seven days across, one narrow column per resource
 * inside each day and one shared hour axis, so every machine of a category can
 * be compared at the same hour.
 *
 * Loaded by the content script and the unit tests, so it must stay
 * dependency-free and must not touch `chrome` or `document`. Timestamps are
 * epoch milliseconds in the browser's timezone, like `lib/stats.js`.
 */
(() => {
  "use strict";

  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function mondayOnOrBefore(date) {
    const day = startOfDay(date);
    return addDays(day, -((day.getDay() + 6) % 7));
  }

  function wholeHour(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  /** The Monday-aligned week containing `date`, shifted by `offset` weeks. */
  function weekRange(date = new Date(), offset = 0) {
    const start = addDays(mondayOnOrBefore(date), Math.round(Number(offset) || 0) * 7);
    return { start, end: addDays(start, 7) };
  }

  /**
   * Hide elapsed days only for the week containing today. Historical weeks
   * remain browseable in full, and future weeks keep their seven days.
   */
  function visibleDays(days) {
    const entries = Array.isArray(days) ? days : [];
    return entries.some((day) => day?.isToday)
      ? entries.filter((day) => !day?.isPast)
      : entries;
  }

  function machineColorMap(resources) {
    const families = new Map();
    for (const resource of Array.isArray(resources) ? resources : []) {
      if (!resource || resource.id == null) continue;
      const family = machineFamily(resource.name, resource.id);
      if (!families.has(family)) families.set(family, []);
      families.get(family).push(resource);
    }

    const paletteSize = 16;
    const paletteIndices = new Map();
    const usedIndices = new Set();
    for (const family of [...families.keys()].sort()) {
      const preferred = stableHash(family) % paletteSize;
      let index = preferred;
      while (usedIndices.has(index) && usedIndices.size < paletteSize) {
        index = (index + 1) % paletteSize;
      }
      paletteIndices.set(family, index);
      usedIndices.add(index);
    }

    const colors = new Map();
    for (const [family, members] of families) {
      members.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "en", { numeric: true, sensitivity: "base" }) ||
        String(a.id).localeCompare(String(b.id)),
      );
      members.forEach((resource, index) => {
        const shade = members.length === 1
          ? 14
          : 8 + Math.round((index / (members.length - 1)) * 16);
        colors.set(String(resource.id), {
          family,
          paletteIndex: paletteIndices.get(family),
          shade,
        });
      });
    }
    return colors;
  }

  function machineFamily(name, id) {
    const normalized = String(name || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (/\bhammer\b/.test(normalized)) return "hammer";
    if (/^meeting room\b/.test(normalized)) return "meeting-room";
    return normalized.split(/\s+/)[0] || `resource-${id}`;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hourLabel(hour) {
    return `${pad(hour)}:00`;
  }

  /**
   * Whether a booking is the member's: by id, by the member the feed names
   * (`options.me`) or by time on the resource (`options.mine`). The last two
   * keep a finished booking marked, which `/api/public/bookings/my` omits.
   */
  function ownership(options = {}) {
    const me = options.me && typeof options.me === "object" ? options.me : null;
    const myId = me && me.id != null ? String(me.id) : "";
    const myName = me && me.name ? String(me.name).trim() : "";
    const mine = (Array.isArray(options.mine) ? options.mine : [])
      .filter(Boolean)
      .map((booking) => ({
        id: booking.id != null ? String(booking.id) : "",
        resourceId: booking.resourceId != null ? String(booking.resourceId) : "",
        start: Number(booking.start),
        end: Number(booking.end),
      }))
      .filter((booking) => Number.isFinite(booking.start) && Number.isFinite(booking.end));
    const mineIds = new Set(mine.map((booking) => booking.id).filter(Boolean));

    // A record that names its member is judged by who that is; the time match
    // is only for records that do not, or it would claim a tentative booking
    // that merely overlaps one of the member's own.
    const known = myId !== "" || myName !== "";
    return (record, id = record.id != null ? String(record.id) : "") =>
      mineIds.has(id) ||
      (myId !== "" && record.coworkerId === myId) ||
      (myName !== "" && record.coworkerName === myName) ||
      (!(known && (record.coworkerId || record.coworkerName)) &&
        mine.some(
          (booking) =>
            (!booking.resourceId || booking.resourceId === String(record.resourceId)) &&
            booking.start < record.end &&
            booking.end > record.start,
        ));
  }

  /** The ids of resources the member has a booking on (`options` as for `weekGrid`). */
  function ownedResourceIds(records, options = {}) {
    const isOwned = ownership(options);
    const ids = new Set();
    for (const record of Array.isArray(records) ? records : []) {
      if (record && isOwned(record)) ids.add(String(record.resourceId));
    }
    for (const booking of Array.isArray(options.mine) ? options.mine : []) {
      if (booking && booking.resourceId != null && booking.resourceId !== "") ids.add(String(booking.resourceId));
    }
    return ids;
  }

  /**
   * Bookings take their `count` of adjacent capacity lanes. Over-capacity
   * overlaps extend the lane count so no booking is hidden.
   */
  function assignLanes(blocks) {
    let cluster = [];
    let clusterEnd = -Infinity;
    let peak = 0;
    const close = () => {
      peak = Math.max(
        peak,
        cluster.reduce((max, block) => Math.max(max, block.lane + block.unitCount), 0),
      );
      cluster = [];
    };
    const laneEnds = [];
    for (const block of blocks) {
      if (block.start >= clusterEnd) {
        close();
        laneEnds.length = 0;
        clusterEnd = -Infinity;
      }
      const units = Math.max(1, Math.floor(Number(block.count) || 1));
      let lane = -1;
      for (let candidate = 0; candidate <= laneEnds.length; candidate += 1) {
        let available = true;
        for (let offset = 0; offset < units; offset += 1) {
          if ((laneEnds[candidate + offset] ?? -Infinity) > block.start) {
            available = false;
            break;
          }
        }
        if (available) {
          lane = candidate;
          break;
        }
      }
      if (lane < 0) lane = laneEnds.length;
      for (let offset = 0; offset < units; offset += 1) laneEnds[lane + offset] = block.end;
      block.lane = lane;
      block.unitCount = units;
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.end);
    }
    close();
    return peak;
  }

  /**
   * Builds the grid for one week.
   *
   * `resources` is the category's `[{ id, name, allocation, ... }]` in display order
   * (`allocation` defaults to one) and
   * `records` the normalised bookings (`S.normalizeRecords(payload, parse,
   * { perResource: true })`). Records are matched per resource, so a linked
   * booking shows on every machine it blocks.
   *
   * Options: `weekStart` (Date), `hourFrom`/`hourTo` (the visible window; it
   * grows to include any booking outside it, so nothing is hidden),
   * `mine` (`{ id, resourceId, start, end }` from `/api/public/bookings/my`),
   * `me` (`{ id, name }`), `events` (Luma `{ start, end, name }`), `reserved`
   * (workshop reservations `{ resourceId, start, end, name }`, which block a
   * machine like a booking and get `reserved: true`) and `now`.
   *
   * A block carries `rawStart`/`rawEnd` (the whole booking) next to `start`/
   * `end` (clipped to its day and the window) so a booking that spans midnight
   * is drawn on both days but still reports its real times.
   */
  function weekGrid(records, resources, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const range = weekRange(options.weekStart instanceof Date ? options.weekStart : now);
    const rangeStart = range.start.getTime();
    const rangeEnd = range.end.getTime();
    let hourFrom = wholeHour(options.hourFrom, 6, 0, 23);
    let hourTo = wholeHour(options.hourTo, 22, hourFrom + 1, 24);

    const columns = (Array.isArray(resources) ? resources : [])
      .filter((resource) => resource && resource.id != null)
      .map((resource) => ({
        id: String(resource.id),
        name: String(resource.name || ""),
        capacity: Number.isFinite(Number(resource.allocation)) && Number(resource.allocation) > 0
          ? Math.floor(Number(resource.allocation))
          : 1,
        resource,
      }));
    const byId = new Map(columns.map((column) => [column.id, column]));

    const isOwned = ownership(options);

    const days = [];
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(range.start, index);
      const today = startOfDay(now).getTime();
      days.push({
        key: dayKey(date),
        date,
        index,
        isToday: date.getTime() === today,
        isPast: date.getTime() < today,
        isWeekend: index >= 5,
        columns: columns.map((column) => ({
          resourceId: column.id,
          name: column.name,
          capacity: column.capacity,
          visibleLanes: 1,
          blocks: [],
        })),
        events: [],
      });
    }

    const seen = new Set();
    const twins = new Map();
    const segments = [];
    for (const record of Array.isArray(records) ? records : []) {
      if (!record) continue;
      const resourceId = String(record.resourceId);
      if (!byId.has(resourceId)) continue;
      const id = record.id != null ? String(record.id) : `${resourceId}-${record.start}`;
      const key = `${id}|${resourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // The feed can hold several bookings of one member on one machine in the
      // same slot (a resource that allows multiple bookings). The portal draws
      // that once, so do we, and say how many there were.
      const who = record.coworkerId || record.coworkerName;
      const twin = who ? `${resourceId}|${record.start}|${record.end}|${who}` : "";
      const owned = isOwned(record, id);
      if (twin && twins.has(twin)) {
        const first = twins.get(twin);
        first.count += 1;
        first.owned = first.owned || owned;
        continue;
      }
      const group = { count: 1, owned };
      if (twin) twins.set(twin, group);

      const recordStart = Number(record.start);
      const recordEnd = Number(record.end);
      if (!Number.isFinite(recordStart) || !Number.isFinite(recordEnd) || recordEnd <= recordStart) continue;
      if (recordEnd <= rangeStart || recordStart >= rangeEnd) continue;

      for (const day of days) {
        const dayStart = day.date.getTime();
        const dayEnd = addDays(day.date, 1).getTime();
        const from = Math.max(recordStart, dayStart);
        const to = Math.min(recordEnd, dayEnd);
        if (to <= from) continue;
        segments.push({
          day,
          resourceId,
          group,
          block: {
            id,
            resourceId,
            start: from,
            end: to,
            rawStart: recordStart,
            rawEnd: recordEnd,
            count: 1,
            mine: owned,
            linked: record.linked === true,
            name: record.coworkerName || "",
          },
        });
      }
    }

    for (const { block, group } of segments) {
      if (!group) continue;
      block.count = group.count;
      block.mine = block.mine || group.owned;
    }

    // Reserved blocks also land on columns linked to the event's resource:
    // a workshop on a lab blocks its machines even though the events feed
    // names only the lab's id (options.links is id -> linked ids, both ways).
    const links = options.links && typeof options.links.get === "function" ? options.links : null;
    const seenReserved = new Set();
    for (const event of Array.isArray(options.reserved) ? options.reserved : []) {
      if (!event || event.resourceId == null) continue;
      const ownId = String(event.resourceId);
      const eventStart = Number(event.start);
      const eventEnd = Number(event.end);
      if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) continue;
      const targets = [ownId];
      if (links) for (const linkedId of links.get(ownId) || []) targets.push(linkedId);
      for (const resourceId of targets) {
        if (!byId.has(resourceId)) continue;
        for (const day of days) {
          const from = Math.max(eventStart, day.date.getTime());
          const to = Math.min(eventEnd, addDays(day.date, 1).getTime());
          if (to <= from) continue;
          const key = `${resourceId}-${from}-${to}-${event.name ?? ""}`;
          if (seenReserved.has(key)) continue;
          seenReserved.add(key);
          segments.push({
            day,
            resourceId,
            block: {
              id: `reserved-${resourceId}-${eventStart}`,
              resourceId,
              start: from,
              end: to,
              rawStart: eventStart,
              rawEnd: eventEnd,
              count: 1,
              mine: false,
              linked: event.linked === true || resourceId !== ownId,
              reserved: true,
              name: String(event.name || "Reserved"),
            },
          });
        }
      }
    }

    // Grow the window so no booking falls outside it.
    for (const { day, block } of segments) {
      const dayStart = day.date.getTime();
      hourFrom = Math.min(hourFrom, Math.floor((block.start - dayStart) / HOUR_MS));
      hourTo = Math.max(hourTo, Math.ceil((block.end - dayStart) / HOUR_MS));
    }
    hourFrom = Math.max(0, hourFrom);
    hourTo = Math.min(24, hourTo);
    const windowHours = hourTo - hourFrom;

    const position = (day, from, to) => {
      const base = day.date.getTime() + hourFrom * HOUR_MS;
      const top = ((from - base) / HOUR_MS / windowHours) * 100;
      const height = ((to - from) / HOUR_MS / windowHours) * 100;
      return { top, height };
    };

    for (const { day, resourceId, block } of segments) {
      const column = day.columns.find((entry) => entry.resourceId === resourceId);
      column.blocks.push({ ...block, ...position(day, block.start, block.end) });
    }
    for (const day of days) {
      for (const column of day.columns) {
        column.blocks.sort((a, b) => a.start - b.start);
        const peak = assignLanes(column.blocks);
        // Keep one spare visual lane where capacity permits; availability still
        // uses the full Allocation in slotAt.
        column.visibleLanes = peak >= column.capacity ? peak : Math.max(1, peak + 1);
        for (const block of column.blocks) block.lanes = column.visibleLanes;
      }
    }

    for (const event of Array.isArray(options.events) ? options.events : []) {
      if (!event) continue;
      const eventStart = Number(event.start);
      const eventEnd = Number(event.end);
      if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) continue;
      for (const day of days) {
        const base = day.date.getTime() + hourFrom * HOUR_MS;
        const limit = day.date.getTime() + hourTo * HOUR_MS;
        const from = Math.max(eventStart, base);
        const to = Math.min(eventEnd, limit);
        if (to <= from) continue;
        day.events.push({
          name: String(event.name || ""),
          start: eventStart,
          end: eventEnd,
          ...position(day, from, to),
        });
      }
    }

    return {
      start: range.start,
      end: range.end,
      hourFrom,
      hourTo,
      hours: Array.from({ length: windowHours }, (_, index) => ({
        hour: hourFrom + index,
        label: hourLabel(hourFrom + index),
      })),
      resources: columns.map((column) => ({
        id: column.id,
        name: column.name,
        allocation: column.capacity,
      })),
      days,
    };
  }

  /**
   * What a click at `stamp` on a resource's day column means: `occupied` when
   * all allocated units are in use during the snapped interval, otherwise the
   * snapped start and minutes until the resource reaches full capacity (capped
   * at midnight). `snapMinutes` snaps the start down; `now` marks past slots.
   */
  function slotAt(column, stamp, options = {}) {
    const snap = Math.max(1, Math.round(Number(options.snapMinutes) || 15)) * MINUTE_MS;
    const start = Math.floor(Number(stamp) / snap) * snap;
    const blocks = Array.isArray(column?.blocks) ? column.blocks : [];
    const capacity = Math.max(1, Math.floor(Number(column?.capacity) || 1));
    const unitCount = (block) => Math.max(1, Math.floor(Number(block.unitCount ?? block.count) || 1));
    const activeUnits = (time) => blocks.reduce(
      (total, block) => total + (block.rawStart <= time && block.rawEnd > time ? unitCount(block) : 0),
      0,
    );
    const overlapsSlot = blocks.filter((block) => block.rawStart < start + snap && block.rawEnd > start);
    const boundaries = [...new Set(
      blocks.flatMap((block) => [block.rawStart, block.rawEnd])
        .filter((time) => time > start && time < start + snap),
    )].sort((a, b) => a - b);
    const peakInSlot = Math.max(activeUnits(start), ...boundaries.map(activeUnits));
    const occupied = peakInSlot >= capacity ? overlapsSlot[0] || null : null;
    const now = options.now instanceof Date ? options.now.getTime() : Date.now();
    const result = {
      start,
      occupied,
      capacity,
      availableUnits: Math.max(0, capacity - peakInSlot),
      past: start + snap <= now,
      gapMinutes: 0,
    };
    if (occupied) return result;

    const dayEnd = addDays(startOfDay(new Date(start)), 1).getTime();
    let limit = dayEnd;
    const laterBoundaries = [...new Set(
      blocks.flatMap((block) => [block.rawStart, block.rawEnd])
        .filter((time) => time >= start + snap && time < dayEnd),
    )].sort((a, b) => a - b);
    for (const boundary of laterBoundaries) {
      if (activeUnits(boundary) >= capacity) {
        limit = boundary;
        break;
      }
    }
    result.gapMinutes = Math.max(0, Math.floor((limit - start) / MINUTE_MS));
    return result;
  }

  /** "17 Nov – 23 Nov" for the header. */
  function weekTitle(start) {
    const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
    return `${format.format(start)} – ${format.format(addDays(start, 6))}`;
  }

  globalThis.OneJobWeekGrid = {
    machineColorMap,
    ownedResourceIds,
    slotAt,
    visibleDays,
    weekGrid,
    weekRange,
    weekTitle,
  };
})();
