"use client";

import {useCallback, useEffect, useState} from "react";
import {LoaderCircle} from "lucide-react";
import {BrandMark} from "./brand";

type LoginForm = {authenticated: boolean; browser?: string; returnTo: string; googleAvailable?: boolean; known?: boolean};

export function GoogleIcon({size = 18}: {size?: number}) {
 return <svg className="google-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
 </svg>;
}

export function SignIn({returnTo}: {returnTo?: string}) {
 const [form, setForm] = useState<LoginForm | null>(null);
 const [error, setError] = useState("");
 const [leaving, setLeaving] = useState(false);
 const [revision, setRevision] = useState(0);

 const prepare = useCallback(async (signal: AbortSignal) => {
  const destination = new URL(window.location.href);
  destination.searchParams.delete("auth");
  destination.searchParams.delete("return_to");
  const response = await fetch("/auth/form?return_to=" + encodeURIComponent(returnTo ?? destination.pathname + destination.search + destination.hash), {credentials:"same-origin", cache:"no-store", signal});
  if (!response.ok) throw new Error("unavailable");
  const data: LoginForm = await response.json();
  if (typeof data.returnTo !== "string" || !data.returnTo.startsWith("/") || data.returnTo.startsWith("//")) throw new Error("invalid");
  if (data.authenticated) {window.location.replace(data.returnTo); return null;}
  if (!data.browser || !/^[A-Za-z0-9_-]{43}$/.test(data.browser)) throw new Error("invalid");
  return data;
 }, [returnTo]);

 useEffect(() => {
  const controller = new AbortController();
  void prepare(controller.signal).then(data => {if (!controller.signal.aborted) {setForm(data); setError("");}}).catch(() => {if (!controller.signal.aborted) setError("La connexion n’a pas pu être préparée. Vérifiez votre réseau et réessayez.");});
  return () => controller.abort();
 }, [prepare, revision]);

 // The server remembers (cookie, no identity) that this browser already signed in.
 const known = !!form?.known;
 const unavailable = !!form && !form.googleAvailable;
 const href = form ? "/auth/google?return_to=" + encodeURIComponent(form.returnTo) : undefined;

 return <div className="auth-content" aria-busy={!form && !error || leaving}>
  <span className="brand-mark" aria-hidden="true"><BrandMark/></span>
  <h3>{known ? "Bon retour sur Braand." : "Gardons vos idées ensemble."}</h3>
  <p>{known ? "Continuez avec votre compte Google pour retrouver votre espace." : "Un seul clic avec Google : nous retrouvons votre espace s’il existe, sinon nous le créons pour vous."}</p>
  {form && !unavailable && <a className="button secondary auth-google" href={href} aria-disabled={leaving} onClick={event => {if (leaving) {event.preventDefault(); return;} setLeaving(true);}}>
   {leaving ? <LoaderCircle size={18} className="spin" aria-hidden="true"/> : <GoogleIcon/>}
   <span>{leaving ? "Ouverture de Google…" : "Continuer avec Google"}</span>
  </a>}
  {unavailable && <p className="auth-error" role="alert">La connexion avec Google est momentanément indisponible. Réessayez dans quelques minutes.</p>}
  {error && <p className="auth-error" role="alert">{error}</p>}
  {!form && !error && <span role="status" className="sr-only">Vérification de votre session…</span>}
  {(error || unavailable) && <button type="button" className="button secondary" onClick={() => {setError(""); setForm(null); setRevision(value => value + 1);}}>Réessayer</button>}
  <span className="fine-print">Nouveau sur Braand ? Votre compte est créé automatiquement à la première connexion. Vous revenez à la page ouverte, brouillon compris.</span>
 </div>;
}

/** @deprecated kept for imports; Braand signs in with Google only. */
export const EmailSignIn = SignIn;
