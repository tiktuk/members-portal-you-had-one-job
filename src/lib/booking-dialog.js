/* global OneJobConfig, OneJobUrl, OneJobOverview */

/**
 * The booking and cancel dialogs, shared by the pinned overview and the
 * category week view. Each view creates one with `create(host)`; the host owns
 * the session, the mount root and what happens after a booking changes.
 *
 *   host.doc() / host.root()   the document and the node dialogs are appended to
 *   host.session()             `{ status, token, webAddress }`
 *   host.fetchJson(...)        the view's authorised fetch (see overview-view.js)
 *   host.portalOrigin() / host.webAddress()
 *   host.isPanel() / host.closePanel()   overlay shell (a payment redirect closes it)
 *   host.reload()              refetch after a create/cancel
 *   host.showSuccess(notice)   `{ title, message, linkLabel?, href? }`
 *   host.ownCoworkerId()       optional: member id learned from own bookings
 */
(() => {
  "use strict";

  const cfg = OneJobConfig;
  const U = OneJobUrl;
  const O = OneJobOverview;

  function create(host) {
    const dialogState = {
      node: null,
      parts: null,
      resourceId: "",
      resourceName: "",
      booking: null,
      /** Epoch start of a free slot picked directly (no neighbouring booking). */
      startStamp: null,
      side: "after",
      interval: null,
      /** Whole minutes free on the clicked side, or null when unbounded. */
      gapMinutes: null,
      coworker: null,
      coworkerError: "",
      preview: null,
      previewError: "",
      previewing: false,
      submitError: "",
      busy: false,
      /** Which timing control should drive the other values. */
      timingSource: "duration",
      /** Show time-field validation after the member finishes editing. */
      timeErrorVisible: false,
      /** Whether the member has edited a timing control. */
      edited: false,
      abort: null,
      timer: null,
      token: 0,
    };

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

    /** Member profile and resource intervals, cached for the host's lifetime. */
    const shared = { coworker: null, coworkerError: null, coworkerTried: false, resourceInfo: {} };
    let checkoutSession = "";

    function el(tag, className, text) {
      const node = host.doc().createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    /** The numeric booking id a cancellation needs, or "" when it has none. */
    function cancelId(booking) {
      const id = Number(booking?.id);
      return Number.isFinite(id) && id > 0 ? String(id) : "";
    }

    function reset() {
      shared.coworker = null;
      shared.coworkerError = null;
      shared.coworkerTried = false;
      shared.resourceInfo = {};
    }

    function hasOpenModal() {
      return Boolean(dialogState.node?.open || cancelState.node?.open);
    }

    /* ------------------------------------------------------------------ *
     * Booking the gap before or after a row
     *
     * The portal has no plain "create booking" call: its own form posts a
     * basket item to /api/public/checkout/basket/invoice (after a preview
     * call), so the dialog lets the member set a duration or the free edge of
     * the time window and builds that body from the row, card and session.
     * ------------------------------------------------------------------ */

    function bookingCfg() {
      return cfg.overview?.booking || {};
    }

    function maxDuration() {
      return Number(bookingCfg().maxDurationMinutes) || 24 * 60;
    }

    /**
     * Either `booking` + `side` (the gap before/after a row) or `startStamp`
     * (a free slot picked on the week grid) says where the slot starts.
     */
    function openBookingDialog({ resourceId, resourceName, booking, side, gapMs, startStamp }) {
      const fixedStart = Number.isFinite(startStamp) ? startStamp : null;
      if (!host.root() || (!booking && fixedStart == null)) return;

      const id = String(resourceId || booking?.resourceId || "");
      if (!id) return;

      closeDialog();

      const settings = bookingCfg();
      dialogState.resourceId = id;
      dialogState.resourceName = String(resourceName || booking?.resourceName || `Resource ${id}`);
      dialogState.booking = booking || null;
      dialogState.startStamp = fixedStart;
      dialogState.side = side === "before" ? "before" : "after";
      dialogState.interval = null;
      dialogState.gapMinutes = Number.isFinite(gapMs) ? Math.max(0, Math.floor(gapMs / 60000)) : null;
      dialogState.coworker = shared.coworker;
      dialogState.coworkerError = shared.coworkerError || "";
      dialogState.preview = null;
      dialogState.previewError = "";
      dialogState.previewing = false;
      dialogState.submitError = "";
      dialogState.busy = false;
      dialogState.timingSource = "duration";
      dialogState.timeErrorVisible = false;
      dialogState.edited = false;
      dialogState.token += 1;
      const token = dialogState.token;

      const { node, form, body, actions } = dialogShell({
        title:
          fixedStart != null
            ? "Book this slot"
            : dialogState.side === "before"
              ? `Book before ${booking.startTime}`
              : `Book after ${booking.endTime}`,
        subtitle:
          fixedStart != null
            ? `${dialogState.resourceName} · ${dateLabel(new Date(fixedStart))}`
            : `${dialogState.resourceName} · ${dayLabelOf(booking.day)}`,
        describedBy: "onejob-booking-range",
      });

      const field = el("div", "booking-dialog-field");
      const timeSet = el("fieldset", "booking-time-fieldset");
      timeSet.appendChild(el("legend", null, "Booking time"));
      const timeRow = el("div", "booking-time-fields");
      const startTime = bookingTimeInput("start-time", "Start");
      const endTime = bookingTimeInput("end-time", "End");
      const timeHint = el("p", "booking-dialog-time-hint", bookingTimeHint());
      timeHint.id = "onejob-booking-time-hint";
      timeRow.append(startTime.label, endTime.label);
      timeSet.append(timeRow, timeHint);

      const fixedEdge = fixedTimeEdge();
      startTime.input.readOnly = fixedEdge === "start";
      endTime.input.readOnly = fixedEdge === "end";

      const durationSet = el("fieldset", "booking-duration-fieldset");
      durationSet.appendChild(el("legend", null, "Duration"));
      const durationRow = el("div", "booking-duration");
      const hoursInput = durationInput("hours", "Hours", Math.floor(gapCap() / 60));
      const minutesInput = durationInput("minutes", "Minutes", 59);
      durationRow.append(hoursInput.label, minutesInput.label);
      const initialMinutes = defaultMinutes();
      const initialDuration = O.durationParts(initialMinutes);
      hoursInput.input.value = String(initialDuration.hours);
      minutesInput.input.value = String(initialDuration.minutes);
      durationSet.appendChild(durationRow);

      const presets = el("div", "booking-presets");
      const presetButtons = [];
      for (const value of settings.presets || []) {
        if (!(value > 0) || value > maxDuration()) continue;
        const preset = el("button", "booking-preset", O.durationLabel(value));
        preset.type = "button";
        preset.dataset.minutes = String(value);
        preset.addEventListener("click", () => {
          dialogState.edited = true;
          dialogState.timingSource = "duration";
          dialogState.timeErrorVisible = false;
          setDurationInputs(value);
          syncTimeInputsFromDuration(value);
          onDurationChanged();
        });
        presets.appendChild(preset);
        presetButtons.push(preset);
      }

      durationSet.appendChild(presets);
      field.append(timeSet, durationSet);

      const range = el("p", "booking-dialog-range");
      range.id = "onejob-booking-range";
      const price = el("p", "booking-dialog-price");
      const error = el("p", "booking-dialog-error");
      error.setAttribute("role", "alert");
      error.id = "onejob-booking-error";
      error.hidden = true;
      const fallback = el("p", "booking-dialog-fallback");
      fallback.hidden = true;

      const terms = el("p", "booking-dialog-terms");
      terms.append("By confirming you agree to the portal's ");
      const termsLink = el("a", null, "terms and conditions");
      termsLink.href = `${host.portalOrigin()}/${host.webAddress()}/?action=terms`;
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
      dialogState.parts = {
        hoursInput: hoursInput.input,
        minutesInput: minutesInput.input,
        startTimeInput: startTime.input,
        endTimeInput: endTime.input,
        timeHint,
        range,
        price,
        error,
        fallback,
        confirm,
        presets: presetButtons,
      };
      const describedBy = `${timeHint.id} ${error.id}`;
      for (const input of [hoursInput.input, minutesInput.input, startTime.input, endTime.input]) {
        input.setAttribute("aria-describedby", describedBy);
      }

      syncTimeInputsFromDuration(initialMinutes);
      renderDialog();
      hoursInput.input.focus();
      hoursInput.input.select?.();

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
      const node = host.doc().createElement("dialog");
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

      host.root().appendChild(node);
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");

      return { node, form, body, actions };
    }

    /** How many minutes the duration field may reach: the gap, or the global cap. */
    function slotFor(minutes) {
      if (dialogState.startStamp == null) return O.bookingWindow(dialogState.booking, dialogState.side, minutes);
      const value = Number(minutes);
      if (!Number.isFinite(value) || value <= 0) return null;
      return { start: dialogState.startStamp, end: dialogState.startStamp + value * 60000 };
    }

    function fixedTimeEdge() {
      return dialogState.startStamp != null || dialogState.side === "after" ? "start" : "end";
    }

    function fixedTimeStamp() {
      if (dialogState.startStamp != null) return dialogState.startStamp;
      return dialogState.side === "before" ? Number(dialogState.booking?.stamp) : Number(dialogState.booking?.endStamp);
    }

    function timeBasedSlot() {
      const edge = fixedTimeEdge();
      const input = edge === "start" ? dialogState.parts?.endTimeInput : dialogState.parts?.startTimeInput;
      const endpoint = input ? new Date(input.value).getTime() : NaN;
      if (!Number.isFinite(endpoint)) return null;
      return O.bookingWindowFromEndpoint(fixedTimeStamp(), edge, endpoint);
    }

    function bookingTimeHint() {
      if (fixedTimeEdge() === "start") {
        const anchor = dialogState.startStamp != null ? "the selected slot" : "the adjacent booking's end";
        return `The start stays at ${anchor}. Change the end time or duration to update the booking.`;
      }
      return "The end stays at the adjacent booking's start. Change the start time or duration to update the booking.";
    }

    function syncTimeInputsFromDuration(minutes) {
      const slot = slotFor(minutes);
      if (!slot || !dialogState.parts) return;
      dialogState.parts.startTimeInput.value = localDateTimeInputValue(slot.start);
      dialogState.parts.endTimeInput.value = localDateTimeInputValue(slot.end);
    }

    function syncDurationFromTime() {
      const minutes = O.windowDurationMinutes(timeBasedSlot());
      if (minutes == null) {
        dialogState.parts.hoursInput.value = "";
        dialogState.parts.minutesInput.value = "";
        return;
      }
      setDurationInputs(Math.max(0, minutes));
    }

    function gapCap() {
      return dialogState.gapMinutes == null ? maxDuration() : Math.max(0, dialogState.gapMinutes);
    }

    /**
     * The first duration the dialog offers: the configured preference (an hour),
     * capped by the gap and snapped to the interval, so a 30-minute gap opens on
     * 30 min instead of a value the portal would refuse.
     */
    function defaultMinutes() {
      const preferred = Number(bookingCfg().defaultMinutes) || 60;
      return O.gapDuration(dialogState.gapMinutes, dialogState.interval, preferred, maxDuration());
    }

    function durationInput(id, labelText, max) {
      const label = el("label", "booking-duration-part", labelText);
      const input = host.doc().createElement("input");
      input.type = "number";
      input.id = `onejob-booking-${id}`;
      input.name = `duration-${id}`;
      input.inputMode = "numeric";
      input.min = "0";
      input.max = String(max);
      input.step = "1";
      input.value = "0";
      label.htmlFor = input.id;
      label.appendChild(input);
      input.addEventListener("input", () => {
        dialogState.edited = true;
        dialogState.timingSource = "duration";
        dialogState.timeErrorVisible = false;
        syncTimeInputsFromDuration(selectedDuration());
        onDurationChanged();
      });
      return { label, input };
    }

    function bookingTimeInput(id, labelText) {
      const label = el("label", "booking-time-part", labelText);
      const input = host.doc().createElement("input");
      input.type = "datetime-local";
      input.id = `onejob-booking-${id}`;
      input.name = `booking-${id}`;
      input.step = "60";
      input.className = "booking-time-input";
      label.htmlFor = input.id;
      label.appendChild(input);
      input.addEventListener("input", () => {
        dialogState.edited = true;
        dialogState.timingSource = "time";
        dialogState.timeErrorVisible = false;
        syncDurationFromTime();
        onDurationChanged();
      });
      input.addEventListener("blur", () => {
        if (dialogState.timingSource !== "time") return;
        dialogState.timeErrorVisible = true;
        renderDialog();
      });
      return { label, input };
    }

    function setDurationInputs(minutes) {
      const parts = O.durationParts(minutes);
      if (dialogState.parts) {
        dialogState.parts.hoursInput.value = String(parts.hours);
        dialogState.parts.minutesInput.value = String(parts.minutes);
      }
    }

    function selectedDuration() {
      if (dialogState.timingSource === "time") {
        return O.windowDurationMinutes(timeBasedSlot());
      }
      return O.durationFromParts(
        dialogState.parts?.hoursInput?.value ?? "0",
        dialogState.parts?.minutesInput?.value ?? "0",
      );
    }

    /** "" when the duration can be sent, otherwise the reason it cannot. */
    function validateMinutes(minutes) {
      const fromTime = dialogState.timingSource === "time";
      if (minutes == null) return fromTime ? "Enter a valid start or end time." : "Use whole hours and 0-59 minutes.";
      const value = Number(minutes);
      if (!Number.isInteger(value)) {
        return fromTime ? "Use minute precision for the booking times." : "Use whole hours and 0-59 minutes.";
      }
      if (value <= 0) return fromTime ? "The end time must be after the start time." : "Enter a duration greater than zero.";
      if (dialogState.interval && value % dialogState.interval !== 0) {
        return `Duration must be in ${O.durationLabel(dialogState.interval)} steps.`;
      }
      if (value < (dialogState.interval || 1)) {
        return `The shortest booking is ${O.durationLabel(dialogState.interval)}.`;
      }
      if (dialogState.gapMinutes != null && value > dialogState.gapMinutes) {
        return dialogState.gapMinutes > 0
          ? `Only ${O.durationLabel(dialogState.gapMinutes)} is free ${dialogState.startStamp == null ? "on that side" : "there"}.`
          : (dialogState.startStamp == null ? "There is no room on that side." : "There is no room there.");
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

      const minutes = selectedDuration();
      if (validateMinutes(minutes) || !dialogState.coworker) return;

      dialogState.previewing = true;
      renderDialog();
      dialogState.timer = setTimeout(() => previewBooking(dialogState.token), 350);
    }

    function renderDialog() {
      if (!dialogState.node || !dialogState.parts) return;
      const {
        hoursInput,
        minutesInput,
        startTimeInput,
        endTimeInput,
        range,
        price,
        error,
        fallback,
        confirm,
        presets,
      } = dialogState.parts;

      const minutes = selectedDuration();
      const slot = slotFor(minutes);
      range.textContent = slot
        ? formatWindow(slot.start, slot.end)
        : dialogState.timingSource === "time"
          ? "Enter valid booking times."
          : "Choose a duration.";

      for (const preset of presets) {
        const value = Number(preset.dataset.minutes);
        preset.hidden =
          (dialogState.interval && value % dialogState.interval !== 0) ||
          (dialogState.gapMinutes != null && value > dialogState.gapMinutes);
        preset.classList.toggle("is-active", value === minutes);
      }

      const timingError = validateMinutes(minutes);
      const message =
        dialogState.submitError ||
        dialogState.previewError ||
        (dialogState.timingSource !== "time" || dialogState.timeErrorVisible ? timingError : "") ||
        (dialogState.coworker ? "" : dialogState.coworkerError || "Checking your member profile…");
      error.hidden = !message;
      error.textContent = message || "";
      for (const input of [hoursInput, minutesInput]) {
        if (dialogState.edited && dialogState.timingSource === "duration" && validateMinutes(minutes)) {
          input.setAttribute("aria-invalid", "true");
        }
        else input.removeAttribute("aria-invalid");
      }
      for (const input of [startTimeInput, endTimeInput]) {
        if (
          !input.readOnly &&
          dialogState.edited &&
          dialogState.timingSource === "time" &&
          dialogState.timeErrorVisible &&
          timingError
        ) {
          input.setAttribute("aria-invalid", "true");
        } else {
          input.removeAttribute("aria-invalid");
        }
      }

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
        Boolean(slot) &&
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
      const session = host.session();
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

      dialogState.interval = interval;
      if (interval) {
        const current = selectedDuration();
        // Only snap the default; never overwrite what the member already typed.
        if (!dialogState.edited && (!(current > 0) || current % interval !== 0)) {
          setDurationInputs(defaultMinutes());
        }
      }
      syncTimeInputsFromDuration(selectedDuration());

      dialogState.coworker = shared.coworker;
      dialogState.coworkerError = shared.coworker ? "" : shared.coworkerError || "Couldn't find your member profile.";
      renderDialog();
      onDurationChanged();
    }

    /** The member profile a booking is created for; cached for the mount. */
    async function resolveCoworker(session) {
      if (shared.coworker) return shared.coworker;

      if (!shared.coworkerTried) {
        shared.coworkerTried = true;
        try {
          const url = `${U.apiBaseUrl(session.webAddress)}/api/public/coworkers/profiles?f=1`;
          shared.coworker = O.defaultProfile(await host.fetchJson(session, url));
          if (!shared.coworker) shared.coworkerError = "Couldn't find your member profile.";
        } catch (error) {
          shared.coworkerError = error.message || "Couldn't load your member profile.";
        }
      }

      if (!shared.coworker) {
        const own = Number(host.ownCoworkerId?.());
        if (own > 0) {
          shared.coworker = { id: own, name: "" };
          shared.coworkerError = "";
        }
      }
      return shared.coworker;
    }

    /** The resource's booking increment, so the duration field steps honestly. */
    async function resolveInterval(session, resourceId) {
      if (!resourceId) return null;
      if (shared.resourceInfo[resourceId]) return shared.resourceInfo[resourceId].interval || null;

      try {
        const url = `${U.apiBaseUrl(session.webAddress)}/api/public/resources/published/${encodeURIComponent(resourceId)}`;
        const interval = O.resourceInterval(await host.fetchJson(session, url));
        shared.resourceInfo[resourceId] = { interval };
        return interval;
      } catch {
        shared.resourceInfo[resourceId] = { interval: null };
        return null;
      }
    }

    async function previewBooking(token) {
      if (token !== dialogState.token || !dialogState.node) return;

      const session = host.session();
      if (session.status !== "ok") {
        dialogState.previewing = false;
        dialogState.previewError = "Your portal session expired.";
        renderDialog();
        return;
      }

      const slot = slotFor(selectedDuration());
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

      const session = host.session();
      if (session.status !== "ok") {
        dialogState.submitError = "Your portal session expired.";
        renderDialog();
        return;
      }

      const minutes = selectedDuration();
      const slot = slotFor(minutes);
      if (!slot || validateMinutes(minutes) || !dialogState.coworker) {
        if (dialogState.timingSource === "time") {
          dialogState.timeErrorVisible = true;
          renderDialog();
        }
        return;
      }

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

        // `host.doc()` is cleared when the panel closes, so keep it for the redirect.
        const view = host.doc()?.defaultView || window;

        if (paymentUrl) {
          if (host.isPanel()) {
            // The portal's own modal closes and navigates to the payment page.
            host.closePanel();
            view.location.assign(paymentUrl);
            return;
          }
          view.open(paymentUrl, "_blank", "noopener");
        }

        await host.reload();
        if (!host.root()) return;

        host.showSuccess(paymentUrl
          ? {
              title: "Booking created",
              message: `Booked ${label}. ${formatPrice(total, currency)} is due; pay it in the portal.`,
              linkLabel: "Pay in the portal ↗",
              href: paymentUrl,
            }
          : { title: "Booking created", message: `Booked ${label}.` },
        );
      } catch (error) {
        if (!host.root()) return;
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
      if (!host.root() || !booking || !cancelId(booking)) return;

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
      const select = host.doc().createElement("select");
      select.id = "onejob-cancel-reason";
      for (const reason of O.CANCEL_REASONS) {
        const option = host.doc().createElement("option");
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
      const details = host.doc().createElement("textarea");
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
      const session = host.session();
      if (!booking || session.status !== "ok") return;

      try {
        const url = `${U.apiBaseUrl(session.webAddress)}/api/public/bookings/${encodeURIComponent(booking.id)}/cancellationFee`;
        const data = await host.fetchJson(session, url);
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

      const session = host.session();
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
        const { status, data } = await host.fetchJson(session, url, {
          method: "DELETE",
          body: JSON.stringify(O.cancelBody(booking.id, reason, details)),
          allowErrorBody: true,
          headers: { "Content-Type": "application/json" },
        });
        if (status >= 400) {
          throw new Error(cancelMessage(data) || `The portal returned HTTP ${status}.`);
        }

        closeDialog();
        await host.reload();
        if (!host.root()) return;
        host.showSuccess({ title: "Booking cancelled", message: `Cancelled ${name} on ${label}.` });
      } catch (error) {
        if (!host.root()) return;
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
      return host.fetchJson(session, url, {
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
      return `${host.portalOrigin()}/${host.webAddress()}/public/bookings/edit?${params.toString()}`;
    }

    function paymentHref(invoiceId) {
      return `${host.portalOrigin()}/${host.webAddress()}/checkout/payment?invoice_id=${encodeURIComponent(invoiceId)}`;
    }

    function formatWindow(start, end) {
      const from = new Date(start);
      const to = new Date(end);
      if (from.toDateString() === to.toDateString()) {
        return `${clockLabel(from)} – ${clockLabel(to)} · ${dateLabel(from)}`;
      }
      return `${dateLabel(from)}, ${clockLabel(from)} – ${dateLabel(to)}, ${clockLabel(to)}`;
    }

    function localDateTimeInputValue(stamp) {
      const date = new Date(stamp);
      if (!Number.isFinite(date.getTime())) return "";
      const pad = (value) => String(value).padStart(2, "0");
      const year = String(date.getFullYear()).padStart(4, "0");
      return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

    return {
      openBooking: openBookingDialog,
      openCancel: openCancelDialog,
      close: closeDialog,
      hasOpenModal,
      reset,
    };
  }

  globalThis.OneJobBookingDialog = { create };
})();
