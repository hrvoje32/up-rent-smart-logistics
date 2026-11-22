import { describe, expect, it } from "vitest";

import { apiDateTimeToInput, orderScheduleToApi, serializeZagrebDateTime } from "./order-scheduling";

describe("order schedule serialization", () => {
  it("serializes optional local fields as timezone-aware Europe/Zagreb values", () => {
    expect(serializeZagrebDateTime("2026-01-15T08:30")).toBe("2026-01-15T08:30:00+01:00");
    expect(serializeZagrebDateTime("2026-07-15T08:30")).toBe("2026-07-15T08:30:00+02:00");
    expect(apiDateTimeToInput("2026-01-15T08:30:00+01:00")).toBe("2026-01-15T08:30");
  });

  it("keeps empty fields unrestricted and rejects reversed windows", () => {
    expect(orderScheduleToApi({ earliest_pickup_at: "", latest_pickup_at: "", earliest_delivery_at: "", delivery_deadline_at: "" })).toEqual({ earliest_pickup_at: null, latest_pickup_at: null, earliest_delivery_at: null, delivery_deadline_at: null });
    expect(() => orderScheduleToApi({ earliest_pickup_at: "2026-01-15T10:00", latest_pickup_at: "2026-01-15T09:00", earliest_delivery_at: "", delivery_deadline_at: "" })).toThrow(/Najranije preuzimanje/);
  });
});
