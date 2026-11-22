import { describe, expect, it } from "vitest";

import { formatSimulationDate } from "./simulation-date";

describe("formatSimulationDate", () => {
  it("keeps the simulation date stable and advances it after midnight", () => {
    expect(formatSimulationDate("2026-01-01", 28_800)).toBe("01. 01. 2026.");
    expect(formatSimulationDate("2026-01-01", 90_000)).toBe("02. 01. 2026.");
  });
});
