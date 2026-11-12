/**
 * The first-run feature tour: a small non-modal card that follows a live target
 * element through the portal's own UI, and through our own overlays.
 *
 * Deliberately not a modal with a dark backdrop. The targets (the Resources nav
 * item, a pin button inside the open menu, the calendar heatmap, cards inside
 * the overview's shadow root) live inside the portal's navbar, our dropdown and
 * our overlays; darkening the page would need z-index surgery on React-rendered
 * ancestors and break the first time the portal restyles them. Instead the
 * target gets a ring and the card floats next to it. A step with no target at
 * all (the settings preview) centres the card instead.
 *
 * Every step's `target` is a getter: the menu is rebuilt whenever pins or the
 * route change, and the overlays re-render, so a stored element reference would
 * go stale. content.js owns the menu, the overlays and the pins; this module
 * only draws the card.
 *
 * Loaded as a classic script by the content script (and by the tests, in a vm
 * without a DOM). Nothing here touches the page at load time.
 */
(() => {
  "use strict";

  const ROOT_ID = "onejob-tour";
  const TARGET_CLASS = "onejob-tour-target";
  const GAP = 10;
  const EDGE = 12;
  const TICK_MS = 250;
  /** How long a step keeps the card up while its target is still mounting. */
  const MISSING_MS = 1000;

  /**
   * Inline ring, not only the class: `portal.css` cannot reach a target inside
   * the overview's shadow root. The class stays for the pulse animation the
   * portal's own stylesheet provides.
   */
  const RING_OUTLINE = "2px solid var(--bs-primary, #ff5b13)";
  const RING_OFFSET = "3px";

  const DEFAULT_LABELS = {
    next: "Next",
    back: "Back",
    done: "Got it",
    skip: "Skip",
    step: (index, total) => `${index} of ${total}`,
  };

  /**
   * Geometry for the card, as a pure function so the tests can cover the flips
   * without a DOM.
   *
   * @param {{top:number,left:number,width:number,height:number}} rect target
   * @param {{width:number,height:number}} card
   * @param {{width:number,height:number}} viewport
   * @returns {{top:number,left:number,placement:"below"|"above"}}
   */
  function place(rect, card, viewport, margin = EDGE) {
    const spaceBelow = viewport.height - rect.top - rect.height - margin;
    const spaceAbove = rect.top - margin;
    const below = spaceBelow >= card.height || spaceBelow >= spaceAbove;

    let top = below
      ? rect.top + rect.height + GAP
      : rect.top - GAP - card.height;
    let left = rect.left + rect.width / 2 - card.width / 2;

    const maxTop = viewport.height - card.height - margin;
    const maxLeft = viewport.width - card.width - margin;
    top = Math.min(Math.max(top, margin), Math.max(maxTop, margin));
    left = Math.min(Math.max(left, margin), Math.max(maxLeft, margin));

    return {
      top: Math.round(top),
      left: Math.round(left),
      placement: below ? "below" : "above",
    };
  }

  /**
   * The card on its own, for a step with nothing to point at.
   *
   * @param {{width:number,height:number}} card
   * @param {{width:number,height:number}} viewport
   * @returns {{top:number,left:number,placement:"center"}}
   */
  function center(card, viewport, margin = EDGE) {
    const maxTop = Math.max(viewport.height - card.height - margin, margin);
    const maxLeft = Math.max(viewport.width - card.width - margin, margin);
    const top = Math.min(Math.max((viewport.height - card.height) / 2, margin), maxTop);
    const left = Math.min(Math.max((viewport.width - card.width) / 2, margin), maxLeft);
    return { top: Math.round(top), left: Math.round(left), placement: "center" };
  }

  /**
   * @param {{
   *   steps: {
   *     id?: string, title: string | (() => string), body: string | (() => string),
   *     target?: () => Element|null, enter?: () => void, leave?: (reason: string) => void,
   *     render?: (container: HTMLElement) => void, onPrimary?: (tour: object) => void,
   *     primaryLabel?: string | (() => string), blocked?: () => boolean,
   *     centered?: boolean, missingMs?: number,
   *   }[],
   *   labels?: object,
   *   ignore?: string,
   *   startIndex?: number,
   *   onEnd?: (reason: string) => void,
   * }} options
   */
  function start({ steps, labels, ignore = "", startIndex = 0, onEnd } = {}) {
    if (!Array.isArray(steps) || !steps.length || typeof document === "undefined") return null;

    const text = { ...DEFAULT_LABELS, ...(labels || {}) };
    const previousFocus = document.activeElement;
    let index = Math.min(Math.max(Number(startIndex) || 0, 0), steps.length - 1);
    /** Steps before this one were skipped for the member, so Back stops here. */
    const startedAt = index;
    let target = null;
    let ringPrevious = null;
    let tick = 0;
    let ended = false;
    let placed = false;
    let missingSince = 0;

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "onejob-tour";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-labelledby", `${ROOT_ID}-title`);

    const card = document.createElement("div");
    card.className = "onejob-tour-card";

    const stepLabel = document.createElement("p");
    stepLabel.className = "onejob-tour-step";

    const title = document.createElement("h2");
    title.className = "onejob-tour-title";
    title.id = `${ROOT_ID}-title`;

    const body = document.createElement("p");
    body.className = "onejob-tour-body";

    // Steps that illustrate rather than point (the settings preview) fill this.
    const figure = document.createElement("div");
    figure.className = "onejob-tour-figure";
    figure.hidden = true;

    const actions = document.createElement("div");
    actions.className = "onejob-tour-actions";

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "onejob-tour-skip";
    skip.textContent = text.skip;
    skip.addEventListener("click", () => end("skip"));

    const nav = document.createElement("div");
    nav.className = "onejob-tour-nav";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "onejob-tour-back";
    back.textContent = text.back;
    back.addEventListener("click", () => go(index - 1));

    const next = document.createElement("button");
    next.type = "button";
    next.className = "onejob-tour-next";
    next.addEventListener("click", onPrimary);

    nav.append(back, next);
    actions.append(skip, nav);
    card.append(stepLabel, title, body, figure, actions);
    root.appendChild(card);
    document.body.appendChild(root);

    const api = {
      end,
      reposition,
      next: () => go(index + 1),
      back: () => go(index - 1),
      get index() {
        return index;
      },
      get id() {
        return steps[index]?.id || "";
      },
    };

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    tick = setInterval(reposition, TICK_MS);

    go(index);

    return api;

    function go(to) {
      if (ended || to < 0 || to >= steps.length) return;
      // Leaving a step may own something on the page (an open overlay).
      if (to !== index && typeof steps[index]?.leave === "function") steps[index].leave("next");
      index = to;
      const step = steps[index];

      clearTarget();
      placed = false;
      missingSince = 0;
      stepLabel.textContent = text.step(index + 1, steps.length);
      title.textContent = (typeof step.title === "function" ? step.title() : step.title) || "";
      body.textContent = (typeof step.body === "function" ? step.body() : step.body) || "";
      renderFigure(step);
      back.hidden = index <= startedAt;
      back.disabled = index <= startedAt;
      next.textContent = primaryLabel(step);
      // A step can require an action on the page first (the pin step waits for
      // a pin). Skip and Escape stay available.
      next.disabled = isBlocked(step);

      // Hidden until the first position pass, so the card never flashes at the
      // top-left corner before it is placed next to its target.
      root.style.visibility = "hidden";
      // A step can open the menu it points into; run it before looking the
      // target up, so the first position pass already sees the rows.
      if (typeof step.enter === "function") step.enter();
      target = step.centered ? null : typeof step.target === "function" ? step.target() : null;
      if (target) addRing(target);
      reposition();
      root.style.visibility = "";
      next.focus({ preventScroll: true });
    }

    function primaryLabel(step) {
      const label = typeof step.primaryLabel === "function" ? step.primaryLabel() : step.primaryLabel;
      return label || (index === steps.length - 1 ? text.done : text.next);
    }

    function isBlocked(step) {
      return typeof step?.blocked === "function" && Boolean(step.blocked());
    }

    function onPrimary() {
      if (ended) return;
      const step = steps[index];
      if (typeof step.onPrimary === "function") {
        // The step owns the action (the heatmap step navigates the page).
        step.onPrimary(api);
        return;
      }
      if (index >= steps.length - 1) end("done");
      else go(index + 1);
    }

    function renderFigure(step) {
      figure.replaceChildren();
      if (typeof step.render !== "function") {
        figure.hidden = true;
        return;
      }
      step.render(figure);
      figure.hidden = !figure.firstChild;
    }

    function clearTarget() {
      removeRing();
      target = null;
    }

    function addRing(element) {
      if (!element?.style || !element.classList) return;
      ringPrevious = { outline: element.style.outline, offset: element.style.outlineOffset };
      element.classList.add(TARGET_CLASS);
      element.style.outline = RING_OUTLINE;
      element.style.outlineOffset = RING_OFFSET;
    }

    function removeRing() {
      if (!target?.classList) return;
      target.classList.remove(TARGET_CLASS);
      if (ringPrevious) {
        target.style.outline = ringPrevious.outline;
        target.style.outlineOffset = ringPrevious.offset;
      }
      ringPrevious = null;
    }

    function reposition() {
      if (ended) return;
      const step = steps[index];
      const size = { width: card.offsetWidth, height: card.offsetHeight };
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      if (step?.centered) {
        root.dataset.target = "none";
        apply(center(size, viewport));
        return;
      }

      const live = typeof step?.target === "function" ? step.target() : null;
      if (live && live !== target) {
        removeRing();
        target = live;
        addRing(target);
      }

      const rect = target?.getBoundingClientRect?.();
      if (!rect || !rect.width) {
        // The menu was closed, an overlay is still mounting or the portal
        // re-rendered the row away; the next tick may bring it back, so give
        // the step its own window before giving up.
        root.dataset.target = "missing";
        if (!missingSince) missingSince = Date.now();
        if (Date.now() - missingSince > (Number(step?.missingMs) || MISSING_MS)) {
          end("lost");
          return;
        }
        // Nothing to point at yet: keep the card readable instead of leaving it
        // invisible at the top-left corner.
        if (!placed) apply(center(size, viewport));
        return;
      }
      missingSince = 0;
      root.dataset.target = "found";
      apply(place(rect, size, viewport));
    }

    function apply(position) {
      card.style.top = `${position.top}px`;
      card.style.left = `${position.left}px`;
      root.dataset.placement = position.placement;
      placed = true;
    }

    function onDocumentClick(event) {
      if (ended) return;
      const node = event.target;
      if (!(node instanceof Element)) return;
      if (root.contains(node)) return;
      if (ignore && node.closest(ignore)) return;
      end("outside");
    }

    function onKeydown(event) {
      if (ended) return;
      if (event.key === "Escape") {
        end("escape");
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      if (event.key === "ArrowRight") {
        if (isBlocked(steps[index])) return;
        if (index >= steps.length - 1) end("done");
        else go(index + 1);
      } else {
        go(index - 1);
      }
    }

    function end(reason) {
      if (ended) return;
      ended = true;

      clearInterval(tick);
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      // A step that opened an overlay closes it when the tour goes away, so
      // skipping the tour never strands the member in a screen it opened.
      if (typeof steps[index]?.leave === "function") steps[index].leave(reason);
      clearTarget();
      root.remove();

      if (previousFocus && typeof previousFocus.focus === "function") {
        try {
          previousFocus.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
      if (typeof onEnd === "function") onEnd(reason);
    }
  }

  function isEditable(target) {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    );
  }

  globalThis.OneJobTour = { start, place, center };
})();
