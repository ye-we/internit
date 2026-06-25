export function daysUntil(raw: string | null): number | null {
  if (!raw) return null;
  return Math.ceil((new Date(raw).getTime() - Date.now()) / 86_400_000);
}

export function daysLabel(days: number | null): string {
  if (days === null) return "-";
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function compactDeadline(raw: string | null): string {
  if (!raw) return "No deadline";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(raw));
}

export function formatDate(raw: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(raw));
}

export function payLabel(value: boolean | null): string {
  if (value === true) return "Paid";
  if (value === false) return "Unpaid";
  return "Pay unclear";
}

export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
