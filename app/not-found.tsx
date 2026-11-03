import type {Metadata} from "next";
import Link from "next/link";
import {Compass} from "lucide-react";
import {BrandLogo} from "@/components/brand";
import "@/components/ds/error-page.css";

export const metadata: Metadata = {title: "Page introuvable | Braand", robots: {index: false, follow: false}};

export default function NotFound() {
 return <div className="ds-error-page">
  <header><Link prefetch={false} href="/" aria-label="Retour à Braand"><BrandLogo height={30}/></Link></header>
  <main id="contenu" className="ds-empty">
   <span className="ds-empty-icon" aria-hidden="true"><Compass/></span>
   <p className="ds-error-code">404</p>
   <h1 className="ds-empty-title">Cette page n’existe pas</h1>
   <p className="ds-empty-text">Le lien est peut-être ancien. Revenez à l’accueil pour continuer.</p>
   <div className="ds-empty-actions"><Link prefetch={false} className="ds-btn ds-btn-primary" href="/">Revenir à l’accueil</Link><Link prefetch={false} className="ds-btn ds-btn-ghost" href="/aide">Centre d’aide</Link></div>
  </main>
 </div>;
}
