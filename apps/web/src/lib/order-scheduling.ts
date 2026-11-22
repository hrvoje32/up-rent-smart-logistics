export type OrderScheduleDraft = {
  earliest_pickup_at: string;
  latest_pickup_at: string;
  earliest_delivery_at: string;
  delivery_deadline_at: string;
};

type ScheduleValue = keyof OrderScheduleDraft;

function matchingZagrebOffset(localValue: string): string {
  const base = new Date(`${localValue}:00Z`);
  if (Number.isNaN(base.getTime())) throw new Error("Unesite valjan datum i vrijeme.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(base);
  const part = (name: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === name)?.value ?? "";
  const zoned = Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")), Number(part("hour")), Number(part("minute")));
  const offsetMinutes = Math.round((zoned - base.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function serializeZagrebDateTime(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Datum i vrijeme nisu u prepoznatljivom obliku.");
  const iso = `${value}:00${matchingZagrebOffset(value)}`;
  const check = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T");
  if (check !== value) throw new Error("Odabrano vrijeme ne postoji u vremenskoj zoni Europe/Zagreb.");
  return iso;
}

export function orderScheduleToApi(draft: OrderScheduleDraft): Record<ScheduleValue, string | null> {
  const fields: ScheduleValue[] = ["earliest_pickup_at", "latest_pickup_at", "earliest_delivery_at", "delivery_deadline_at"];
  const result = Object.fromEntries(fields.map((key) => [key, serializeZagrebDateTime(draft[key])])) as Record<ScheduleValue, string | null>;
  const date = (key: ScheduleValue): number | null => result[key] ? Date.parse(result[key]) : null;
  const earliestPickup = date("earliest_pickup_at"); const latestPickup = date("latest_pickup_at"); const earliestDelivery = date("earliest_delivery_at"); const deadline = date("delivery_deadline_at");
  if (earliestPickup !== null && latestPickup !== null && earliestPickup > latestPickup) throw new Error("Najranije preuzimanje mora biti prije najkasnijeg preuzimanja.");
  if (earliestDelivery !== null && deadline !== null && earliestDelivery > deadline) throw new Error("Najranija isporuka mora biti prije roka isporuke.");
  return result;
}

export function apiDateTimeToInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
}
