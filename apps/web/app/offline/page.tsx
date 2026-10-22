export const metadata = { title: "Offline | Fabtyna Stores", robots: { index: false } };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">No connection</h1>
      <p className="text-muted-foreground">
        Fabtyna needs the internet to record sales and payments. Reconnect and try again.
      </p>
    </main>
  );
}