const TIME_ZONE = "Europe/Amsterdam";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Formats a timestamp for display in Europe/Amsterdam, e.g. "19 nov 2026, 10:30". */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

const ymdFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar date in Europe/Amsterdam as YYYY-MM-DD. */
export function amsterdamDate(value: Date = new Date()): string {
  return ymdFormatter.format(value);
}

/** Adds days to a YYYY-MM-DD date (calendar arithmetic, no time zone). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(ymd: string): number {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** ISO week key of a YYYY-MM-DD date, e.g. "2026-W47". */
export function isoWeekKey(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - isoWeekday(ymd));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1, 12));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const longDateFormatter = new Intl.DateTimeFormat("nl-NL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** Short Dutch label of a YYYY-MM-DD date, e.g. "do 20 nov". */
export function formatDayLabel(ymd: string): string {
  return longDateFormatter.format(new Date(`${ymd}T12:00:00Z`)).replace(/\./g, "");
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}
