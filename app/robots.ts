import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/legal-policy.mjs";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private application surfaces: API, authentication and administration.
        disallow: ["/api/", "/auth/", "/admin/"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
