import type { RouteMetrics } from "@/types/optimizer-api";

export const DEFAULT_CIRCUITY_SCALE = 130;
export const MIN_CIRCUITY_SCALE = 100;
export const MAX_CIRCUITY_SCALE = 180;
export const CIRCUITY_SCALE_STEP = 5;
const NINE_HOURS_SECONDS = 9 * 60 * 60;

export interface RoadDistanceEstimate {
  euclideanDistanceTenthsKm: number;
  estimatedDistanceTenthsKm: number;
  originalDrivingSeconds: number;
  estimatedDrivingSeconds: number;
  pickupServiceSeconds: number;
  deliveryServiceSeconds: number;
  estimatedElapsedSeconds: number;
  exceedsOriginalDrivingLimit: boolean;
}

export function circuityScaleOptions(): number[] {
  return Array.from(
    { length: (MAX_CIRCUITY_SCALE - MIN_CIRCUITY_SCALE) / CIRCUITY_SCALE_STEP + 1 },
    (_, index) => MIN_CIRCUITY_SCALE + index * CIRCUITY_SCALE_STEP,
  );
}

export function formatCircuityFactor(scale: number): string {
  return (scale / 100).toFixed(2);
}

export function estimateRoadDistanceTenthsKm(euclideanDistanceTenthsKm: number, circuityScale: number): number {
  validateCircuityScale(circuityScale);
  if (!Number.isInteger(euclideanDistanceTenthsKm) || euclideanDistanceTenthsKm < 0) {
    throw new Error("Euclidean distance must be a non-negative integer number of tenths of kilometres.");
  }
  return Math.floor((euclideanDistanceTenthsKm * circuityScale + 50) / 100);
}

export function estimateRoadMetrics(
  metric: Pick<RouteMetrics, "distance_tenths_km" | "driving_time_seconds" | "pickup_service_seconds" | "delivery_service_seconds">,
  circuityScale: number,
): RoadDistanceEstimate {
  const estimatedDistanceTenthsKm = estimateRoadDistanceTenthsKm(metric.distance_tenths_km, circuityScale);
  const estimatedDrivingSeconds = estimatedDistanceTenthsKm * 6;
  const estimatedElapsedSeconds = estimatedDrivingSeconds + metric.pickup_service_seconds + metric.delivery_service_seconds;
  return {
    euclideanDistanceTenthsKm: metric.distance_tenths_km,
    estimatedDistanceTenthsKm,
    originalDrivingSeconds: metric.driving_time_seconds,
    estimatedDrivingSeconds,
    pickupServiceSeconds: metric.pickup_service_seconds,
    deliveryServiceSeconds: metric.delivery_service_seconds,
    estimatedElapsedSeconds,
    exceedsOriginalDrivingLimit: estimatedDrivingSeconds > NINE_HOURS_SECONDS,
  };
}

function validateCircuityScale(circuityScale: number): void {
  if (!Number.isInteger(circuityScale) || circuityScale < MIN_CIRCUITY_SCALE || circuityScale > MAX_CIRCUITY_SCALE || circuityScale % CIRCUITY_SCALE_STEP !== 0) {
    throw new Error("Circuity scale must be an integer from 100 to 180 in increments of 5.");
  }
}
