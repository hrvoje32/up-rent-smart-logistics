import type { DemoDataset, OptimizationResult, TransportOrder, ValidationViolation } from "@/types/optimizer-api";

export type InfeasibilityKind = "PROVEN_INFEASIBLE" | "INVALID_INPUT" | "GLOBAL_CONSTRAINT" | "SEARCH_INCOMPLETE" | "UNVERIFIED";

export interface OrderWarning {
  order: TransportOrder;
  machineWeightKg: number | null;
  kind: InfeasibilityKind;
  title: string;
  explanation: string;
  correctiveAction: string;
  violations: ValidationViolation[];
}

export interface GlobalWarning {
  kind: InfeasibilityKind;
  title: string;
  explanation: string;
  correctiveAction: string;
}

export interface InfeasibilityWarnings {
  orders: OrderWarning[];
  global: GlobalWarning[];
}

const invalidInputCodes = new Set(["UNKNOWN_LOCATION", "UNKNOWN_ORDER", "UNKNOWN_VEHICLE", "UNSUPPORTED_TIME_CONSTRAINT", "WRONG_PICKUP_LOCATION", "WRONG_DELIVERY_LOCATION"]);
const timeCodes = new Set(["PICKUP_TIME_WINDOW_VIOLATION", "DELIVERY_TIME_WINDOW_VIOLATION", "UNSUPPORTED_TIME_CONSTRAINT"]);

function capacitySummary(dataset: DemoDataset): string {
  return dataset.vehicles.map((vehicle) => `${vehicle.id}: ${vehicle.max_payload_kg.toLocaleString("hr-HR")} kg / ${vehicle.max_simultaneous_machines} stroj(a)`).join("; ");
}

function globalWarnings(result: OptimizationResult): GlobalWarning[] {
  if (result.status === "NO_SOLUTION_FOUND") return [{ kind: "SEARCH_INCOMPLETE", title: "Pretraga nije pronašla rješenje", explanation: "Ograničena OR-Tools pretraga nije pronašla potpuno rješenje u dopuštenom vremenu. To samo po sebi nije dokaz da je ijedan pojedini nalog neizvediv.", correctiveAction: "Provjerite globalna ograničenja ili ponovno pokrenite plan s istim odabirom; ne uklanjajte naloge bez potvrđene dijagnostike." }];
  if (result.status === "VALIDATION_FAILED") return [{ kind: "INVALID_INPUT", title: "Plan nije prošao neovisnu provjeru", explanation: "Rješenje rješavača krši najmanje jedno poslovno pravilo provjere.", correctiveAction: "Pregledajte navedene provjerene povrede prije ponovnog pokretanja." }];
  if (result.status === "INFEASIBLE" && result.violations.some((violation) => violation.code === "REQUIRED_VEHICLE_UNUSED")) return [{ kind: "GLOBAL_CONSTRAINT", title: "Sukob obaveznog korištenja vozila", explanation: "Postavka zahtijeva stvarni nalog za svako odabrano vozilo, ali dijagnostika potvrđuje da to nije moguće za cijeli odabir.", correctiveAction: "Isključite obavezno korištenje svih vozila, dodajte kompatibilan nalog ili promijenite odabranu flotu." }];
  if (result.status === "INFEASIBLE" && !result.violations.some((violation) => violation.order_id)) return [{ kind: "GLOBAL_CONSTRAINT", title: "Dokazana neizvedivost plana", explanation: "Odabrana kombinacija ograničenja nije izvediva; dostupna dijagnostika ne pripisuje uzrok jednom nalogu.", correctiveAction: "Pregledajte ograničenja flote, vožnje i vremenskih prozora prije promjene odabira." }];
  return [];
}

function buildOrderWarning(dataset: DemoDataset, order: TransportOrder, violations: ValidationViolation[], isUnserved: boolean): OrderWarning {
  const machineWeightKg = dataset.machines.find((machine) => machine.id === order.machine_id)?.weight_kg ?? null;
  const codes = new Set(violations.map((violation) => violation.code));
  const capacity = capacitySummary(dataset);
  if (codes.has("UNSERVICEABLE_ORDER") || codes.has("WEIGHT_CAPACITY_EXCEEDED") || codes.has("MACHINE_COUNT_EXCEEDED")) return { order, machineWeightKg, violations, kind: "PROVEN_INFEASIBLE", title: "Nalog ne stane u odabranu flotu", explanation: `Stroj ${order.machine_id} ima masu ${machineWeightKg?.toLocaleString("hr-HR") ?? "nepoznatu"} kg. Odabrani kapaciteti su: ${capacity}. Provjera je prijavila ograničenje mase ili broja strojeva.`, correctiveAction: "Odaberite vozilo dovoljne nosivosti i kapaciteta strojeva ili smanjite teret prema stvarnim poslovnim pravilima." };
  if ([...codes].some((code) => timeCodes.has(code))) return { order, machineWeightKg, violations, kind: codes.has("UNSUPPORTED_TIME_CONSTRAINT") ? "INVALID_INPUT" : "PROVEN_INFEASIBLE", title: "Vremensko ograničenje naloga nije izvedivo", explanation: `Nalog ${order.id} ima vremensko ograničenje${order.delivery_deadline_at ? ` do ${order.delivery_deadline_at}` : ""}. Neovisna provjera prijavila je povredu ili nepodržanu vremensku postavku.`, correctiveAction: "Provjerite početak planiranja s vremenskom zonom, rok preuzimanja/isporuke i ostavite dovoljno vremena za vožnju i uslugu." };
  if ([...codes].some((code) => invalidInputCodes.has(code))) return { order, machineWeightKg, violations, kind: "INVALID_INPUT", title: "Nalog ima neispravnu referencu", explanation: "Neovisna provjera je pronašla nepoznatu ili pogrešnu referencu lokacije, vozila ili naloga.", correctiveAction: "Ispravite lokaciju, stroj ili odabrano vozilo u master zapisima, zatim ponovno pokrenite optimizaciju." };
  if (isUnserved) return { order, machineWeightKg, violations, kind: "UNVERIFIED", title: "Nalog nije raspoređen", explanation: "Nalog je odabran, ali nije izvršen u vraćenom planu. Dostupna dijagnostika ne dokazuje jedinstveni uzrok za ovaj nalog.", correctiveAction: "Pregledajte globalna ograničenja i navedene povrede; ne uklanjajte nalog samo radi uspješnog prikaza plana." };
  return { order, machineWeightKg, violations, kind: "UNVERIFIED", title: "Potrebna je dodatna provjera", explanation: "Za ovaj nalog postoji dijagnostika, ali ona ne dokazuje pojedinačni uzrok.", correctiveAction: "Pregledajte povezane provjere prije izmjene plana." };
}

export function buildInfeasibilityWarnings(dataset: DemoDataset, result: OptimizationResult): InfeasibilityWarnings {
  const validation = result.validation_result;
  const violations = [...result.violations, ...(validation?.violations ?? [])];
  const unserved = new Set(validation?.unserved_order_ids ?? []);
  const affectedIds = new Set([...unserved, ...violations.flatMap((violation) => violation.order_id ? [violation.order_id] : [])]);
  return {
    orders: dataset.orders.filter((order) => affectedIds.has(order.id)).map((order) => buildOrderWarning(dataset, order, violations.filter((violation) => violation.order_id === order.id), unserved.has(order.id))),
    global: globalWarnings(result),
  };
}
