/**
 * Production guard for the web app's API mode.
 *
 * `NEXT_PUBLIC_API_MODE` defaults to "mock" for local work, which is the demo
 * login (any email and password) and browser-only data. That must never ship:
 * a production build (and a production runtime) needs mode "real" and a base URL.
 * Returns the problem text, or null when everything is fine.
 */
export function productionApiModeProblem(
  nodeEnv: string | undefined,
  mode: string | undefined,
  baseUrl: string | undefined,
): string | null {
  if (nodeEnv !== "production") {
    return null;
  }
  if (mode !== "real") {
    return 'Production builds require NEXT_PUBLIC_API_MODE="real" (the default "mock" is the demo login with browser-only data).';
  }
  const url = (baseUrl ?? "").trim();
  if (url === "") {
    return "Production builds require NEXT_PUBLIC_API_BASE_URL (the API's public https origin).";
  }
  try {
    new URL(url);
  } catch {
    return "NEXT_PUBLIC_API_BASE_URL must be a valid absolute URL.";
  }
  return null;
}
