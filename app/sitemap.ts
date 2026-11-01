import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/legal-policy.mjs";
import { HELP_ARTICLES } from "@/lib/help-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-10-25T00:00:00.000Z");
  return [
    { url: `${SITE_ORIGIN}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_ORIGIN}/aide`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    ...HELP_ARTICLES.map((article) => ({
      url: `${SITE_ORIGIN}/aide/${article.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
