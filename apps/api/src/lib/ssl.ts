/**
 * One place that decides whether a node-postgres connection uses SSL.
 *
 * - Default is SSL ON (certificate not verified here), exactly as the verify and
 *   audit scripts always did. When the URL carries its own `sslmode`, node-postgres
 *   applies it on top of this value, so `verify-full` keeps full verification.
 * - `sslmode=disable` turns SSL off, but only for localhost, 127.0.0.1 or ::1.
 *   For any other host this throws, so a hosted database can never be reached
 *   without SSL by accident.
 * - Error messages never contain the connection string or the host name.
 */
export type SslConfig = false | { rejectUnauthorized: false };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function resolveSslConfig(connectionString: string): SslConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The database connection string is not a valid URL.");
  }

  const mode = (url.searchParams.get("sslmode") ?? "").trim().toLowerCase();
  if (mode !== "disable") {
    return { rejectUnauthorized: false };
  }

  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(
      "SSL cannot be disabled for this database host: sslmode=disable is only allowed for localhost, 127.0.0.1 or ::1.",
    );
  }
  return false;
}
