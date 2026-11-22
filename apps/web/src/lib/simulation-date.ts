export function formatSimulationDate(simulatedStartDate: string, offsetSeconds: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(simulatedStartDate);
  if (!match) return "Neispravan simulirani datum";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Math.floor(offsetSeconds / 86_400));
  return new Intl.DateTimeFormat("hr-HR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}
