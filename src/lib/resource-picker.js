/**
 * Command-palette resource chooser (VS Code quick open / GitHub ⌘K): a modal
 * search field with a filtered, keyboard-navigable list. Pinned resources stay
 * on top; the host provides the items and the pick action.
 */
(() => {
  "use strict";

  let pickerId = 0;

  /**
   * Subsequence score à la quick open: every query character must appear in
   * order. Contiguous runs and word starts score higher, later positions a
   * little lower. `null` means the query does not match the text.
   */
  function fuzzyScore(query, text) {
    const q = String(query || "").toLowerCase();
    const t = String(text || "").toLowerCase();
    if (!q) return 0;
    let score = 0;
    let qi = 0;
    let first = -1;
    let last = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
      if (t[ti] !== q[qi]) continue;
      const contiguous = last === ti - 1;
      score += 1 + (contiguous ? 2 : 0);
      if (ti === 0 || !/[a-z0-9]/i.test(t[ti - 1])) score += 3;
      score -= ti * 0.01;
      if (first < 0) first = ti;
      last = ti;
      qi += 1;
    }
    if (qi !== q.length) return null;
    // Tight matches rank above ones spread over the whole string.
    return score - (last - first) * 0.05;
  }

  /** Matches against `name` and `subtitle`, best score wins. */
  function rankItems(query, items) {
    return items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(query, item.name) ?? -Infinity,
          fuzzyScore(query, `${item.name} ${item.subtitle || ""}`) ?? -Infinity,
        ),
      }))
      .filter((row) => row.score > -Infinity)
      // Stable: equal scores keep the caller's ordering (pinned, then menu order).
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item);
  }

  /**
   * @param {Element|Document} host  where the <dialog> is appended
   * @param {{placeholder?: string, footer?: string, onPick?: Function}} options
   * `onPick(item)` runs when a row is confirmed by Enter or click.
   */
  function mount(host, { placeholder = "Search resources…", footer = "↑↓ select · Enter open", onPick } = {}) {
    const doc = host?.ownerDocument || host;
    if (!doc?.createElement) return null;
    const id = ++pickerId;

    const dialog = doc.createElement("dialog");
    dialog.className = "onejob-picker";
    dialog.setAttribute("aria-label", "Find a resource, category or page");

    const input = doc.createElement("input");
    input.className = "onejob-picker-input";
    input.type = "search";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", `onejob-picker-list-${id}`);
    input.setAttribute("aria-label", placeholder);

    const list = doc.createElement("div");
    list.className = "onejob-picker-list";
    list.id = `onejob-picker-list-${id}`;
    list.setAttribute("role", "listbox");

    const foot = doc.createElement("footer");
    foot.className = "onejob-picker-foot";
    foot.textContent = footer;

    // Own backdrop for the non-modal fallback: a host page that patches or
    // breaks `showModal()` must not hide the palette under its own UI.
    const backdrop = doc.createElement("div");
    backdrop.className = "onejob-picker-backdrop";
    backdrop.hidden = true;
    backdrop.addEventListener("click", () => dialog.close());

    dialog.append(input, list, foot);
    host.append(backdrop, dialog);

    let items = [];
    let matches = [];
    let active = 0;
    let getItems = () => [];

    function setActive(index, { scroll = false } = {}) {
      active = Math.max(0, Math.min(index, matches.length - 1));
      list.querySelectorAll(".onejob-picker-row").forEach((row, i) => {
        const on = i === active;
        row.classList.toggle("is-active", on);
        row.setAttribute("aria-selected", on ? "true" : "false");
        if (on && scroll) row.scrollIntoView({ block: "nearest" });
      });
      const row = list.querySelector(`#onejob-picker-row-${id}-${active}`);
      if (matches.length && row) input.setAttribute("aria-activedescendant", row.id);
      else input.removeAttribute("aria-activedescendant");
    }

    function pick(item) {
      if (!item) return;
      dialog.close();
      onPick?.(item);
    }

    function render() {
      const query = input.value.trim();
      const pinned = rankItems(query, items.filter((item) => item.pinned));
      const rest = rankItems(query, items.filter((item) => !item.pinned));
      matches = [...pinned, ...rest];

      const rows = [];
      // A heading marks each change of `section` (pinned, categories, pages),
      // but only when the filtered list holds more than one — a single group
      // needs none.
      const itemSection = (item) => item.section || (item.pinned ? "Pinned" : "");
      const showSections = new Set(matches.map(itemSection)).size > 1;
      let lastSection = null;
      for (const item of matches) {
        const section = itemSection(item);
        if (section !== lastSection) {
          lastSection = section;
          if (showSections && section) {
            const heading = doc.createElement("div");
            heading.className = "onejob-picker-section";
            heading.textContent = section;
            rows.push(heading);
          }
        }
        const row = doc.createElement("div");
        row.className = "onejob-picker-row";
        row.id = `onejob-picker-row-${id}-${matches.indexOf(item)}`;
        row.setAttribute("role", "option");
        const name = doc.createElement("span");
        name.className = "onejob-picker-name";
        name.textContent = item.name;
        row.appendChild(name);
        if (item.pinned) {
          const badge = doc.createElement("span");
          badge.className = "onejob-picker-pinned";
          badge.textContent = "Pinned";
          row.appendChild(badge);
        }
        if (item.subtitle) {
          const sub = doc.createElement("span");
          sub.className = "onejob-picker-sub";
          sub.textContent = item.subtitle;
          row.appendChild(sub);
        }
        row.addEventListener("click", () => pick(item));
        row.addEventListener("pointermove", () => {
          const index = matches.indexOf(item);
          if (index >= 0 && index !== active) setActive(index);
        });
        rows.push(row);
      }
      if (!matches.length) {
        const empty = doc.createElement("div");
        empty.className = "onejob-picker-empty";
        empty.textContent = items.length ? "No matches" : "Nothing to pick yet";
        rows.push(empty);
      }
      list.replaceChildren(...rows);
      setActive(0);
    }

    function open(itemsSource) {
      getItems = typeof itemsSource === "function" ? itemsSource : getItems;
      items = getItems() || [];
      input.value = "";
      render();
      if (dialog.open) dialog.close();
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
        dialog.classList.add("onejob-picker-fallback");
        backdrop.hidden = false;
      }
      input.focus();
    }

    input.addEventListener("input", render);
    // The portal's global Escape handler can suppress the dialog's native
    // cancel; close explicitly and keep focus away from its listener.
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(active + 1, { scroll: true });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(active - 1, { scroll: true });
      } else if (event.key === "Home") {
        event.preventDefault();
        setActive(0, { scroll: true });
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(matches.length - 1, { scroll: true });
      } else if (event.key === "Enter") {
        event.preventDefault();
        pick(matches[active]);
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    // Release focus so the page's single-key shortcuts work right away.
    dialog.addEventListener("close", () => {
      backdrop.hidden = true;
      input.blur();
    });

    return {
      dialog,
      open,
      isOpen: () => dialog.open,
      destroy() {
        if (dialog.open) dialog.close();
        backdrop.remove();
        dialog.remove();
      },
    };
  }

  globalThis.OneJobResourcePicker = { fuzzyScore, rankItems, mount };
})();
