// Backup exchange reference for when the BEAC page cannot be reached.
// The franc CFA (XAF) is fixed to the euro by treaty: 1 EUR = 655.957 XAF.
// The European Central Bank publishes the daily EUR/USD reference, so
// USD/XAF = 655.957 / (USD per EUR). BEAC's sell rate sits about 0.43 % above
// the mid rate; the backup adds 0.5 % so it is never cheaper than BEAC's sell.
export const ECB_REFERENCE_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const XAF_PER_EUR = 655.957;
export const FALLBACK_MARGIN = 1.005;

export function parseEcbReference(xml, now = Date.now()) {
 const text = String(xml || '');
 const days = [...text.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g)];
 const usd = [...text.matchAll(/<Cube\s+currency=['"]USD['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/g)];
 if (days.length !== 1 || usd.length !== 1) throw new Error('fx_reference_invalid');
 const valueDate = days[0][1], timestamp = Date.parse(valueDate + 'T00:00:00Z'), age = now - timestamp, perEur = Number(usd[0][1]);
 if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000 || new Date(timestamp).toISOString().slice(0, 10) !== valueDate || !Number.isFinite(perEur) || perEur < 0.5 || perEur > 2.5) throw new Error('fx_reference_invalid');
 const usdXaf = Math.round(XAF_PER_EUR / perEur * FALLBACK_MARGIN * 10000) / 10000;
 return {usdXaf, fxSource: ECB_REFERENCE_URL, fxValueDate: valueDate, conversionBasis: 'ecb_eur_peg_reference'};
}

/** A verified USD/XAF reference: BEAC first, the ECB euro-peg backup if BEAC is unreachable or unreadable. */
export const FX_SOURCES = ['https://www.beac.int/', ECB_REFERENCE_URL];
export async function fxReference(read, parseBeac, now = Date.now()) {
 try {return parseBeac(await read(FX_SOURCES[0]), now);}
 catch (first) {
  try {return parseEcbReference(await read(ECB_REFERENCE_URL), now);}
  catch {throw first;}
 }
}
