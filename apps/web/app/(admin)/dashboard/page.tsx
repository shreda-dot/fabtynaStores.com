export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fabtyna Stores administration.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 text-card-foreground sm:p-6">
        <h2 className="text-lg font-semibold">Store workspace</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Manage the product catalogue and supplier contacts here. Purchasing,
          stock operations, and financial reporting will be introduced in later
          slices.
        </p>
      </section>
    </div>
  );
}
