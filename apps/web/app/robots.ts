import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-info";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/about", "/login", "/llms.txt", "/_next/static/"],
        disallow: ["/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}