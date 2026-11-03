"use client";
import "./tokens.css";
import "@/components/ds/ds.css";
import "@/components/ds/error-page.css";

// Last-resort boundary when the root layout itself fails.
export default function GlobalError({reset}: {error: Error; reset: () => void}) {
 return <html lang="fr"><body><div className="ds-error-page"><main className="ds-empty" role="alert"><h1 className="ds-empty-title">Braand redémarre</h1><p className="ds-empty-text">Une erreur inattendue est survenue. Vos données sont en sécurité.</p><div className="ds-empty-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={reset}>Réessayer</button></div></main></div></body></html>;
}
