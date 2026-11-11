/**
 * The one-time pinning tour: a small non-modal card that follows a live target
 * element through the portal's own UI.
 *
 * Deliberately not a modal with a dark backdrop. The targets (the Resources nav
 * item, a group's chevron, a pin button inside the open menu, the pins strip)
 * live inside the portal's navbar and inside our own dropdown; darkening the
 * page would need z-index surgery on React-rendered ancestors and break the
 * first time the portal restyles them. Instead the target gets a ring and the
 * card floats next to it.
 *
 * Every step's `target` is a getter: the menu is rebuilt whenever pins or the
 * route change, so a stored element reference would go stale. content.js owns
 * the menu, the sheet and the pins; this module only draws the card.
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
   * @param {{
   *   steps: {title: string, body: string, target?: () => Element|null,
   *           enter?: () => void, primaryLabel?: string}[],
   *   labels?: object,
   *   ignore?: string,
   *   onEnd?: (reason: string) => void,
   * }} options
   */
  function start({ steps, labels, ignore = "", onEnd } = {}) {
    if (!Array.isArray(steps) || !steps.length || typeof document === "undefined") return null;

    const text = { ...DEFAULT_LABELS, ...(labels || {}) };
    const previousFocus = document.activeElement;
    let index = 0;
    let target = null;
    let tick = 0;
    let ended = false;
    let missing = 0;

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
    next.addEventListener("click", () => {
      if (index >= steps.length - 1) end("done");
      else go(index + 1);
    });

    nav.append(back, next);
    actions.append(skip, nav);
    card.append(stepLabel, title, body, actions);
    root.appendChild(card);
    document.body.appendChild(root);

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    tick = setInterval(reposition, TICK_MS);

    go(0);

    return {
      end,
      reposition,
      next: () => go(index + 1),
      back: () => go(index - 1),
      get index() {
        return index;
      },
    };

    function go(to) {
      if (ended || to < 0 || to >= steps.length) return;
      index = to;
      const step = steps[index];

      clearTarget();
      stepLabel.textContent = text.step(index + 1, steps.length);
      title.textContent = step.title || "";
      body.textContent = step.body || "";
      back.hidden = index === 0;
      back.disabled = index === 0;
      next.textContent = step.primaryLabel || (index === steps.length - 1 ? text.done : text.next);

      // Hidden until the first position pass, so the card never flashes at the
      // top-left corner before it is placed next to its target.
      root.style.visibility = "hidden";
      // A step can open the menu it points into; run it before looking the
      // target up, so the first position pass already sees the rows.
      if (typeof step.enter === "function") step.enter();
      target = typeof step.target === "function" ? step.target() : null;
      if (target && target.classList) target.classList.add(TARGET_CLASS);
      reposition();
      root.style.visibility = "";
      next.focus({ preventScroll: true });
    }

    function clearTarget() {
      if (target && target.classList) target.classList.remove(TARGET_CLASS);
      target = null;
    }

    function reposition() {
      if (ended) return;
      const step = steps[index];
      const live = typeof step?.target === "function" ? step.target() : null;
      if (live && live !== target) {
        clearTarget();
        target = live;
        target.classList.add(TARGET_CLASS);
      }

      const rect = target?.getBoundingClientRect?.();
      if (!rect || !rect.width) {
        // The menu was closed or the portal re-rendered the row away; the next
        // tick may bring it back, so give it a moment before giving up.
        root.dataset.target = "missing";
        if (++missing > 4) end("lost");
        return;
      }
      missing = 0;
      root.dataset.target = "found";

      const size = { width: card.offsetWidth, height: card.offsetHeight };
      const position = place(rect, size, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      card.style.top = `${position.top}px`;
      card.style.left = `${position.left}px`;
      root.dataset.placement = position.placement;
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

  globalThis.OneJobTour = { start, place };
})();
