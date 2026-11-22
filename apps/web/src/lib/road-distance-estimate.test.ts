import { describe, expect, it } from "vitest";

import {
  DEFAULT_CIRCUITY_SCALE,
  estimateRoadDistanceTenthsKm,
  estimateRoadMetrics,
} from "./road-distance-estimate";

const metric = {
  distance_tenths_km: 1822,
  driving_time_seconds: 10_932,
  pickup_service_seconds: 12_000,
  delivery_service_seconds: 12_000,
};

describe("estimated road distance simulation", () => {
  it("keeps factor 1.00 equal to the authoritative Euclidean total", () => {
    expect(estimateRoadDistanceTenthsKm(1822, 100)).toBe(1822);
  });

  it("uses one deterministic half-up rounding step for the 1.30 reference", () => {
    expect(estimateRoadDistanceTenthsKm(1822, DEFAULT_CIRCUITY_SCALE)).toBe(2369);
    expect(estimateRoadDistanceTenthsKm(4772, DEFAULT_CIRCUITY_SCALE)).toBe(6204);
    expect(estimateRoadDistanceTenthsKm(1, 150)).toBe(2);
  });

  it("uses rounded estimated distance at 60 km/h while retaining service durations", () => {
    expect(estimateRoadMetrics(metric, 130)).toMatchObject({
      estimatedDistanceTenthsKm: 2369,
      estimatedDrivingSeconds: 14_214,
      pickupServiceSeconds: 12_000,
      deliveryServiceSeconds: 12_000,
      estimatedElapsedSeconds: 38_214,
      exceedsOriginalDrivingLimit: false,
    });
  });

  it("keeps idle metrics at zero, leaves inputs untouched, and flags scenario-only driving overages", () => {
    const idle = { distance_tenths_km: 0, driving_time_seconds: 0, pickup_service_seconds: 0, delivery_service_seconds: 0 };
    const original = structuredClone(metric);
    expect(estimateRoadMetrics(idle, 180)).toMatchObject({ estimatedDistanceTenthsKm: 0, estimatedElapsedSeconds: 0 });
    expect(estimateRoadMetrics({ ...metric, distance_tenths_km: 3001 }, 180).exceedsOriginalDrivingLimit).toBe(true);
    estimateRoadMetrics(metric, 130);
    expect(metric).toEqual(original);
  });

  it("rejects factors outside the supported integer scale", () => {
    expect(() => estimateRoadDistanceTenthsKm(100, 99)).toThrow(/circuity scale/i);
    expect(() => estimateRoadDistanceTenthsKm(100, 131)).toThrow(/circuity scale/i);
  });
});
