import { ApartmentBookingCalendar } from "./calendar-widget.js";

const container = document.querySelector("#apartment-calendar");
const minDate = "2026-03-17";
const maxDate = "2026-12-31";

const loadingMarkup = `
  <div style="padding: 2rem; border: 1px solid rgba(184, 159, 99, 0.28); border-radius: 1.5rem; background: rgba(255, 252, 247, 0.9); color: #5f4938;">
    Loading calendar...
  </div>
`;

if (container) {
  initializeCalendar().catch((error) => {
    console.error(error);
    container.innerHTML = `
      <div style="padding: 2rem; border: 1px solid rgba(184, 159, 99, 0.28); border-radius: 1.5rem; background: rgba(255, 252, 247, 0.9); color: #5f4938;">
        The calendar could not load. Please try again shortly.
      </div>
    `;
  });
}

async function initializeCalendar() {
  container.innerHTML = loadingMarkup;

  const availability = await loadAvailability();
  const calendar = new ApartmentBookingCalendar(container, {
    minDate,
    maxDate,
    initialMonth: minDate,
    availability,
    title: "Plan Your Stay",
    subtitle:
      "View open dates, see each nightly price, and request a continuous stay range.",
    onSubmit: submitBookingRequest,
  });

  window.setInterval(async () => {
    try {
      const freshAvailability = await loadAvailability();
      calendar.setAvailability(freshAvailability);
    } catch (error) {
      console.error("Calendar refresh failed", error);
    }
  }, 30000);
}

async function loadAvailability() {
  const response = await fetch(`/api/availability?start=${minDate}&end=${maxDate}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to load availability.");
  }

  return payload.availability ?? [];
}

async function submitBookingRequest(payload) {
  const response = await fetch("/api/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error ?? "The booking request could not be sent.");
  }
}
