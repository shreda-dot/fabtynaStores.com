import { OnlineRedirect } from "@/components/online-redirect";

export const metadata = { title: "Offline | Fabtyna Stores", robots: { index: false } };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">No connection</h1>
      <p className="text-muted-foreground">
        Fabtyna needs the internet to record sales and payments. Reconnect and try again.
      </p>
      {/* A plain anchor on purpose: it is a full document navigation, so the
          service worker and server are asked again, and it works even when no
          JavaScript chunks are cached. next/link would not. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-1 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Try again
      </a>
      <OnlineRedirect />
    </main>
  );
}