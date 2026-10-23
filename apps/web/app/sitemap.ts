import type { MetadataRoute } from "next";
import { ABOUT_URL, SITE_URL } from "@/lib/site-info";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date() },
    { url: ABOUT_URL, lastModified: new Date() },
  ];
}