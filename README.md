# Apartment Booking Calendar Frontend

This workspace contains the public booking calendar frontend for the apartment rental website.

## Files

- `index.html`: standalone demo page that shows the calendar in an embeddable page section.
- `src/calendar-widget.js`: reusable calendar widget with range selection, pricing display, and booking request form.
- `src/calendar-widget.css`: styling for the calendar and modal form.
- `src/demo-data.js`: mock availability and price data used until the admin side is connected.
- `src/demo.js`: demo bootstrap that instantiates the widget.

## Current behavior

- Shows two months at a time.
- Supports continuous stay selection only.
- Prevents selection across closed dates.
- Displays a nightly price on each open date.
- Opens a request form after the user chooses a valid range.
- Stops navigation at December 2026.

## Future admin integration

The widget is already prepared for the admin side later:

1. Replace the mock `availability` array with data loaded from the admin/backend system.
2. Replace the demo `onSubmit` function with a real request to save the booking inquiry.

Expected availability shape:

```js
[
  { date: "2026-03-17", status: "open", price: 235 },
  { date: "2026-03-18", status: "closed", price: 235 }
]
```

Submission payload shape:

```js
{
  stay: {
    startDate: "2026-03-17",
    endDate: "2026-03-20",
    selectedDates: ["2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20"],
    totalDays: 4,
    totalPrice: 940
  },
  guest: {
    name: "Guest Name",
    phone: "123-456-7890",
    email: "guest@example.com",
    comments: "Optional notes"
  }
}
```

## Run locally

```bash
npm start
```

Then open `http://localhost:4173`.
