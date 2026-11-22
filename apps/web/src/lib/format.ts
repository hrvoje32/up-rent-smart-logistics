import { croatianPlural, integer, number } from "@/lib/i18n";

export function distance(value: number): string { return `${number(value / 10)} km`; }
export function weight(value: number): string { return `${integer(value)} kg`; }

export function duration(seconds: number): string {
  if (seconds === 0) return "0 min";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (remainingSeconds > 0) parts.push(`${remainingSeconds} s`);
  return parts.join(" ");
}

export function plural(value: number, word: "order" | "machine" | "action"): string { return croatianPlural(value, word === "order" ? "nalog" : word === "machine" ? "stroj" : "radnja"); }
