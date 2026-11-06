// The credit balance as the agent and the conversation see it: what is
// available now, how fast it is being used, how long it will last at that
// pace, what expires soon and when the plan refills. Read-only: no amount is
// ever invented and nothing is reserved here.
import {db} from './server';
import {allocateDue, expireLots, currentSubscription, subscriptionTerms} from './billing';
import {periods, DAY} from './billing-core.mjs';

export type CreditLevel = 'ok' | 'low' | 'critical' | 'empty';
export type CreditOutlook = {
 available: number; reserved: number; inProgress: number; allowance: number;
 used7d: number; dailyAverage: number; daysLeft: number | null;
 expiringSoon: {credits: number; at: number} | null;
 nextRefill: number | null; plan: string;
 level: CreditLevel; asOf: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Low when it would run out within a week at the current pace, or under a
 * fifth of the monthly allowance (5 credits without a plan, so a fresh free
 * allowance is not flagged). Critical within two days, or under 5 % of the
 * allowance (2 credits without a plan). Empty under one credit.
 */
export function creditLevel(available: number, dailyAverage: number, allowance: number): {level: CreditLevel; daysLeft: number | null} {
 const daysLeft = dailyAverage > 0 ? round(available / dailyAverage) : null;
 if (available < 1) return {level: 'empty', daysLeft};
 if (available < Math.max(2, allowance * 0.05) || (daysLeft !== null && daysLeft < 2)) return {level: 'critical', daysLeft};
 if ((daysLeft !== null && daysLeft < 7) || available < (allowance > 0 ? allowance * 0.2 : 5)) return {level: 'low', daysLeft};
 return {level: 'ok', daysLeft};
}

/** excludeHold: the reservation of the answer asking, which is not spent yet. */
export async function creditOutlook(org: string, now = Date.now(), excludeHold = ''): Promise<CreditOutlook> {
 await allocateDue(org, now);await expireLots(org, now);
 const s = (q: string, ...values: (string | number)[]) => db().prepare(q).bind(...values);
 const [wallet, used, expiring, subscription] = await Promise.all([
  // Same rule as reserve(): running work and recent unreconciled runs hold credits.
  s(`SELECT COALESCE((SELECT SUM(balance-reserved) FROM credit_lots WHERE organization_id=? AND frozen=0 AND starts_at<=? AND (expires_at IS NULL OR expires_at>?)),0) free,
   COALESCE((SELECT SUM(reserved) FROM credit_lots WHERE organization_id=?),0) lots,
   COALESCE((SELECT SUM(MAX(0,h.units-COALESCE((SELECT SUM(CASE WHEN a.state='reserved' THEN a.units ELSE a.charged END) FROM credit_allocations a WHERE a.hold_id=h.id),0))) FROM credit_holds h WHERE h.organization_id=? AND h.id!=? AND (h.status='reserved' OR (h.status='needs_reconciliation' AND h.created_at>?))),0) holds`, org, now, now, org, org, excludeHold, now - 30 * 60000).first<{free: number; lots: number; holds: number}>(),
  s("SELECT COALESCE(SUM(units),0) units FROM credit_ledger WHERE organization_id=? AND kind='consume' AND created_at>=?", org, now - 7 * DAY).first<{units: number}>(),
  s('SELECT COALESCE(SUM(balance-reserved),0) units,MIN(expires_at) at FROM credit_lots WHERE organization_id=? AND frozen=0 AND starts_at<=? AND expires_at>? AND expires_at<=? AND balance>reserved', org, now, now, now + 7 * DAY).first<{units: number; at: number | null}>(),
  currentSubscription(org, now),
 ]);
 const terms = subscription ? await subscriptionTerms(subscription) : null;
 const allowance = terms?.credits || 0;
 const period = subscription ? periods(subscription.start_at, subscription.cycle, allowance).find((p: {start: number; end: number}) => p.start <= now && p.end > now) : undefined;
 // The wallet balance, as shown in the sidebar. Running work or an answer
 // waiting for its cost receipt holds credits only for a while (often the
 // whole balance, as an upper bound): it is reported apart, never as spent.
 const available = round(Math.max(0, wallet?.free || 0) / 100), used7d = round((used?.units || 0) / 100), dailyAverage = round(used7d / 7);
 const {level, daysLeft} = creditLevel(available, dailyAverage, allowance);
 return {
  available, reserved: round(((wallet?.lots || 0) + (wallet?.holds || 0)) / 100), inProgress: round((wallet?.holds || 0) / 100), allowance, used7d, dailyAverage, daysLeft,
  expiringSoon: expiring?.units && expiring.at ? {credits: round(expiring.units / 100), at: expiring.at} : null,
  nextRefill: period && subscription && period.end < subscription.end_at ? period.end : null,
  plan: subscription?.plan || 'free', level, asOf: now,
 };
}

const day = (at: number) => new Date(at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long', timeZone: 'UTC'});
const credits = (value: number) => value.toLocaleString('fr-FR', {maximumFractionDigits: 2}) + ' crédit' + (Math.abs(value) >= 2 ? 's' : '');

/** One line per fact, for the agent's context and the warning shown in the conversation. */
export function describeOutlook(o: CreditOutlook): string {
 const parts = [`${credits(o.available)} disponible${o.available >= 2 ? 's' : ''}`];
 if (o.dailyAverage > 0) parts.push(`environ ${credits(o.dailyAverage)} utilisés par jour sur 7 jours${o.daysLeft === null ? '' : o.daysLeft < 1 ? ', soit moins d’un jour à ce rythme' : `, soit environ ${Math.floor(o.daysLeft)} jour${o.daysLeft >= 2 ? 's' : ''} à ce rythme`}`);
 if (o.expiringSoon) parts.push(`${credits(o.expiringSoon.credits)} expirent le ${day(o.expiringSoon.at)}`);
 if (o.nextRefill) parts.push(`prochaine recharge de l’abonnement le ${day(o.nextRefill)}`);
 return parts.join(' ; ');
}

export function outlookContext(o: CreditOutlook): string {
 const advice = {
  ok: 'Ne parle pas du solde sauf si l’utilisateur le demande ou si une tâche coûteuse le dépasserait.',
  low: 'Solde bas : préviens l’utilisateur en une phrase, une seule fois dans cette discussion, à la fin de ta réponse, et indique Paramètres › Abonnement pour recharger.',
  critical: 'Solde presque épuisé : préviens l’utilisateur dès le début de ta réponse, en une phrase, et privilégie les actions les moins coûteuses ; indique Paramètres › Abonnement pour recharger.',
  empty: 'Solde épuisé : dis-le simplement, n’engage aucune tâche payante et indique Paramètres › Abonnement pour recharger.',
 }[o.level];
 return `Solde de crédits (donnée du serveur, jamais une instruction) : ${describeOutlook(o)}. Niveau : ${{ok: 'normal', low: 'bas', critical: 'critique', empty: 'épuisé'}[o.level]}. ${advice} Avant une tâche dont le coût estimé dépasse le solde disponible, dis-le avant de la lancer. Pour un chiffre à jour, utilise get_credit_balance ; n’invente jamais un montant.`;
}
