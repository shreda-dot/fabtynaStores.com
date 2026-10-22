import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site-info";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    lang: "en",
    categories: ["business", "productivity"],
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: SITE.backgroundColor,
    theme_color: SITE.themeColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}