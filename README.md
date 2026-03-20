# Apartment Booking Calendar System

This workspace now contains a complete shared calendar system:

- a public booking calendar for guests
- a private admin dashboard
- a shared SQLite database and API server that connect both apps

## Files

- `index.html`: public calendar page for guests
- `src/calendar-widget.js`: reusable public calendar widget
- `src/calendar-widget.css`: public calendar styles
- `src/demo.js`: public app bootstrap that talks to the backend
- `src/demo-data.js`: seed data used to initialize the database
- `admin/index.html`: admin dashboard page
- `admin/admin.js`: admin dashboard logic
- `admin/admin.css`: admin dashboard styles
- `server.js`: Node server, API, session auth, and shared SQLite database setup

## Current behavior

- Guests can browse two months at a time and submit booking requests.
- The public calendar reads open/closed days and prices from the shared database.
- Admin can log in, review unread requests, accept/reject them, and edit any day.
- Accepted requests automatically close the selected dates in the public calendar.
- Manual admin changes to price or open/closed status also flow into the public calendar.

## Admin credentials

Admin credentials now come from environment variables only.

For local development, create a `.env` file in the project root:

```bash
ADMIN_USERNAME=HPS2702
ADMIN_PASSWORD=Kamila2702
```

For production, set these same values in your hosting provider's environment variable settings.

## Run locally

```bash
npm start
```

Then open:

- Public calendar: `http://localhost:4173`
- Admin dashboard: `http://localhost:4173/admin/`
