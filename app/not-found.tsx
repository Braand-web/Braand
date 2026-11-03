import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import styles from "@/components/legal-page.module.css";

export const metadata: Metadata = {
  title: "Page introuvable | Braand",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className={styles.site}>
      <header className={styles.legalHeader}>
        <Link prefetch={false} className={styles.brand} href="/" aria-label="Retour à Braand">
          <BrandLogo height={32} />
        </Link>
      </header>
      <main id="contenu" className={styles.legalMain} tabIndex={-1}>
        <div className={styles.intro}>
          <h1>Page introuvable</h1>
          <p>Cette adresse n’existe pas ou n’est plus disponible.</p>
        </div>
        <article className={styles.article} aria-label="Pistes pour continuer">
          <section className={styles.next}>
            <h2>Continuer</h2>
            <ul>
              <li><Link prefetch={false} href="/">Revenir à l’accueil de Braand</Link></li>
              <li><Link prefetch={false} href="/aide">Consulter le centre d’aide</Link></li>
            </ul>
          </section>
        </article>
      </main>
    </div>
  );
}
