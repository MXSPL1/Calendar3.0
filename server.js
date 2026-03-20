import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, createReadStream, readFileSync, existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { buildDemoAvailability } from "./src/demo-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!IS_PRODUCTION) {
  loadDotEnv(path.join(__dirname, ".env"));
}

const PORT = Number(process.env.PORT ?? 4173);
const HOST = "0.0.0.0";
const MIN_DATE = "2026-03-17";
const MAX_DATE = "2026-12-31";
const SESSION_COOKIE = "hps_admin_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME?.trim() ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() ?? "";

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  if (IS_PRODUCTION) {
    throw new Error(
      "ADMIN_USERNAME and ADMIN_PASSWORD must be set in production."
    );
  }

  console.warn(
    "ADMIN_USERNAME and ADMIN_PASSWORD are not set. Create a local .env file before using the admin dashboard."
  );
}

const dataDirectory = path.join(__dirname, "data");
const databasePath = path.join(dataDirectory, "calendar.sqlite");

mkdirSync(dataDirectory, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS availability (
    date TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    price INTEGER NOT NULL,
    guest_name TEXT,
    guest_email TEXT,
    guest_phone TEXT,
    notes TEXT,
    source_request_id INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS booking_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    comments TEXT,
    total_days INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS request_days (
    request_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    PRIMARY KEY (request_id, date),
    FOREIGN KEY (request_id) REFERENCES booking_requests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_request_days_date ON request_days(date);
  CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
`);

const statements = {
  availabilityCount: db.prepare("SELECT COUNT(*) AS count FROM availability"),
  insertAvailability: db.prepare(`
    INSERT INTO availability (
      date,
      status,
      price,
      guest_name,
      guest_email,
      guest_phone,
      notes,
      source_request_id,
      updated_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)
  `),
  getAvailabilityRange: db.prepare(`
    SELECT date, status, price
    FROM availability
    WHERE date BETWEEN ? AND ?
    ORDER BY date
  `),
  getAvailabilityDay: db.prepare(`
    SELECT
      date,
      status,
      price,
      guest_name AS guestName,
      guest_email AS guestEmail,
      guest_phone AS guestPhone,
      notes,
      source_request_id AS sourceRequestId
    FROM availability
    WHERE date = ?
  `),
  updateDayOpen: db.prepare(`
    UPDATE availability
    SET
      status = 'open',
      price = ?,
      guest_name = NULL,
      guest_email = NULL,
      guest_phone = NULL,
      notes = ?,
      source_request_id = NULL,
      updated_at = ?
    WHERE date = ?
  `),
  updateDayClosed: db.prepare(`
    UPDATE availability
    SET
      status = 'closed',
      price = ?,
      guest_name = ?,
      guest_email = ?,
      guest_phone = ?,
      notes = ?,
      source_request_id = NULL,
      updated_at = ?
    WHERE date = ?
  `),
  createRequest: db.prepare(`
    INSERT INTO booking_requests (
      start_date,
      end_date,
      guest_name,
      guest_email,
      guest_phone,
      comments,
      total_days,
      total_price,
      status,
      is_read,
      created_at,
      reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL)
  `),
  createRequestDay: db.prepare(`
    INSERT INTO request_days (request_id, date)
    VALUES (?, ?)
  `),
  notifications: db.prepare(`
    SELECT
      id,
      start_date AS startDate,
      end_date AS endDate,
      guest_name AS guestName,
      guest_email AS guestEmail,
      guest_phone AS guestPhone,
      comments,
      total_days AS totalDays,
      total_price AS totalPrice,
      status,
      is_read AS isRead,
      created_at AS createdAt
    FROM booking_requests
    WHERE status = 'pending' AND is_read = 0
    ORDER BY datetime(created_at) DESC
    LIMIT 5
  `),
  unreadNotificationCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM booking_requests
    WHERE status = 'pending' AND is_read = 0
  `),
  allRequests: db.prepare(`
    SELECT
      id,
      start_date AS startDate,
      end_date AS endDate,
      guest_name AS guestName,
      guest_email AS guestEmail,
      guest_phone AS guestPhone,
      comments,
      total_days AS totalDays,
      total_price AS totalPrice,
      status,
      is_read AS isRead,
      created_at AS createdAt,
      reviewed_at AS reviewedAt
    FROM booking_requests
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        ELSE 2
      END,
      datetime(created_at) DESC
  `),
  requestDaysByRequest: db.prepare(`
    SELECT request_id AS requestId, date
    FROM request_days
    WHERE request_id = ?
    ORDER BY date
  `),
  getRequestById: db.prepare(`
    SELECT
      id,
      start_date AS startDate,
      end_date AS endDate,
      guest_name AS guestName,
      guest_email AS guestEmail,
      guest_phone AS guestPhone,
      comments,
      total_days AS totalDays,
      total_price AS totalPrice,
      status,
      is_read AS isRead,
      created_at AS createdAt,
      reviewed_at AS reviewedAt
    FROM booking_requests
    WHERE id = ?
  `),
  markRequestRead: db.prepare(`
    UPDATE booking_requests
    SET is_read = 1
    WHERE id = ?
  `),
  updateRequestStatus: db.prepare(`
    UPDATE booking_requests
    SET
      status = ?,
      is_read = 1,
      reviewed_at = ?
    WHERE id = ?
  `),
  pendingCountsForRange: db.prepare(`
    SELECT
      request_days.date AS date,
      COUNT(*) AS pendingCount
    FROM request_days
    JOIN booking_requests ON booking_requests.id = request_days.request_id
    WHERE booking_requests.status = 'pending'
      AND request_days.date BETWEEN ? AND ?
    GROUP BY request_days.date
  `),
  requestsForDay: db.prepare(`
    SELECT
      booking_requests.id AS id,
      booking_requests.start_date AS startDate,
      booking_requests.end_date AS endDate,
      booking_requests.guest_name AS guestName,
      booking_requests.guest_email AS guestEmail,
      booking_requests.guest_phone AS guestPhone,
      booking_requests.comments AS comments,
      booking_requests.total_days AS totalDays,
      booking_requests.total_price AS totalPrice,
      booking_requests.status AS status,
      booking_requests.is_read AS isRead,
      booking_requests.created_at AS createdAt
    FROM booking_requests
    JOIN request_days ON request_days.request_id = booking_requests.id
    WHERE request_days.date = ?
    ORDER BY
      CASE booking_requests.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        ELSE 2
      END,
      datetime(booking_requests.created_at) DESC
  `),
  insertSession: db.prepare(`
    INSERT INTO admin_sessions (token, username, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `),
  getSession: db.prepare(`
    SELECT token, username, expires_at AS expiresAt
    FROM admin_sessions
    WHERE token = ?
  `),
  deleteSession: db.prepare(`
    DELETE FROM admin_sessions
    WHERE token = ?
  `),
  deleteExpiredSessions: db.prepare(`
    DELETE FROM admin_sessions
    WHERE expires_at <= ?
  `),
  closeRequestDayFromAcceptedRequest: db.prepare(`
    UPDATE availability
    SET
      status = 'closed',
      guest_name = ?,
      guest_email = ?,
      guest_phone = ?,
      notes = COALESCE(notes, ''),
      source_request_id = ?,
      updated_at = ?
    WHERE date = ?
  `),
};

seedAvailability();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, url);
      return;
    }

    await serveStaticFile(response, pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "The server could not process the request.",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Calendar system running at http://localhost:${PORT}`);
  console.log(`Admin dashboard at http://localhost:${PORT}/admin/`);
});

function seedAvailability() {
  const { count } = statements?.availabilityCount?.get?.() ?? { count: 0 };

  if (count > 0) {
    return;
  }

  const seedRows = buildDemoAvailability({ startDate: MIN_DATE, endDate: MAX_DATE });
  const timestamp = nowIso();

  db.exec("BEGIN");

  try {
    for (const row of seedRows) {
      statements.insertAvailability.run(row.date, row.status, row.price, timestamp);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function handleApiRequest(request, response, url) {
  const { pathname, searchParams } = url;

  if (pathname === "/api/availability" && request.method === "GET") {
    return handlePublicAvailability(response, searchParams);
  }

  if (pathname === "/api/requests" && request.method === "POST") {
    return handleCreateBookingRequest(request, response);
  }

  if (pathname === "/api/admin/session" && request.method === "GET") {
    return handleAdminSession(request, response);
  }

  if (pathname === "/api/admin/login" && request.method === "POST") {
    return handleAdminLogin(request, response);
  }

  if (pathname === "/api/admin/logout" && request.method === "POST") {
    return handleAdminLogout(request, response);
  }

  const adminSession = requireAdminSession(request, response);

  if (!adminSession) {
    return;
  }

  if (pathname === "/api/admin/notifications" && request.method === "GET") {
    return handleAdminNotifications(response);
  }

  if (pathname === "/api/admin/requests" && request.method === "GET") {
    return handleAdminRequests(response);
  }

  if (pathname === "/api/admin/calendar" && request.method === "GET") {
    return handleAdminCalendar(response, searchParams);
  }

  if (pathname === "/api/admin/day" && request.method === "GET") {
    return handleAdminDay(response, searchParams);
  }

  if (pathname === "/api/admin/day" && request.method === "PUT") {
    return handleAdminDayUpdate(request, response);
  }

  const requestMatch = pathname.match(/^\/api\/admin\/requests\/(\d+)\/(read|accept|reject)$/);

  if (requestMatch && request.method === "POST") {
    const requestId = Number(requestMatch[1]);
    const action = requestMatch[2];

    if (action === "read") {
      return handleRequestRead(response, requestId);
    }

    if (action === "accept") {
      return handleRequestDecision(response, requestId, "accepted");
    }

    if (action === "reject") {
      return handleRequestDecision(response, requestId, "rejected");
    }
  }

  sendJson(response, 404, { error: "Route not found." });
}

function handlePublicAvailability(response, searchParams) {
  const startDate = normalizeDateKey(searchParams.get("start") ?? MIN_DATE);
  const endDate = normalizeDateKey(searchParams.get("end") ?? MAX_DATE);

  if (!startDate || !endDate || startDate > endDate) {
    return sendJson(response, 400, { error: "Invalid date range." });
  }

  const availability = statements.getAvailabilityRange.all(startDate, endDate);

  sendJson(response, 200, {
    availability,
    minDate: MIN_DATE,
    maxDate: MAX_DATE,
  });
}

async function handleCreateBookingRequest(request, response) {
  const body = await readJsonBody(request, response);

  if (!body) {
    return;
  }

  const startDate = normalizeDateKey(body?.stay?.startDate);
  const endDate = normalizeDateKey(body?.stay?.endDate);
  const guestName = cleanString(body?.guest?.name);
  const guestEmail = cleanString(body?.guest?.email);
  const guestPhone = cleanString(body?.guest?.phone);
  const comments = cleanString(body?.guest?.comments);

  if (!startDate || !endDate || startDate > endDate) {
    return sendJson(response, 400, { error: "Please choose a valid stay range." });
  }

  if (!guestName || !guestEmail || !guestPhone) {
    return sendJson(response, 400, {
      error: "Name, email, and phone number are required.",
    });
  }

  const requestedDates = getDatesInRange(startDate, endDate);
  const rows = statements.getAvailabilityRange.all(startDate, endDate);

  if (rows.length !== requestedDates.length) {
    return sendJson(response, 400, {
      error: "Some requested dates are outside the supported booking range.",
    });
  }

  const unavailableRow = rows.find((row) => row.status !== "open");

  if (unavailableRow) {
    return sendJson(response, 409, {
      error: "One or more selected dates are no longer available.",
    });
  }

  const totalPrice = rows.reduce((sum, row) => sum + Number(row.price), 0);
  const createdAt = nowIso();

  db.exec("BEGIN");

  try {
    const result = statements.createRequest.run(
      startDate,
      endDate,
      guestName,
      guestEmail,
      guestPhone,
      comments,
      requestedDates.length,
      totalPrice,
      createdAt
    );
    const requestId = Number(result.lastInsertRowid);

    for (const date of requestedDates) {
      statements.createRequestDay.run(requestId, date);
    }

    db.exec("COMMIT");

    sendJson(response, 201, {
      request: {
        id: requestId,
        startDate,
        endDate,
        totalDays: requestedDates.length,
        totalPrice,
        status: "pending",
      },
    });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function handleAdminSession(request, response) {
  const session = getAdminSession(request);

  if (!session) {
    return sendJson(response, 200, { authenticated: false });
  }

  sendJson(response, 200, {
    authenticated: true,
    username: session.username,
  });
}

async function handleAdminLogin(request, response) {
  const body = await readJsonBody(request, response);

  if (!body) {
    return;
  }

  const username = cleanString(body.username);
  const password = cleanString(body.password);

  if (!secureEquals(username, ADMIN_USERNAME) || !secureEquals(password, ADMIN_PASSWORD)) {
    return sendJson(response, 401, {
      error: "Incorrect username or password.",
    });
  }

  const token = randomBytes(24).toString("hex");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  statements.deleteExpiredSessions.run(nowIso());
  statements.insertSession.run(token, ADMIN_USERNAME, createdAt, expiresAt);

  sendJson(
    response,
    200,
    { authenticated: true, username: ADMIN_USERNAME },
    {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_DURATION_MS / 1000
      )}`,
    }
  );
}

function handleAdminLogout(request, response) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];

  if (token) {
    statements.deleteSession.run(token);
  }

  sendJson(
    response,
    200,
    { ok: true },
    {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    }
  );
}

function handleAdminNotifications(response) {
  const unread = statements.notifications.all().map(normalizeRequestRow);
  const countRow = statements.unreadNotificationCount.get();

  sendJson(response, 200, {
    unreadCount: Number(countRow.count),
    unread,
  });
}

function handleAdminRequests(response) {
  const requests = hydrateRequests(statements.allRequests.all());
  sendJson(response, 200, { requests });
}

function handleAdminCalendar(response, searchParams) {
  const inputMonth = normalizeDateKey(searchParams.get("month") ?? MIN_DATE) ?? MIN_DATE;
  const monthStart = startOfMonth(inputMonth);
  const monthEnd = endOfMonth(inputMonth);
  const days = statements.getAvailabilityRange.all(monthStart, monthEnd);
  const pendingCounts = new Map(
    statements.pendingCountsForRange
      .all(monthStart, monthEnd)
      .map((row) => [row.date, Number(row.pendingCount)])
  );

  sendJson(response, 200, {
    month: monthStart,
    days: days.map((day) => ({
      ...day,
      pendingCount: pendingCounts.get(day.date) ?? 0,
    })),
    minDate: MIN_DATE,
    maxDate: MAX_DATE,
  });
}

function handleAdminDay(response, searchParams) {
  const date = normalizeDateKey(searchParams.get("date"));

  if (!date) {
    return sendJson(response, 400, { error: "A valid date is required." });
  }

  const day = statements.getAvailabilityDay.get(date);

  if (!day) {
    return sendJson(response, 404, { error: "Date not found." });
  }

  const requests = hydrateRequests(statements.requestsForDay.all(date));

  sendJson(response, 200, {
    day,
    requests,
  });
}

async function handleAdminDayUpdate(request, response) {
  const body = await readJsonBody(request, response);

  if (!body) {
    return;
  }

  const date = normalizeDateKey(body.date);
  const status = body.status === "closed" ? "closed" : "open";
  const price = Number(body.price);
  const guestName = cleanString(body.guestName);
  const guestEmail = cleanString(body.guestEmail);
  const guestPhone = cleanString(body.guestPhone);
  const notes = cleanString(body.notes);

  if (!date || !Number.isInteger(price) || price < 0) {
    return sendJson(response, 400, { error: "Please provide a valid date and price." });
  }

  const existingDay = statements.getAvailabilityDay.get(date);

  if (!existingDay) {
    return sendJson(response, 404, { error: "Date not found." });
  }

  if (status === "closed" && (!guestName || !guestEmail || !guestPhone)) {
    return sendJson(response, 400, {
      error: "Closed days must include the guest name, email, and phone.",
    });
  }

  const updatedAt = nowIso();

  if (status === "open") {
    statements.updateDayOpen.run(price, notes, updatedAt, date);
  } else {
    statements.updateDayClosed.run(
      price,
      guestName,
      guestEmail,
      guestPhone,
      notes,
      updatedAt,
      date
    );
  }

  const day = statements.getAvailabilityDay.get(date);
  sendJson(response, 200, { day });
}

function handleRequestRead(response, requestId) {
  const requestRow = statements.getRequestById.get(requestId);

  if (!requestRow) {
    return sendJson(response, 404, { error: "Request not found." });
  }

  statements.markRequestRead.run(requestId);
  sendJson(response, 200, { ok: true });
}

function handleRequestDecision(response, requestId, decision) {
  const requestRow = statements.getRequestById.get(requestId);

  if (!requestRow) {
    return sendJson(response, 404, { error: "Request not found." });
  }

  if (requestRow.status !== "pending") {
    return sendJson(response, 400, {
      error: "Only pending requests can be reviewed.",
    });
  }

  const requestedDays = statements.requestDaysByRequest.all(requestId).map((row) => row.date);
  const reviewedAt = nowIso();

  if (decision === "rejected") {
    statements.updateRequestStatus.run("rejected", reviewedAt, requestId);
    return sendJson(response, 200, { ok: true });
  }

  const conflictingDate = requestedDays.find((date) => {
    const row = statements.getAvailabilityDay.get(date);
    return !row || row.status !== "open";
  });

  if (conflictingDate) {
    return sendJson(response, 409, {
      error: `The request cannot be accepted because ${conflictingDate} is already closed.`,
    });
  }

  db.exec("BEGIN");

  try {
    for (const date of requestedDays) {
      statements.closeRequestDayFromAcceptedRequest.run(
        requestRow.guestName,
        requestRow.guestEmail,
        requestRow.guestPhone,
        requestId,
        reviewedAt,
        date
      );
    }

    statements.updateRequestStatus.run("accepted", reviewedAt, requestId);
    db.exec("COMMIT");

    sendJson(response, 200, { ok: true });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function requireAdminSession(request, response) {
  const session = getAdminSession(request);

  if (!session) {
    sendJson(response, 401, { error: "Authentication required." });
    return null;
  }

  return session;
}

function getAdminSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  statements.deleteExpiredSessions.run(nowIso());

  const session = statements.getSession.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= nowIso()) {
    statements.deleteSession.run(token);
    return null;
  }

  return session;
}

async function serveStaticFile(response, pathname) {
  let filePath;

  if (pathname === "/" || pathname === "/index.html") {
    filePath = path.join(__dirname, "index.html");
  } else if (pathname === "/admin" || pathname === "/admin/") {
    filePath = path.join(__dirname, "admin", "index.html");
  } else if (pathname.startsWith("/src/") || pathname.startsWith("/admin/")) {
    filePath = path.resolve(__dirname, `.${pathname}`);
  } else {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    await access(filePath);
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      throw new Error("Not a file");
    }

    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
    });

    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function readJsonBody(request, response) {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.includes("application/json")) {
    sendJson(response, 415, { error: "JSON requests are required." });
    return null;
  }

  let raw = "";

  for await (const chunk of request) {
    raw += chunk;

    if (raw.length > 1_000_000) {
      sendJson(response, 413, { error: "Request body is too large." });
      return null;
    }
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body." });
    return null;
  }
}

function hydrateRequests(rows) {
  if (rows.length === 0) {
    return [];
  }

  return rows.map((row) => {
    const normalized = normalizeRequestRow(row);
    const dates = statements.requestDaysByRequest
      .all(normalized.id)
      .map((requestDay) => requestDay.date);

    return {
      ...normalized,
      dates,
    };
  });
}

function normalizeRequestRow(row) {
  return {
    ...row,
    id: Number(row.id),
    totalDays: Number(row.totalDays),
    totalPrice: Number(row.totalPrice),
    isRead: Boolean(row.isRead),
  };
}

function parseCookies(header = "") {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex);
      const value = decodeURIComponent(part.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function secureEquals(actual, expected) {
  const left = Buffer.from(actual ?? "", "utf8");
  const right = Buffer.from(expected ?? "", "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

function getDatesInRange(startDate, endDate) {
  const dates = [];
  let current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  return dates;
}

function startOfMonth(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

function endOfMonth(dateKey) {
  const [year, month] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const fileContents = readFileSync(filePath, "utf8");

  for (const line of fileContents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}
