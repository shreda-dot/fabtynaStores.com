/**
 * Development-only transport simulation for the mock API.
 *
 * `NEXT_PUBLIC_MOCK_LATENCY_MS`  – extra delay added to every mock call (ms).
 * `NEXT_PUBLIC_MOCK_FAILURE_RATE` – probability (0..1) that a mock call fails.
 *
 * Both default to 0, so production builds behave exactly as before. A simulated
 * failure is thrown *before* any store mutation runs, so data is never corrupted.
 */
function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const EXTRA_LATENCY_MS = Math.max(0, toNumber(process.env.NEXT_PUBLIC_MOCK_LATENCY_MS, 0));
const FAILURE_RATE = Math.min(1, Math.max(0, toNumber(process.env.NEXT_PUBLIC_MOCK_FAILURE_RATE, 0)));

const SIMULATED_FAILURE_MESSAGE =
  "Simulated network failure (NEXT_PUBLIC_MOCK_FAILURE_RATE is set).";

export async function mockDelay(): Promise<void> {
  const baseLatencyMs = 150 + Math.floor(Math.random() * 151);
  await new Promise((resolve) =>
    setTimeout(resolve, baseLatencyMs + EXTRA_LATENCY_MS),
  );

  if (FAILURE_RATE > 0 && Math.random() < FAILURE_RATE) {
    throw new Error(SIMULATED_FAILURE_MESSAGE);
  }
}

export function isMockFailureSimulationEnabled(): boolean {
  return FAILURE_RATE > 0;
}
