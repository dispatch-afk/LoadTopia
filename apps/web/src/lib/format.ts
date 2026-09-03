export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtWindow(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    const sameDay = s.toDateString() === e.toDateString();
    return sameDay
      ? `${fmtDate(start)}, ${s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : `${fmtDateTime(start)} → ${fmtDateTime(end)}`;
  }
  return fmtDateTime(start ?? end);
}

export function fmtMiles(miles: number | null): string {
  return miles == null ? "—" : `${miles.toLocaleString()} mi`;
}

export function fmtDriveTime(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtWeight(lbs: number | null): string {
  return lbs == null ? "—" : `${lbs.toLocaleString()} lb`;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** For datetime-local <input> values (needs `YYYY-MM-DDTHH:mm`, local time). */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(v: string): string | undefined {
  if (!v) return undefined;
  return new Date(v).toISOString();
}
