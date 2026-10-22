/**
 * Production runs in UTC. The idempotency expiry and the Lagos business-date
 * helper do not depend on the process time zone (checked on the test database
 * with TZ=UTC, Africa/Lagos and America/New_York: identical stored values), but
 * a host with a non-UTC zone makes logs, `now()` readings and any future
 * date code harder to reason about. A deliberate non-UTC zone in production is
 * treated as a misconfiguration and the API refuses to start; an unset TZ on
 * Linux is UTC and passes.
 */
export function productionTimeZoneProblem(
  nodeEnv: string,
  tzEnv: string | undefined,
  resolvedZone: string,
): string | null {
  if (nodeEnv !== "production") {
    return null;
  }
  const declared = (tzEnv ?? "").trim();
  const effective = declared !== "" ? declared : resolvedZone;
  const isUtc = ["UTC", "Etc/UTC", "Etc/UCT", "UCT", "Z"].includes(effective);
  return isUtc
    ? null
    : "TZ must be UTC in production (set the TZ=UTC environment variable on the API host). Refusing to start.";
}

export function assertProductionTimeZone(nodeEnv: string): void {
  const problem = productionTimeZoneProblem(
    nodeEnv,
    process.env.TZ,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  if (problem !== null) {
    throw new Error(problem);
  }
}
