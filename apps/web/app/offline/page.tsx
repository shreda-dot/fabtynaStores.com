export const metadata = { title: "Offline | Fabtyna Stores", robots: { index: false } };

/**
 * Self-contained on purpose: this page is served by the service worker when
 * there is no network, so it cannot rely on globals.css or any JS chunk being
 * cached. Colours are copied from the --theme-* tokens in globals.css; update
 * them here if the brand palette changes.
 */
const STYLES = `
  :root {
    --off-bg: #f6f7f9;
    --off-fg: #1c2430;
    --off-muted: #5b6675;
    --off-primary: #33465c;
    --off-primary-fg: #ffffff;
    --off-ring: #4b6480;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --off-bg: #10151c;
      --off-fg: #dde4ec;
      --off-muted: #9aa7b6;
      --off-primary: #8ea8c4;
      --off-primary-fg: #10161d;
      --off-ring: #8ea8c4;
      color-scheme: dark;
    }
  }
  html, body { margin: 0; background: var(--off-bg); }
  .off-page {
    box-sizing: border-box;
    min-height: 100vh;
    padding: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--off-bg);
    color: var(--off-fg);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .off-card {
    display: flex;
    max-width: 28rem;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
  }
  .off-card h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
  .off-card p { margin: 0; font-size: 0.875rem; line-height: 1.375rem; color: var(--off-muted); }
  .off-btn {
    display: inline-flex;
    height: 2.75rem;
    margin-top: 0.25rem;
    padding: 0 1rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    background: var(--off-primary);
    color: var(--off-primary-fg);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }
  .off-btn:hover { opacity: 0.9; }
  .off-btn:focus-visible { outline: 2px solid var(--off-ring); outline-offset: 2px; }
`;

// Leaves this page as soon as the browser reports a connection.
const SCRIPT = `window.addEventListener("online", function () { window.location.replace("/"); });`;

export default function OfflinePage() {
  return (
    <main className="off-page">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="off-card">
        <h1>No connection</h1>
        <p>Fabtyna needs the internet to record sales and payments. Reconnect and try again.</p>
        {/* Plain anchor on purpose: a full document navigation that works with no JavaScript. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="off-btn">
          Try again
        </a>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </main>
  );
}