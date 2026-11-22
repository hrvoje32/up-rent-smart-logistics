import "server-only";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const requestWindows = new Map<string, number[]>();

export class OptimizerRateLimitError extends Error {}

/** Instance-local guard; FastAPI retains its independent single-solve semaphore. */
export function assertOptimizerRateLimit(userId: string, now = Date.now()): void {
  const recent = (requestWindows.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) throw new OptimizerRateLimitError("Previše zahtjeva za optimizaciju. Pokušajte ponovno za minutu.");
  recent.push(now); requestWindows.set(userId, recent);
}
