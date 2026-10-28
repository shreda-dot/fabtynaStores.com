import type { Metadata } from "next";
import Link from "next/link";
import { ABOUT_TITLE, ABOUT_URL, OG_IMAGE_URL, SITE } from "@/lib/site-info";

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

const LAST_UPDATED = "October 2026";

const FEATURES = [
  {
    title: "Stock across locations",
    text: "Track stock in the fridge, the warehouse and the market, count in packs and units, and move stock between locations with a full history.",
  },
  {
    title: "Sales and purchases",
    text: "Record retail and wholesale sales, paid or on credit, and supplier purchases. Payments, voids and corrections never erase history.",
  },
  {
    title: "Customer and supplier balances",
    text: "See who owes the business and who the business owes, with a statement for every customer and supplier.",
  },
  {
    title: "Money and accounts",
    text: "Keep cash, bank and POS accounts, record transfers, expenses and loans, and reconcile each account against a physical count.",
  },
  {
    title: "Daily reports",
    text: "See sales, expenses and profit for each business day in Lagos time, plus product sales and the overall financial position.",
  },
  {
    title: "Exact money",
    text: "Every amount is stored in whole kobo, so totals add up exactly however many entries there are.",
  },
] as const;

const STEPS = [
  {
    title: "Set up",
    text: "Add products, customers, suppliers and accounts, then enter opening stock and balances.",
  },
  {
    title: "Record the day",
    text: "Buy stock, sell it, take payments and record expenses from a phone or a computer.",
  },
  {
    title: "Review",
    text: "Check the day's profit, the money in each account, and who still owes what.",
  },
] as const;

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
        <header className="space-y-3 border-b border-border pb-6">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            Private business app
          </span>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{SITE.name}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground">{SITE.description}</p>
        </header>

        <section aria-labelledby="features-heading" className="space-y-4">
          <h2 id="features-heading" className="text-xl font-semibold tracking-tight">
            What it does
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <h3 className="font-medium text-card-foreground">{feature.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{feature.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-heading" className="space-y-4">
          <h2 id="how-heading" className="text-xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Step {index + 1}
                </span>
                <h3 className="mt-1 font-medium text-card-foreground">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="install-heading" className="space-y-2">
          <h2 id="install-heading" className="text-xl font-semibold tracking-tight">
            Use it like an app
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Fabtyna Stores runs in the browser and can be installed on a phone or computer. In
            Chrome or Edge, choose Install app. On an iPhone, tap Share, then Add to Home Screen. An
            internet connection is needed to record sales and payments.
          </p>
        </section>

        <section
          aria-labelledby="developer-heading"
          className="space-y-4 rounded-xl border border-border bg-muted/30 p-6"
        >
          <h2 id="developer-heading" className="text-xl font-semibold tracking-tight">
            Built by
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Designed, built and maintained by{" "}
            <span className="font-medium text-foreground">{SITE.developerName}</span> (
            {SITE.developerHandle}), the developer of fabtyna.com and schooldra.com.
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <a
                href={SITE.fabtynaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                fabtyna.com
              </a>
              <span className="text-muted-foreground"> — the home of Fabtyna Stores.</span>
            </li>
            <li>
              <a
                href={SITE.schooldraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                schooldra.com
              </a>
              <span className="text-muted-foreground">
                {" "}
                — an exam-practice web app for Nigerian secondary school students preparing for JAMB
                and UTME.
              </span>
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="access-heading"
          className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center"
        >
          <div className="space-y-1">
            <h2 id="access-heading" className="text-lg font-semibold">
              Access and privacy
            </h2>
            <p className="text-sm text-muted-foreground">
              The application is private and needs a sign-in. Passwords are stored as salted hashes
              and all connections use HTTPS. No customer, sales or price data appears on this page.
              For access or questions, contact support.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <a
              href={`mailto:${SITE.supportEmail}`}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Contact support
            </a>
            <Link href="/login" className="text-sm font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">Last updated {LAST_UPDATED}.</p>
      </article>
    </main>
  );
}