import type { Metadata } from "next";
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
      description: "Developer of fabtyna.com and schooldra.com",
      url: ABOUT_URL,
    },
    { "@type": "WebSite", name: "Fabtyna", url: SITE.fabtynaUrl, creator: { "@id": `${ABOUT_URL}#developer` } },
    { "@type": "WebSite", name: "Schooldra", url: SITE.schooldraUrl, creator: { "@id": `${ABOUT_URL}#developer` } },
  ],
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <h1 className="text-2xl font-semibold">{SITE.name}</h1>
      <p>
        {SITE.name} is a business management system for a beer and soft drinks business in Lagos,
        Nigeria. It covers stock, sales, purchases, expenses, accounts and reports.
      </p>
      <h2 className="text-lg font-semibold">Developer</h2>
      <p>
        Built by {SITE.developerName} ({SITE.developerHandle}), developer of{" "}
        <a className="underline" href={SITE.fabtynaUrl}>fabtyna.com</a> and{" "}
        <a className="underline" href={SITE.schooldraUrl}>schooldra.com</a>.
      </p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>
        <a className="underline" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
      </p>
      <p className="text-sm text-muted-foreground">
        The application itself is private and requires a login.
      </p>
    </main>
  );
}