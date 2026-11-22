import type { BusinessLocation } from "@/lib/business-workspace";

/**
 * Shows the operator-facing location name while retaining an ID hint only when
 * two current locations would otherwise be indistinguishable in a selector.
 */
export function locationLabel(location: Pick<BusinessLocation, "id" | "display_name">, locations: ReadonlyArray<Pick<BusinessLocation, "id" | "display_name">>): string {
  const name = location.display_name.trim() || location.id;
  const duplicateNameCount = locations.filter((item) => (item.display_name.trim() || item.id) === name).length;
  return duplicateNameCount > 1 ? `${name} (${location.id})` : name;
}
