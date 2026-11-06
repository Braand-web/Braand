// "Et si… ?" simulations for a small business, computed from real figures
// only: the client's own numbers, Braand's measured site traffic and leads,
// or a clearly labelled hypothesis. Never an invented elasticity or result.
// Every projection is a range with its confidence and what it is based on;
// when the data is too thin, the answer is a small real test to learn it.

const round = (value, digits = 0) => { const f = 10 ** digits; return Math.round(value * f) / f; };

/** Wilson interval (95 %) for a conversion rate measured on n trials. */
export function wilson(successes, trials, z = 1.96) {
  if (!trials) return {low: 0, mid: 0, high: 0};
  const p = successes / trials, d = 1 + z * z / trials;
  const centre = (p + z * z / (2 * trials)) / d, margin = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / d;
  return {low: Math.max(0, centre - margin), mid: p, high: Math.min(1, centre + margin)};
}

function confidenceFor(sample) { return sample >= 300 ? 'élevée' : sample >= 80 ? 'moyenne' : 'faible'; }

/**
 * Advertising budget: results = spend ÷ cost per result. The cost per result
 * comes from the client (a past campaign) — never assumed. ±35 % range for
 * an estimate from memory, ±20 % from a measured campaign.
 * @param {{dailyBudget:number,days:number,costPerResult?:number,costSource?:'measured'|'estimate',resultLabel?:string,closeRate?:number,averageSale?:number}} p
 */
export function simulateAdBudget(p) {
  const spend = p.dailyBudget * p.days;
  if (!(p.costPerResult > 0)) {
    const testDays = 3, testBudget = Math.max(1000, Math.round(p.dailyBudget / 2 / 500) * 500);
    return {status: 'needs_data', scenario: 'ad_budget', spend,
      missing: ['Le coût par résultat (par message, clic ou vente) d’une campagne précédente.'],
      testPlan: `Lancez un test de ${testDays} jours à ${testBudget} FCFA par jour (${testDays * testBudget} FCFA) : Braand mesurera le coût par résultat réel, puis refera cette simulation avec ce chiffre.`,
      explanation: 'Sans coût par résultat mesuré, toute prévision serait inventée.'};
  }
  const spread = p.costSource === 'measured' ? 0.2 : 0.35, label = p.resultLabel || 'résultats';
  const results = {low: spend / (p.costPerResult * (1 + spread)), mid: spend / p.costPerResult, high: spend / (p.costPerResult * (1 - spread))};
  const out = {status: 'ok', scenario: 'ad_budget', spend,
    projection: {unit: label, low: Math.floor(results.low), mid: Math.round(results.mid), high: Math.ceil(results.high)},
    assumptions: [
      {label: 'Budget total', value: `${spend} FCFA (${p.dailyBudget} × ${p.days} jours)`, source: 'donné par vous'},
      {label: 'Coût par ' + label.replace(/s$/, ''), value: `${p.costPerResult} FCFA`, source: p.costSource === 'measured' ? 'campagne mesurée' : 'estimation donnée par vous'},
      {label: 'Écart retenu', value: `± ${spread * 100} %`, source: 'hypothèse de prudence'},
    ],
    confidence: p.costSource === 'measured' ? 'moyenne' : 'faible',
    explanation: 'Le coût par résultat varie avec la saison, le visuel et l’audience ; la fourchette couvre cet écart habituel.'};
  if (p.closeRate > 0 && p.closeRate <= 1) {
    out.sales = {low: Math.floor(results.low * p.closeRate), mid: Math.round(results.mid * p.closeRate), high: Math.ceil(results.high * p.closeRate)};
    out.assumptions.push({label: 'Taux de conclusion', value: `${round(p.closeRate * 100, 1)} %`, source: 'donné par vous'});
    if (p.averageSale > 0) {
      out.revenue = {low: Math.round(out.sales.low * p.averageSale), mid: Math.round(out.sales.mid * p.averageSale), high: Math.round(out.sales.high * p.averageSale)};
      out.return = {low: round(out.revenue.low / spend, 2), mid: round(out.revenue.mid / spend, 2), high: round(out.revenue.high / spend, 2)};
      out.assumptions.push({label: 'Panier moyen', value: `${p.averageSale} FCFA`, source: 'donné par vous'});
    }
  }
  return out;
}

/**
 * Price change: exact arithmetic, no guessed elasticity. How many units are
 * needed at the new price to keep the same gross profit, and the volume change
 * that represents.
 * @param {{currentPrice:number,newPrice:number,monthlyUnits:number,unitCost?:number}} p
 */
export function simulatePriceChange(p) {
  const cost = p.unitCost > 0 ? p.unitCost : 0;
  const marginNow = p.currentPrice - cost, marginNew = p.newPrice - cost;
  if (marginNew <= 0) return {status: 'blocked', scenario: 'price_change', explanation: `À ${p.newPrice} FCFA, chaque vente est à perte (coût unitaire ${cost} FCFA).`};
  const profitNow = marginNow * p.monthlyUnits, unitsNeeded = Math.ceil(profitNow / marginNew);
  const change = round((unitsNeeded / p.monthlyUnits - 1) * 100, 1);
  return {status: 'ok', scenario: 'price_change',
    breakEven: {unitsNeeded, volumeChangePercent: change},
    sameVolume: {revenueNow: p.currentPrice * p.monthlyUnits, revenueNew: p.newPrice * p.monthlyUnits, profitNow, profitNew: marginNew * p.monthlyUnits},
    assumptions: [
      {label: 'Prix actuel → nouveau', value: `${p.currentPrice} → ${p.newPrice} FCFA`, source: 'donné par vous'},
      {label: 'Ventes actuelles', value: `${p.monthlyUnits} par mois`, source: 'donné par vous'},
      {label: 'Coût unitaire', value: cost ? `${cost} FCFA` : 'non indiqué (marge = prix)', source: cost ? 'donné par vous' : 'à préciser'},
    ],
    confidence: 'exacte (calcul)',
    explanation: change >= 0
      ? `Pour gagner autant qu’aujourd’hui, il faut vendre ${unitsNeeded} unités par mois, soit ${change} % de plus. Braand ne peut pas prédire si vos clients suivront : testez le nouveau prix sur une partie de vos ventes.`
      : `Vous gagnez autant en vendant ${unitsNeeded} unités par mois, soit ${Math.abs(change)} % de moins. Le risque est de perdre plus de ${Math.abs(change)} % de vos ventes : testez avant de généraliser.`,
    testPlan: 'Proposez le nouveau prix pendant 2 semaines (ou à la moitié de vos clients) et comparez le nombre de ventes.'};
}

/**
 * More visits on a published site: extra leads = extra visits × the site's
 * own conversion (contact requests ÷ visitors), measured by Braand.
 * @param {{extraVisits:number,visitors:number,leads:number,days:number,slug:string}} p
 */
export function simulateMoreVisits(p) {
  if (p.visitors < 50) return {status: 'needs_data', scenario: 'more_visits', explanation: `Le site « ${p.slug} » n’a que ${p.visitors} visiteurs mesurés sur ${p.days} jours : trop peu pour connaître son taux de contact.`, testPlan: 'Attendez au moins 50 visiteurs (ou faites une petite publicité vers le site), puis relancez la simulation.'};
  const rate = wilson(p.leads, p.visitors);
  return {status: 'ok', scenario: 'more_visits',
    projection: {unit: 'demandes de contact', low: Math.floor(p.extraVisits * rate.low), mid: Math.round(p.extraVisits * rate.mid), high: Math.ceil(p.extraVisits * rate.high)},
    assumptions: [
      {label: 'Visiteurs en plus', value: String(p.extraVisits), source: 'donné par vous'},
      {label: 'Taux de contact du site', value: `${round(rate.mid * 100, 2)} % (${p.leads} demandes pour ${p.visitors} visiteurs en ${p.days} jours)`, source: 'mesuré par Braand'},
    ],
    confidence: confidenceFor(p.visitors),
    explanation: 'Les nouveaux visiteurs se comportent rarement exactement comme les anciens : la fourchette couvre l’incertitude de la mesure.'};
}
