const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MIN_DATE = "2026-03-17";
const MAX_DATE = "2026-12-31";

const state = {
  authenticated: false,
  currentMonth: startOfMonth(new Date().toISOString().slice(0, 10)),
  selectedDate: new Date().toISOString().slice(0, 10),
  selectedDay: null,
  selectedRequestId: null,
  notifications: [],
  unreadCount: 0,
  requests: [],
  calendarDays: [],
};

const elements = {
  loginView: document.querySelector("#login-view"),
  dashboardView: document.querySelector("#dashboard-view"),
  loginForm: document.querySelector("#login-form"),
  loginFeedback: document.querySelector("#login-feedback"),
  logoutButton: document.querySelector("#logout-button"),
  notificationSummary: document.querySelector("#notification-summary"),
  notificationList: document.querySelector("#notification-list"),
  calendarMonthLabel: document.querySelector("#calendar-month-label"),
  previousMonthButton: document.querySelector("#previous-month"),
  nextMonthButton: document.querySelector("#next-month"),
  adminCalendar: document.querySelector("#admin-calendar"),
  dayForm: document.querySelector("#day-form"),
  dayDate: document.querySelector("#day-date"),
  dayStatus: document.querySelector("#day-status"),
  dayPrice: document.querySelector("#day-price"),
  dayGuestName: document.querySelector("#day-guest-name"),
  dayGuestEmail: document.querySelector("#day-guest-email"),
  dayGuestPhone: document.querySelector("#day-guest-phone"),
  dayNotes: document.querySelector("#day-notes"),
  dayFeedback: document.querySelector("#day-feedback"),
  requestList: document.querySelector("#request-list"),
  requestDetail: document.querySelector("#request-detail"),
};

initialize();

async function initialize() {
  bindEvents();

  const today = clampDate(new Date().toISOString().slice(0, 10));
  state.currentMonth = startOfMonth(today);
  state.selectedDate = today;
  elements.dayDate.min = MIN_DATE;
  elements.dayDate.max = MAX_DATE;

  await refreshSession();
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.previousMonthButton.addEventListener("click", async () => {
    const previousMonth = addMonths(state.currentMonth, -1);

    if (previousMonth < startOfMonth(MIN_DATE)) {
      return;
    }

    state.currentMonth = previousMonth;
    await loadCalendar();
  });
  elements.nextMonthButton.addEventListener("click", async () => {
    const nextMonth = addMonths(state.currentMonth, 1);

    if (nextMonth > startOfMonth(MAX_DATE)) {
      return;
    }

    state.currentMonth = nextMonth;
    await loadCalendar();
  });
  elements.dayStatus.addEventListener("change", syncGuestFieldState);
  elements.dayDate.addEventListener("change", async (event) => {
    state.selectedDate = clampDate(event.target.value);
    await loadSelectedDay();
    await loadCalendar();
  });
  elements.dayForm.addEventListener("submit", handleDaySave);
}

async function refreshSession() {
  const session = await fetchJson("/api/admin/session");

  if (!session.authenticated) {
    state.authenticated = false;
    renderAuthState();
    return;
  }

  state.authenticated = true;
  renderAuthState();
  await loadDashboard();
  startPolling();
}

function renderAuthState() {
  elements.loginView.hidden = state.authenticated;
  elements.dashboardView.hidden = !state.authenticated;
  elements.logoutButton.hidden = !state.authenticated;
}

async function loadDashboard() {
  await Promise.all([loadNotifications(), loadRequests(), loadCalendar(), loadSelectedDay()]);
}

function startPolling() {
  if (window.adminPollTimer) {
    return;
  }

  window.adminPollTimer = window.setInterval(async () => {
    if (!state.authenticated) {
      return;
    }

    try {
      await Promise.all([loadNotifications(), loadRequests(), loadCalendar()]);

      if (state.selectedDate) {
        await loadSelectedDay(false);
      }
    } catch (error) {
      console.error(error);
    }
  }, 20000);
}

async function handleLogin(event) {
  event.preventDefault();

  const formData = new FormData(elements.loginForm);
  const username = formData.get("username")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString().trim() ?? "";

  try {
    await fetchJson("/api/admin/login", {
      method: "POST",
      body: { username, password },
    });
    elements.loginFeedback.textContent = "";
    state.authenticated = true;
    renderAuthState();
    await loadDashboard();
    startPolling();
  } catch (error) {
    elements.loginFeedback.textContent = error.message;
  }
}

async function handleLogout() {
  try {
    await fetchJson("/api/admin/logout", {
      method: "POST",
    });
  } finally {
    state.authenticated = false;
    state.notifications = [];
    state.requests = [];
    state.calendarDays = [];
    state.selectedDay = null;
    state.selectedRequestId = null;
    if (window.adminPollTimer) {
      window.clearInterval(window.adminPollTimer);
      window.adminPollTimer = null;
    }
    renderAuthState();
  }
}

async function loadNotifications() {
  const payload = await fetchJson("/api/admin/notifications");
  state.notifications = payload.unread;
  state.unreadCount = payload.unreadCount;
  renderNotifications();
}

async function loadRequests() {
  const payload = await fetchJson("/api/admin/requests");
  state.requests = payload.requests;

  if (!state.selectedRequestId && state.requests.length > 0) {
    state.selectedRequestId = state.requests[0].id;
  }

  if (state.selectedRequestId && !state.requests.some((request) => request.id === state.selectedRequestId)) {
    state.selectedRequestId = state.requests[0]?.id ?? null;
  }

  renderRequests();
}

async function loadCalendar() {
  const payload = await fetchJson(`/api/admin/calendar?month=${state.currentMonth}`);
  state.calendarDays = payload.days;
  elements.calendarMonthLabel.textContent = formatMonthLabel(state.currentMonth);
  elements.previousMonthButton.disabled = addMonths(state.currentMonth, -1) < startOfMonth(MIN_DATE);
  elements.nextMonthButton.disabled = addMonths(state.currentMonth, 1) > startOfMonth(MAX_DATE);
  renderCalendar();
}

async function loadSelectedDay(renderCalendarAfter = true) {
  if (!state.selectedDate) {
    return;
  }

  const payload = await fetchJson(`/api/admin/day?date=${state.selectedDate}`);
  state.selectedDay = payload.day;
  renderSelectedDay();

  if (renderCalendarAfter) {
    renderCalendar();
  }
}

async function handleDaySave(event) {
  event.preventDefault();
  elements.dayFeedback.textContent = "";

  const formData = new FormData(elements.dayForm);
  const payload = Object.fromEntries(formData.entries());

  payload.price = Number(payload.price);

  try {
    await fetchJson("/api/admin/day", {
      method: "PUT",
      body: payload,
    });
    elements.dayFeedback.textContent = "Day saved.";
    await Promise.all([loadCalendar(), loadSelectedDay(false)]);
  } catch (error) {
    elements.dayFeedback.textContent = error.message;
  }
}

function renderNotifications() {
  elements.notificationSummary.textContent =
    state.unreadCount === 0
      ? "No unread booking requests."
      : `${state.unreadCount} unread booking request${state.unreadCount === 1 ? "" : "s"} awaiting review.`;

  if (state.notifications.length === 0) {
    elements.notificationList.innerHTML = `<p class="feedback">New guest requests will appear here.</p>`;
    return;
  }

  elements.notificationList.innerHTML = state.notifications
    .map(
      (request) => `
        <article class="notification-card is-clickable" data-request-id="${request.id}">
          <h3>${escapeHtml(request.guestName)}</h3>
          <p>${formatDateLabel(request.startDate)} to ${formatDateLabel(request.endDate)}</p>
          <p>${request.totalDays} day${request.totalDays === 1 ? "" : "s"} • ${formatCurrency(request.totalPrice)}</p>
        </article>
      `
    )
    .join("");

  for (const card of elements.notificationList.querySelectorAll("[data-request-id]")) {
    card.addEventListener("click", () => selectRequest(Number(card.dataset.requestId)));
  }
}

function renderCalendar() {
  const firstDay = new Date(`${state.currentMonth}T00:00:00`);
  const leadingBlanks = firstDay.getDay();
  const cells = WEEKDAYS.map(
    (weekday) => `<div class="admin-calendar__weekday">${weekday}</div>`
  );

  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push('<div class="admin-calendar__day admin-calendar__day--empty"></div>');
  }

  for (const day of state.calendarDays) {
    const isSelected = day.date === state.selectedDate;
    const buttonClass = [
      "admin-calendar__button",
      day.status === "closed" ? "is-closed" : "is-open",
      day.pendingCount > 0 ? "has-pending" : "",
      isSelected ? "is-selected" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const badgeClass =
      day.status === "closed"
        ? "admin-calendar__badge admin-calendar__badge--closed"
        : "admin-calendar__badge admin-calendar__badge--open";

    cells.push(`
      <div class="admin-calendar__day">
        <button class="${buttonClass}" type="button" data-date="${day.date}">
          <div class="admin-calendar__topline">
            <span class="admin-calendar__date">${Number(day.date.slice(-2))}</span>
            <span class="${badgeClass}">${day.status}</span>
          </div>
          <div class="admin-calendar__meta">
            <span>${formatCurrency(day.price)}</span>
            ${
              day.pendingCount > 0
                ? `<span>${day.pendingCount} pending request${day.pendingCount === 1 ? "" : "s"}</span>`
                : "<span>No pending requests</span>"
            }
          </div>
        </button>
      </div>
    `);
  }

  elements.adminCalendar.innerHTML = cells.join("");

  for (const button of elements.adminCalendar.querySelectorAll("[data-date]")) {
    button.addEventListener("click", async () => {
      state.selectedDate = clampDate(button.dataset.date);
      await loadSelectedDay();
    });
  }
}

function renderSelectedDay() {
  if (!state.selectedDay) {
    return;
  }

  elements.dayDate.value = state.selectedDay.date;
  elements.dayStatus.value = state.selectedDay.status;
  elements.dayPrice.value = state.selectedDay.price;
  elements.dayGuestName.value = state.selectedDay.guestName ?? "";
  elements.dayGuestEmail.value = state.selectedDay.guestEmail ?? "";
  elements.dayGuestPhone.value = state.selectedDay.guestPhone ?? "";
  elements.dayNotes.value = state.selectedDay.notes ?? "";
  syncGuestFieldState();
}

function syncGuestFieldState() {
  const isClosed = elements.dayStatus.value === "closed";

  for (const input of [
    elements.dayGuestName,
    elements.dayGuestEmail,
    elements.dayGuestPhone,
  ]) {
    input.disabled = !isClosed;
    input.required = isClosed;
  }
}

function renderRequests() {
  if (state.requests.length === 0) {
    elements.requestList.innerHTML = `<p class="feedback">No booking requests have been submitted yet.</p>`;
    elements.requestDetail.innerHTML = `<p class="feedback">Select a request to review its details.</p>`;
    return;
  }

  elements.requestList.innerHTML = state.requests
    .map((request) => {
      const statusClass =
        request.status === "accepted"
          ? "pill pill--accepted"
          : request.status === "rejected"
            ? "pill pill--rejected"
            : "pill pill--pending";

      return `
        <article class="request-card ${request.id === state.selectedRequestId ? "is-selected" : ""}" data-request-id="${request.id}">
          <h3>${escapeHtml(request.guestName)}</h3>
          <p>${formatDateLabel(request.startDate)} to ${formatDateLabel(request.endDate)}</p>
          <div class="request-card__meta">
            <span class="${statusClass}">${request.status}</span>
            ${!request.isRead && request.status === "pending" ? '<span class="pill">Unread</span>' : ""}
          </div>
        </article>
      `;
    })
    .join("");

  for (const card of elements.requestList.querySelectorAll("[data-request-id]")) {
    card.addEventListener("click", () => selectRequest(Number(card.dataset.requestId)));
  }

  renderSelectedRequest();
}

async function selectRequest(requestId) {
  state.selectedRequestId = requestId;
  renderRequests();

  const request = state.requests.find((item) => item.id === requestId);

  if (!request) {
    return;
  }

  state.selectedDate = clampDate(request.startDate);
  state.currentMonth = startOfMonth(request.startDate);

  if (!request.isRead && request.status === "pending") {
    try {
      await fetchJson(`/api/admin/requests/${requestId}/read`, {
        method: "POST",
      });
      await loadNotifications();
      await loadRequests();
    } catch (error) {
      console.error(error);
    }
  }

  await Promise.all([loadCalendar(), loadSelectedDay(false)]);
}

function renderSelectedRequest() {
  const request = state.requests.find((item) => item.id === state.selectedRequestId);

  if (!request) {
    elements.requestDetail.innerHTML = `<p class="feedback">Select a request to review its details.</p>`;
    return;
  }

  elements.requestDetail.innerHTML = `
    <h3>${escapeHtml(request.guestName)}</h3>
    <div class="request-detail__grid">
      <div class="request-detail__row">
        <strong>Stay</strong>
        <span>${formatDateLabel(request.startDate)} to ${formatDateLabel(request.endDate)}</span>
      </div>
      <div class="request-detail__row">
        <strong>Contact</strong>
        <span>${escapeHtml(request.guestEmail)} • ${escapeHtml(request.guestPhone)}</span>
      </div>
      <div class="request-detail__row">
        <strong>Price</strong>
        <span>${formatCurrency(request.totalPrice)} for ${request.totalDays} day${request.totalDays === 1 ? "" : "s"}</span>
      </div>
      <div class="request-detail__row">
        <strong>Comments</strong>
        <span>${escapeHtml(request.comments || "No comments provided.")}</span>
      </div>
      <div class="request-detail__row">
        <strong>Requested Dates</strong>
        <span>${request.dates.map(formatDateLabel).join(", ")}</span>
      </div>
    </div>
    ${
      request.status === "pending"
        ? `
            <div class="request-actions">
              <button type="button" class="decision-button decision-button--accept" data-request-action="accept">Accept Request</button>
              <button type="button" class="decision-button decision-button--reject" data-request-action="reject">Reject Request</button>
            </div>
          `
        : `<p class="feedback">This request has already been ${escapeHtml(request.status)}.</p>`
    }
  `;

  for (const button of elements.requestDetail.querySelectorAll("[data-request-action]")) {
    button.addEventListener("click", async () => {
      await reviewRequest(request.id, button.dataset.requestAction);
    });
  }
}

async function reviewRequest(requestId, action) {
  try {
    await fetchJson(`/api/admin/requests/${requestId}/${action}`, {
      method: "POST",
    });
    await Promise.all([loadNotifications(), loadRequests(), loadCalendar(), loadSelectedDay(false)]);
  } catch (error) {
    elements.dayFeedback.textContent = error.message;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function formatMonthLabel(dateKey) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function formatDateLabel(dateKey) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function addMonths(dateKey, delta) {
  const date = new Date(`${dateKey}T00:00:00`);
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
    .toISOString()
    .slice(0, 10);
}

function startOfMonth(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

function clampDate(dateKey) {
  if (!dateKey || dateKey < MIN_DATE) {
    return MIN_DATE;
  }

  if (dateKey > MAX_DATE) {
    return MAX_DATE;
  }

  return dateKey;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
