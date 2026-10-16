"use client";

/**
 * Last-resort boundary. It replaces the root layout, so it must render its own
 * <html>/<body> and cannot rely on providers or the global stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#f6f7f9",
          color: "#1c2430",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Fabtyna Stores hit an unexpected problem
          </h1>
          <p style={{ marginTop: "0.75rem", color: "#5b6675", lineHeight: 1.5 }}>
            The app couldn&apos;t recover from an error. Reload the page to try again.
          </p>
          {process.env.NODE_ENV === "development" && (
            <pre
              style={{
                marginTop: "1rem",
                textAlign: "left",
                fontSize: "0.75rem",
                overflow: "auto",
                background: "#eef1f5",
                padding: "0.75rem",
                borderRadius: "0.5rem",
              }}
            >
              {error.stack ?? error.message}
            </pre>
          )}
          <div
            style={{
              marginTop: "1.25rem",
              display: "flex",
              gap: "0.5rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: "2.75rem",
                padding: "0 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #dde1e7",
                background: "#33465c",
                color: "#ffffff",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <a
              href="/dashboard"
              style={{
                minHeight: "2.75rem",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #dde1e7",
                background: "#ffffff",
                color: "#1c2430",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go to dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
