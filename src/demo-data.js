const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function rangeIncludes(dateKey, ranges) {
  return ranges.some(([start, end]) => dateKey >= start && dateKey <= end);
}

function getSeasonalPrice(date) {
  const day = date.getDay();
  const month = date.getMonth();
  const isWeekend = day === 5 || day === 6;

  let basePrice = 245;

  if (month >= 5 && month <= 7) {
    basePrice = 295;
  } else if (month >= 8 && month <= 9) {
    basePrice = 275;
  }

  if (isWeekend) {
    basePrice += 30;
  }

  return basePrice;
}

export function buildDemoAvailability({
  startDate = "2026-03-17",
  endDate = "2026-12-31",
} = {}) {
  const closedRanges = [
    ["2026-03-24", "2026-03-26"],
    ["2026-04-12", "2026-04-15"],
    ["2026-05-22", "2026-05-25"],
    ["2026-06-18", "2026-06-20"],
    ["2026-07-08", "2026-07-11"],
    ["2026-08-15", "2026-08-18"],
    ["2026-09-03", "2026-09-05"],
    ["2026-10-10", "2026-10-13"],
    ["2026-11-25", "2026-11-29"],
    ["2026-12-23", "2026-12-31"],
  ];

  const promotionalDates = new Map([
    ["2026-03-17", 235],
    ["2026-03-18", 235],
    ["2026-04-03", 255],
    ["2026-06-26", 325],
    ["2026-07-17", 340],
    ["2026-08-07", 335],
  ]);

  const availability = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days = Math.round(
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      MS_PER_DAY
  );

  for (let index = 0; index <= days; index += 1) {
    const currentDate = addDays(start, index);
    const dateKey = formatDateKey(currentDate);
    const status = rangeIncludes(dateKey, closedRanges) ? "closed" : "open";
    const price = promotionalDates.get(dateKey) ?? getSeasonalPrice(currentDate);

    availability.push({
      date: dateKey,
      status,
      price,
    });
  }

  return availability;
}
