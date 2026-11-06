// Signed, short-lived link to a live preview running in a conversation's
// sandbox: which sandbox, which port, until when. HMAC-SHA256 with a secret
// shared by the main Worker (which signs) and the sandbox Worker (which checks).

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
const key = secret => crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);

export const PREVIEW_TTL_MS = 2 * 3600 * 1000;
export const PREVIEW_COOKIE = 'braand_preview';

/** @param {{sandbox:string,port:number,expiresAt?:number}} p @param {string} secret */
export async function signPreview(p, secret) {
  if (!secret || secret.length < 32) throw new Error('preview_secret_missing');
  if (!/^[a-f0-9]{40}$/.test(p.sandbox) || !Number.isInteger(p.port) || p.port < 1024 || p.port > 65535) throw new Error('preview_input_invalid');
  const payload = b64url(enc.encode(JSON.stringify({s: p.sandbox, p: p.port, e: p.expiresAt ?? Date.now() + PREVIEW_TTL_MS})));
  const signature = b64url(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)));
  return payload + '.' + signature;
}

/** @returns {Promise<{sandbox:string,port:number,expiresAt:number}|null>} */
export async function verifyPreview(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret || token.length > 512) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  let ok = false;
  try {ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(signature), enc.encode(payload));} catch {return null;}
  if (!ok) return null;
  let data;try {data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));} catch {return null;}
  if (!/^[a-f0-9]{40}$/.test(data?.s) || !Number.isInteger(data?.p) || !Number.isFinite(data?.e) || data.e < now) return null;
  return {sandbox: data.s, port: data.p, expiresAt: data.e};
}

/** The preview token carried by the request cookie, if any. */
export function previewCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + PREVIEW_COOKIE + '=([^;]+)'));
  return match ? match[1] : null;
}
