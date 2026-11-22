import type { OptimizationStatus } from "@/types/optimizer-api";

export const locale = "hr-HR";
export const t = {
  notReported: "Nije dostupno",
  notApplicable: "Nije primjenjivo",
  active: "Aktivan",
  idle: "Neaktivan",
  valid: "Valjano",
  invalid: "Nevaljano",
  pickup: "Preuzimanje",
  delivery: "Isporuka",
  truck: "Kamion",
} as const;

export function statusLabel(status: OptimizationStatus): string {
  return { FEASIBLE: "Pronađen valjan raspored", INFEASIBLE: "Nije moguće izvršiti sve naloge uz zadana ograničenja", NO_SOLUTION_FOUND: "Rješenje nije pronađeno unutar zadanog vremena pretrage", VALIDATION_FAILED: "Raspored nije prošao provjeru", ERROR: "Došlo je do pogreške" }[status];
}

export function croatianPlural(value: number, noun: "nalog" | "stroj" | "radnja"): string {
  const forms = { nalog: ["nalog", "naloga", "naloga"], stroj: ["stroj", "stroja", "strojeva"], radnja: ["radnja", "radnje", "radnji"] }[noun];
  const mod10 = value % 10; const mod100 = value % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${new Intl.NumberFormat(locale).format(value)} ${form}`;
}

export function number(value: number, maximumFractionDigits = 1): string { return new Intl.NumberFormat(locale, { maximumFractionDigits, minimumFractionDigits: maximumFractionDigits }).format(value); }
export function integer(value: number): string { return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value); }
