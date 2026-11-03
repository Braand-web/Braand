"use client";
import {useEffect} from "react";
import Link from "next/link";
import {RefreshCw, TriangleAlert} from "lucide-react";
import "@/components/ds/error-page.css";

// Route-level error boundary: a calm message, a retry and a way home.
export default function ErrorPage({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
 useEffect(() => {console.error("Unexpected interface error", error.digest || error.name);}, [error]);
 return <div className="ds-error-page">
  <main id="contenu" className="ds-empty" role="alert">
   <span className="ds-empty-icon ds-error-icon" aria-hidden="true"><TriangleAlert/></span>
   <h1 className="ds-empty-title">Un souci est survenu</h1>
   <p className="ds-empty-text">Votre travail enregistré est en sécurité. Réessayez dans un instant.</p>
   <div className="ds-empty-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={reset}><RefreshCw size={16} aria-hidden="true"/>Réessayer</button><Link prefetch={false} className="ds-btn ds-btn-ghost" href="/">Revenir à l’accueil</Link></div>
   {error.digest && <p className="ds-error-ref">Référence : {error.digest}</p>}
  </main>
 </div>;
}
