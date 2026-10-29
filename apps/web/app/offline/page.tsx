import Link from "next/link";

export const metadata = { title: "Offline | Fabtyna Stores", robots: { index: false } };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">No connection</h1>
      <p className="text-muted-foreground">
        Fabtyna needs the internet to record sales and payments. Reconnect and try again.
      </p>
      {/* A plain link: the service worker answers this navigation, so "retry"
          works even before any JavaScript has loaded. */}
      <Link
        href="/"
        className="mt-1 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Try again
      </Link>
    </main>
  );
}
