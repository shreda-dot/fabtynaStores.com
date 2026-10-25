import type { Metadata } from "next";
import Link from "next/link";
import { ABOUT_TITLE, ABOUT_URL, OG_IMAGE_URL, SITE, SITE_URL } from "@/lib/site-info";

export const metadata: Metadata = {
  title: ABOUT_TITLE,
  description: SITE.description,
  alternates: { canonical: ABOUT_URL },
  robots: { index: true, follow: true },
  openGraph: {
    title: ABOUT_TITLE,
    description: SITE.description,
    url: ABOUT_URL,
    siteName: SITE.name,
    type: "website",
    images: [{ url: OG_IMAGE_URL, width: 1200, height: 630, alt: SITE.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: ABOUT_TITLE,
    description: SITE.description,
    images: [OG_IMAGE_URL],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": ABOUT_URL,
      url: ABOUT_URL,
      name: ABOUT_TITLE,
      description: SITE.description,
      mainEntity: { "@id": `${ABOUT_URL}#app` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${ABOUT_URL}#app`,
      name: SITE.name,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: ABOUT_URL,
      description: SITE.description,
      author: { "@id": `${ABOUT_URL}#developer` },
    },
    {
      "@type": "Person",
      "@id": `${ABOUT_URL}#developer`,
      name: SITE.developerName,
      alternateName: SITE.developerHandle,
      description: `Developer of ${SITE.name}, fabtyna.com, and schooldra.com`,
      url: ABOUT_URL,
    },
    {
      "@type": "WebSite",
      name: "Fabtyna",
      url: SITE.fabtynaUrl,
      creator: { "@id": `${ABOUT_URL}#developer` },
    },
    {
      "@type": "WebSite",
      name: "Schooldra",
      url: SITE.schooldraUrl,
      creator: { "@id": `${ABOUT_URL}#developer` },
    },
  ],
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <article className="space-y-10">
        {/* Header Section */}
        <header className="space-y-3 border-b border-border pb-6">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              Internal Enterprise Platform
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{SITE.name}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {SITE.description || "A comprehensive, high-throughput retail and wholesale inventory management system optimized for multi-location distribution operations."}
          </p>
        </header>

        {/* Feature Overview Grid */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Core System Capabilities</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4 bg-card shadow-sm">
              <h3 className="font-medium text-card-foreground">Inventory & Stock Ledger</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Real-time tracking of warehouse and retail shelf stock balances, unit conversions, and batch movements.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4 bg-card shadow-sm">
              <h3 className="font-medium text-card-foreground">Sales & Purchases</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Automated cost calculations, margin analysis, and multi-channel wholesale order processing.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4 bg-card shadow-sm">
              <h3 className="font-medium text-card-foreground">Expenses & Cash Flow</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Granular ledger entry and tracking across cash drawers, store expenses, and bank accounts.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4 bg-card shadow-sm">
              <h3 className="font-medium text-card-foreground">Financial Reporting</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                End-of-day sales reconciliation, profit summaries, and operational analytics.
              </p>
            </div>
          </div>
        </section>

        {/* Developer & Ecosystem Section */}
        <section className="rounded-xl border border-border bg-muted/30 p-6 space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Developer & Ecosystem</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Engineered and maintained by <span className="font-medium text-foreground">{SITE.developerName}</span> ({SITE.developerHandle}).
          </p>
          <div className="pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Related Platforms</h3>
            <div className="mt-2 flex flex-wrap gap-3">
              <a
                href={SITE.fabtynaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                fabtyna.com &rarr;
              </a>
              <span className="text-muted-foreground/40">•</span>
              <a
                href={SITE.schooldraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                schooldra.com &rarr;
              </a>
            </div>
          </div>
        </section>

        {/* Access & Contact Section */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border p-6 bg-card shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Access & Support</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              This application is restricted to authorized personnel. For administrative access or inquiries, contact system support.
            </p>
          </div>
          <a
            href={`mailto:${SITE.supportEmail}`}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            Contact Support
          </a>
        </section>
      </article>
    </main>
  );
}