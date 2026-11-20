/* Shared single-key shortcut helpers and the contextual help dialog. */
(() => {
  "use strict";

  let helpId = 0;
  const GLOBAL_KEYS = new Set(["o", "s", "c", "h", "d", "w", "p", "b", "t", ",", "."]);
  const FEATURE_GUIDE = [
    {
      title: "Resources and pins",
      description: "Browse groups in the Resources menu and pin a machine. The pins strip opens its single-resource calendar; press P to search and open any resource, a whole category (\"All 3D printing\") or your bookings — the extension's overview or the portal page.",
    },
    {
      title: "Booking Overview",
      description: "Review upcoming bookings for pinned resources and your own bookings. Luma events can be included; use a booking to find an adjacent gap or cancel your own.",
    },
    {
      title: "Bookings heatmap",
      description: "On a pinned calendar, the 4 x 28 heatmap shows day and time-of-day activity, including workshop reservations and optional Luma markers.",
    },
    {
      title: "Resource Statistics",
      description: "Compare daily use over 4 weeks, 3 months, or 12 months with heatmaps, weekday/time charts, and resource filters. Select a resource to open its calendar.",
    },
    {
      title: "Caro Week View",
      description: "Compare resources side by side by day. Switch scope and Day/Week views; , and . move by a period and T returns to today. Click free time to book or one of your own bookings to cancel. Press B to aim a slot with the arrow keys and Enter to book it.",
    },
    {
      title: "Settings",
      description: "Use the extension toolbar popup to manage features, machine colours, Luma events, and single-key shortcuts. Turning single-key shortcuts off keeps Alt+O and Alt+S.",
    },
  ];

  function matches(event, key) {
    if (
      !event ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return false;
    }

    if (key === ",") return event.code === "Comma" || event.key === ",";
    if (key === ".") return event.code === "Period" || event.key === ".";
    return String(event.key || "").toLowerCase() === String(key).toLowerCase();
  }

  function isEditableEvent(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [event?.target];
    return path.some((node) => {
      if (!node || typeof node !== "object") return false;
      const tag = String(node.tagName || "").toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        node.isContentEditable === true ||
        node.getAttribute?.("contenteditable") === "true" ||
        node.getAttribute?.("role") === "textbox"
      );
    });
  }

  function isHelpDialog(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [event?.target];
    return path.some((node) => node?.classList?.contains("onejob-keyboard-dialog"));
  }

  function isInExtensionOverlay(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [event?.target];
    return path.some((node) => node?.classList?.contains("onejob-overview-overlay"));
  }

  function isInDialog(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [event?.target];
    return path.some((node) => {
      if (!node || typeof node !== "object") return false;
      if (node.classList?.contains("onejob-overview-panel")) return false;
      return String(node.tagName || "").toLowerCase() === "dialog" ||
        node.getAttribute?.("role") === "dialog" ||
        node.getAttribute?.("aria-modal") === "true";
    });
  }

  function localIso(date) {
    const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset < 0 ? "-" : "+";
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
      `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
    );
  }

  function shiftDateRange(search, days) {
    if (!Number.isInteger(days) || days === 0) return null;
    const params = new URLSearchParams(search || "");
    const start = new Date(params.get("start") || "");
    const end = new Date(params.get("end") || "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    start.setDate(start.getDate() + days);
    end.setDate(end.getDate() + days);
    params.set("start", localIso(start));
    params.set("end", localIso(end));
    return params.toString();
  }

  function assignShortcuts(elements, { reserved = GLOBAL_KEYS, preferred = {} } = {}) {
    const items = [...elements];
    const fixed = items.map((element) => element.dataset.shortcutPreferred).filter(Boolean);
    const used = new Set([...reserved, ...fixed]);
    return items.map((element) => {
      const label =
        element.dataset.shortcutLabel ||
        element.getAttribute("aria-label") ||
        element.textContent ||
        "";
      const key = element.dataset.shortcutPreferred ||
        [preferred[label], ...(String(label).toLowerCase().match(/[a-z]/g) || [])]
          .filter(Boolean)
          .find((candidate) => !used.has(candidate)) ||
        "";
      if (key) {
        used.add(key);
        setHint(element, key, label);
      }
      return { key, label: label.trim(), element };
    });
  }

  function setHint(element, key, label = "") {
    element.dataset.onejobShortcut = key;
    element.dataset.shortcutLabel = label;
    element.setAttribute("aria-keyshortcuts", key.toUpperCase());
    const existing = element.title || label;
    if (existing) element.title = `${existing.replace(/\s+\([^)]+\)$/, "")} (${key.toUpperCase()})`;
  }

  function collectHints(root) {
    return [...root.querySelectorAll("[data-onejob-shortcut]")]
      .filter((element) => !element.disabled && !element.hidden)
      .map((element) => ({
        key: element.dataset.onejobShortcut,
        label: element.dataset.shortcutLabel || element.getAttribute("aria-label") || element.textContent.trim(),
      }));
  }

  function mountHelp(root, getState = () => ({ enabled: true, bindings: [] })) {
    const host = root?.nodeType === 9 ? root.body : root;
    const doc = host?.ownerDocument || host;
    if (!host || !doc?.createElement) return null;

    const id = ++helpId;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "onejob-keyboard-help";
    button.textContent = "?";
    button.setAttribute("aria-label", "Keyboard shortcuts");
    button.title = "Keyboard shortcuts";

    const dialog = doc.createElement("dialog");
    dialog.className = "onejob-keyboard-dialog";
    dialog.setAttribute("aria-labelledby", `onejob-keyboard-title-${id}`);

    const header = doc.createElement("header");
    header.className = "onejob-keyboard-dialog-head";
    const title = doc.createElement("h2");
    title.id = `onejob-keyboard-title-${id}`;
    title.textContent = "Keyboard shortcuts";

    const form = doc.createElement("form");
    form.method = "dialog";
    const close = doc.createElement("button");
    close.type = "submit";
    close.value = "close";
    close.className = "onejob-keyboard-close";
    close.autofocus = true;
    close.setAttribute("aria-label", "Close keyboard shortcuts");
    close.textContent = "×";
    form.appendChild(close);
    header.append(title, form);

    const note = doc.createElement("p");
    note.className = "onejob-keyboard-note";
    const list = doc.createElement("ul");
    list.className = "onejob-keyboard-list";
    const featuresTitle = doc.createElement("h3");
    featuresTitle.className = "onejob-keyboard-features-title";
    featuresTitle.textContent = "Extension features";
    const features = doc.createElement("ul");
    features.className = "onejob-keyboard-features";
    for (const feature of FEATURE_GUIDE) {
      const item = doc.createElement("li");
      const name = doc.createElement("strong");
      name.textContent = feature.title;
      const description = doc.createElement("span");
      description.textContent = feature.description;
      item.append(name, description);
      features.appendChild(item);
    }
    dialog.append(header, note, list, featuresTitle, features);
    host.append(button, dialog);

    function open() {
      if (dialog.open) return;
      const state = getState() || {};
      button.title = state.enabled === false
        ? "Keyboard shortcuts"
        : "Keyboard shortcuts (H)";
      if (state.enabled === false) button.removeAttribute("aria-keyshortcuts");
      else button.setAttribute("aria-keyshortcuts", "H");
      note.textContent = state.enabled === false
        ? "Single-key shortcuts are off. Turn them on in the extension settings."
        : "Type a key when you are not editing text. Modified shortcuts such as Alt+O and Alt+S still work.";
      list.replaceChildren();
      const bindings = Array.isArray(state.bindings) ? state.bindings : [];
      for (const binding of bindings) {
        const row = doc.createElement("li");
        const keyNode = doc.createElement("kbd");
        keyNode.textContent = String(binding.key || "").toUpperCase();
        const labelNode = doc.createElement("span");
        labelNode.textContent = binding.label || "";
        row.append(keyNode, labelNode);
        list.appendChild(row);
      }
      if (!bindings.length) {
        const empty = doc.createElement("li");
        empty.textContent = "No single-key shortcuts are active here.";
        list.appendChild(empty);
      }
      try {
        dialog.showModal();
      } catch {
        // Fall through to the non-modal fallback below.
      }
      let modal = true;
      try {
        modal = dialog.matches(":modal");
      } catch {
        // Old engines without :modal still modal dialogs normally.
      }
      if (!modal) {
        if (!dialog.open) dialog.open = true;
        dialog.classList.add("onejob-keyboard-dialog-fallback");
      }
    }

    // The portal's global Escape handler can suppress the dialog's native
    // cancel; close explicitly and keep focus away from its listener.
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
    });

    button.addEventListener("click", open);
    return {
      button,
      dialog,
      open,
      isOpen: () => dialog.open,
      destroy() {
        if (dialog.open) dialog.close();
        button.removeEventListener("click", open);
        button.remove();
        dialog.remove();
      },
    };
  }

  globalThis.OneJobKeyboardShortcuts = {
    GLOBAL_KEYS,
    FEATURE_GUIDE,
    matches,
    isEditableEvent,
    isHelpDialog,
    isInExtensionOverlay,
    isInDialog,
    shiftDateRange,
    assignShortcuts,
    setHint,
    collectHints,
    mountHelp,
  };
})();
