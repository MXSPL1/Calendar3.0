const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
let calendarInstanceCount = 0;

function parseDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toUtcDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isSameDay(left, right) {
  return formatDateKey(left) === formatDateKey(right);
}

function formatMonthLabel(date, locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatLongDate(date, locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatPrice(price, locale, currency) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function countDaysInclusive(startDate, endDate) {
  return Math.round((toUtcDay(endDate) - toUtcDay(startDate)) / MS_PER_DAY) + 1;
}

function normalizeAvailability(entries, defaultPrice) {
  const availability = new Map();

  for (const entry of entries) {
    availability.set(entry.date, {
      status: entry.status ?? "open",
      price: entry.price ?? defaultPrice,
    });
  }

  return availability;
}

export class ApartmentBookingCalendar {
  constructor(container, options = {}) {
    const root =
      typeof container === "string"
        ? document.querySelector(container)
        : container;

    if (!root) {
      throw new Error("ApartmentBookingCalendar requires a valid container.");
    }

    this.root = root;
    this.instanceId = `booking-request-title-${calendarInstanceCount += 1}`;
    this.locale = options.locale ?? "en-US";
    this.currency = options.currency ?? "USD";
    this.defaultPrice = options.defaultPrice ?? 245;
    this.maxDate = parseDate(options.maxDate ?? "2026-12-31");
    this.minDate = parseDate(options.minDate ?? formatDateKey(new Date()));

    if (toUtcDay(this.minDate) > toUtcDay(this.maxDate)) {
      this.minDate = new Date(this.maxDate);
    }

    this.firstMonth = startOfMonth(this.minDate);
    this.lastMonth = startOfMonth(this.maxDate);
    this.visibleMonth = startOfMonth(
      options.initialMonth ? parseDate(options.initialMonth) : this.firstMonth
    );
    this.availability = normalizeAvailability(
      options.availability ?? [],
      this.defaultPrice
    );
    this.title = options.title ?? "Reserve Your Stay";
    this.subtitle =
      options.subtitle ??
      "Select a continuous stay range and send a booking request.";
    this.onSubmit =
      options.onSubmit ??
      (async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      });

    this.selection = {
      start: null,
      end: null,
    };
    this.feedback = "";
    this.successMessage = "";

    this.renderFrame();
    this.attachEvents();
    this.render();
  }

  setAvailability(entries = []) {
    this.availability = normalizeAvailability(entries, this.defaultPrice);

    if (
      this.selection.start &&
      this.selection.end &&
      !this.validateRange(this.selection.start, this.selection.end)
    ) {
      this.selection = { start: null, end: null };
      this.feedback =
        "Availability changed, so the previous stay selection was cleared.";
    }

    this.render();
  }

  setSubmissionHandler(handler) {
    this.onSubmit = handler;
  }

  renderFrame() {
    this.root.innerHTML = `
      <section class="booking-calendar">
        <div class="booking-calendar__shell">
          <header class="booking-calendar__header">
            <div>
              <p class="booking-calendar__eyebrow">Guest Booking</p>
              <h2>${this.title}</h2>
              <p class="booking-calendar__subtitle">${this.subtitle}</p>
            </div>
          </header>

          <button
            type="button"
            class="booking-calendar__nav booking-calendar__nav--previous"
            aria-label="Show previous months"
          >
            <span aria-hidden="true">&#8249;</span>
          </button>

          <div class="booking-calendar__months" aria-live="polite"></div>

          <button
            type="button"
            class="booking-calendar__nav booking-calendar__nav--next"
            aria-label="Show next months"
          >
            <span aria-hidden="true">&#8250;</span>
          </button>

          <div class="booking-calendar__ornament" aria-hidden="true">
            <span></span>
          </div>

          <footer class="booking-calendar__footer">
            <div class="booking-calendar__legend">
              <span class="booking-calendar__legend-item">
                <span class="booking-calendar__legend-swatch booking-calendar__legend-swatch--open"></span>
                Open
              </span>
              <span class="booking-calendar__legend-item">
                <span class="booking-calendar__legend-swatch booking-calendar__legend-swatch--closed"></span>
                Closed
              </span>
              <span class="booking-calendar__legend-item">
                <span class="booking-calendar__legend-swatch booking-calendar__legend-swatch--selected"></span>
                Selected
              </span>
            </div>

            <div class="booking-calendar__summary">
              <p class="booking-calendar__summary-copy"></p>
              <div class="booking-calendar__summary-actions">
                <button type="button" class="booking-calendar__clear">Clear</button>
                <button type="button" class="booking-calendar__request">
                  Request These Dates
                </button>
              </div>
            </div>
          </footer>
        </div>

        <p class="booking-calendar__feedback" aria-live="polite"></p>
        <p class="booking-calendar__success" aria-live="polite"></p>

        <div class="booking-calendar__modal" hidden>
          <div class="booking-calendar__modal-backdrop" data-close-modal="true"></div>
          <div
            class="booking-calendar__modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="${this.instanceId}"
          >
            <button
              type="button"
              class="booking-calendar__modal-close"
              aria-label="Close booking form"
              data-close-modal="true"
            >
              &#10005;
            </button>

            <div class="booking-calendar__modal-copy">
              <p class="booking-calendar__eyebrow">Booking Request</p>
              <h3 id="${this.instanceId}">Share Your Details</h3>
              <p class="booking-calendar__modal-summary"></p>
            </div>

            <form class="booking-calendar__form">
              <label class="booking-calendar__field">
                <span>Name</span>
                <input type="text" name="name" required />
              </label>
              <label class="booking-calendar__field">
                <span>Phone Number</span>
                <input type="tel" name="phone" required />
              </label>
              <label class="booking-calendar__field">
                <span>Email</span>
                <input type="email" name="email" required />
              </label>
              <label class="booking-calendar__field">
                <span>Additional Comments</span>
                <textarea name="comments" rows="4" placeholder="Optional"></textarea>
              </label>

              <button type="submit" class="booking-calendar__submit">
                Send Booking Request
              </button>
            </form>
          </div>
        </div>
      </section>
    `;

    this.elements = {
      months: this.root.querySelector(".booking-calendar__months"),
      previousButton: this.root.querySelector(".booking-calendar__nav--previous"),
      nextButton: this.root.querySelector(".booking-calendar__nav--next"),
      summaryCopy: this.root.querySelector(".booking-calendar__summary-copy"),
      clearButton: this.root.querySelector(".booking-calendar__clear"),
      requestButton: this.root.querySelector(".booking-calendar__request"),
      feedback: this.root.querySelector(".booking-calendar__feedback"),
      success: this.root.querySelector(".booking-calendar__success"),
      modal: this.root.querySelector(".booking-calendar__modal"),
      modalSummary: this.root.querySelector(".booking-calendar__modal-summary"),
      form: this.root.querySelector(".booking-calendar__form"),
      submitButton: this.root.querySelector(".booking-calendar__submit"),
    };
  }

  attachEvents() {
    this.elements.previousButton.addEventListener("click", () => {
      if (!this.canGoPrevious()) {
        return;
      }

      this.visibleMonth = addMonths(this.visibleMonth, -1);
      this.feedback = "";
      this.render();
    });

    this.elements.nextButton.addEventListener("click", () => {
      if (!this.canGoNext()) {
        return;
      }

      this.visibleMonth = addMonths(this.visibleMonth, 1);
      this.feedback = "";
      this.render();
    });

    this.elements.months.addEventListener("click", (event) => {
      const button = event.target.closest("[data-date]");

      if (!button) {
        return;
      }

      this.handleDateSelection(button.dataset.date);
    });

    this.elements.clearButton.addEventListener("click", () => {
      this.selection = { start: null, end: null };
      this.feedback = "";
      this.render();
    });

    this.elements.requestButton.addEventListener("click", () => {
      if (!this.selection.start || !this.selection.end) {
        return;
      }

      this.openModal();
    });

    this.elements.modal.addEventListener("click", (event) => {
      if (event.target.dataset.closeModal === "true") {
        this.closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.elements.modal.hidden) {
        this.closeModal();
      }
    });

    this.elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!this.selection.start || !this.selection.end) {
        return;
      }

      const formData = new FormData(this.elements.form);
      const selectedDates = this.getSelectedDates();
      const payload = {
        stay: {
          startDate: formatDateKey(this.selection.start),
          endDate: formatDateKey(this.selection.end),
          selectedDates: selectedDates.map((date) => formatDateKey(date)),
          totalDays: selectedDates.length,
          totalPrice: this.getSelectedTotalPrice(),
        },
        guest: {
          name: formData.get("name")?.toString().trim() ?? "",
          phone: formData.get("phone")?.toString().trim() ?? "",
          email: formData.get("email")?.toString().trim() ?? "",
          comments: formData.get("comments")?.toString().trim() ?? "",
        },
      };

      this.elements.submitButton.disabled = true;
      this.elements.submitButton.textContent = "Sending...";

      try {
        await this.onSubmit(payload);
        this.successMessage =
          "Your request was sent. We will review the dates and respond shortly.";
        this.feedback = "";
        this.selection = { start: null, end: null };
        this.elements.form.reset();
        this.closeModal();
        this.render();
      } catch (error) {
        this.feedback =
          error instanceof Error
            ? error.message
            : "The request could not be sent. Please try again.";
        this.render();
      } finally {
        this.elements.submitButton.disabled = false;
        this.elements.submitButton.textContent = "Send Booking Request";
      }
    });
  }

  canGoPrevious() {
    return toUtcDay(addMonths(this.visibleMonth, -1)) >= toUtcDay(this.firstMonth);
  }

  canGoNext() {
    return toUtcDay(addMonths(this.visibleMonth, 2)) <= toUtcDay(this.lastMonth);
  }

  getDayData(date) {
    const dateKey = formatDateKey(date);
    return (
      this.availability.get(dateKey) ?? {
        status: "open",
        price: this.defaultPrice,
      }
    );
  }

  isSelectable(date) {
    const dateValue = toUtcDay(date);

    if (dateValue < toUtcDay(this.minDate) || dateValue > toUtcDay(this.maxDate)) {
      return false;
    }

    return this.getDayData(date).status === "open";
  }

  getSelectedDates() {
    if (!this.selection.start || !this.selection.end) {
      return [];
    }

    const totalDays = countDaysInclusive(this.selection.start, this.selection.end);
    return Array.from({ length: totalDays }, (_, index) =>
      addDays(this.selection.start, index)
    );
  }

  getSelectedTotalPrice() {
    return this.getSelectedDates().reduce((total, date) => {
      return total + this.getDayData(date).price;
    }, 0);
  }

  validateRange(startDate, endDate) {
    const totalDays = countDaysInclusive(startDate, endDate);

    for (let index = 0; index < totalDays; index += 1) {
      const current = addDays(startDate, index);

      if (!this.isSelectable(current)) {
        return false;
      }
    }

    return true;
  }

  handleDateSelection(dateKey) {
    const clickedDate = parseDate(dateKey);

    if (!this.isSelectable(clickedDate)) {
      return;
    }

    this.successMessage = "";

    if (!this.selection.start || (this.selection.start && this.selection.end)) {
      this.selection = {
        start: clickedDate,
        end: null,
      };
      this.feedback = "Arrival date selected. Choose the end of your stay.";
      this.render();
      return;
    }

    if (toUtcDay(clickedDate) < toUtcDay(this.selection.start)) {
      this.selection = {
        start: clickedDate,
        end: null,
      };
      this.feedback = "Arrival date updated. Choose the end of your stay.";
      this.render();
      return;
    }

    if (!this.validateRange(this.selection.start, clickedDate)) {
      this.feedback =
        "That range includes one or more closed dates. Please choose open dates only.";
      this.render();
      return;
    }

    this.selection.end = clickedDate;
    this.feedback = "Stay selected. Submit a request when you are ready.";
    this.render();
  }

  isWithinSelection(date) {
    if (!this.selection.start || !this.selection.end) {
      return false;
    }

    return (
      toUtcDay(date) >= toUtcDay(this.selection.start) &&
      toUtcDay(date) <= toUtcDay(this.selection.end)
    );
  }

  buildMonthMarkup(month) {
    const firstDay = startOfMonth(month);
    const lastDay = endOfMonth(month);
    const leadingBlanks = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const cells = [];

    for (let index = 0; index < leadingBlanks; index += 1) {
      cells.push('<div class="booking-calendar__day booking-calendar__day--blank"></div>');
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const dateKey = formatDateKey(date);
      const dayData = this.getDayData(date);
      const disabled = !this.isSelectable(date);
      const isStart = this.selection.start && isSameDay(date, this.selection.start);
      const isEnd = this.selection.end && isSameDay(date, this.selection.end);
      const isSelectedRange = this.isWithinSelection(date);
      const statusLabel = disabled
        ? dayData.status === "closed"
          ? "Closed"
          : "Unavailable"
        : formatPrice(dayData.price, this.locale, this.currency);

      const classes = [
        "booking-calendar__day",
        disabled ? "is-disabled" : "is-open",
        isSelectedRange ? "is-selected" : "",
        isStart ? "is-range-start" : "",
        isEnd ? "is-range-end" : "",
      ]
        .filter(Boolean)
        .join(" ");

      cells.push(`
        <div class="${classes}">
          <button
            type="button"
            class="booking-calendar__day-button"
            data-date="${dateKey}"
            ${disabled ? "disabled" : ""}
            aria-label="${formatLongDate(date, this.locale)}"
          >
            <span class="booking-calendar__day-number">${day}</span>
            <span class="booking-calendar__day-price">${statusLabel}</span>
          </button>
        </div>
      `);
    }

    return `
      <section class="booking-calendar__month" aria-label="${formatMonthLabel(
        month,
        this.locale
      )}">
        <header class="booking-calendar__month-header">
          <h3>${formatMonthLabel(month, this.locale)}</h3>
        </header>
        <div class="booking-calendar__weekdays">
          ${WEEKDAYS.map(
            (weekday) =>
              `<span class="booking-calendar__weekday">${weekday}</span>`
          ).join("")}
        </div>
        <div class="booking-calendar__days">
          ${cells.join("")}
        </div>
      </section>
    `;
  }

  openModal() {
    const totalPrice = formatPrice(
      this.getSelectedTotalPrice(),
      this.locale,
      this.currency
    );
    const days = this.getSelectedDates().length;

    this.elements.modalSummary.textContent = `${formatLongDate(
      this.selection.start,
      this.locale
    )} to ${formatLongDate(this.selection.end, this.locale)} • ${days} day${
      days === 1 ? "" : "s"
    } • ${totalPrice}`;
    this.elements.modal.hidden = false;
  }

  closeModal() {
    this.elements.modal.hidden = true;
  }

  renderSummary() {
    if (!this.selection.start) {
      this.elements.summaryCopy.textContent =
        "Select your arrival date to begin browsing open days.";
      this.elements.requestButton.disabled = true;
      this.elements.clearButton.disabled = true;
      return;
    }

    if (!this.selection.end) {
      this.elements.summaryCopy.textContent = `Arrival selected for ${formatLongDate(
        this.selection.start,
        this.locale
      )}. Choose the final day of your stay.`;
      this.elements.requestButton.disabled = true;
      this.elements.clearButton.disabled = false;
      return;
    }

    const totalPrice = formatPrice(
      this.getSelectedTotalPrice(),
      this.locale,
      this.currency
    );
    const totalDays = this.getSelectedDates().length;

    this.elements.summaryCopy.textContent = `Selected stay: ${formatLongDate(
      this.selection.start,
      this.locale
    )} to ${formatLongDate(this.selection.end, this.locale)} • ${totalDays} day${
      totalDays === 1 ? "" : "s"
    } • ${totalPrice}`;
    this.elements.requestButton.disabled = false;
    this.elements.clearButton.disabled = false;
  }

  render() {
    const monthMarkup = [0, 1]
      .map((offset) => this.buildMonthMarkup(addMonths(this.visibleMonth, offset)))
      .join("");

    this.elements.months.innerHTML = monthMarkup;
    this.elements.previousButton.disabled = !this.canGoPrevious();
    this.elements.nextButton.disabled = !this.canGoNext();
    this.elements.feedback.textContent = this.feedback;
    this.elements.success.textContent = this.successMessage;
    this.renderSummary();
  }
}

if (typeof window !== "undefined") {
  window.ApartmentBookingCalendar = ApartmentBookingCalendar;
}
