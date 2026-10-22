import type { MetadataRoute } from "next";
import { ABOUT_URL } from "@/lib/site-info";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: ABOUT_URL }];
}