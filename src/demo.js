import { ApartmentBookingCalendar } from "./calendar-widget.js";
import { buildDemoAvailability } from "./demo-data.js";

const container = document.querySelector("#apartment-calendar");

const minDate = "2026-03-17";
const maxDate = "2026-12-31";

new ApartmentBookingCalendar(container, {
  minDate,
  maxDate,
  initialMonth: minDate,
  availability: buildDemoAvailability({ startDate: minDate, endDate: maxDate }),
  title: "Plan Your Stay",
  subtitle:
    "View open dates, see each nightly price, and request a continuous stay range.",
  onSubmit: async (payload) => {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    console.log("Booking request payload", payload);
  },
});
