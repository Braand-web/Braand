// Proactive watch rules, pure and testable. A signal is raised only on a
// real change with enough volume, so the owner is not disturbed by noise.

export const WATCH_RULES = {
  dropRatio: 0.6,        // last 3 days at or below 60 % of the usual level
  minBaseline: 30,       // usual level of at least 30 visits over 3 days
  recoverRatio: 0.8,     // back to 80 % of the usual level = recovered
  leadsBefore: 3,        // at least 3 contact requests in the 14 days before
  leadsViewsKept: 0.7,   // visits roughly kept (so the form is the suspect)
};

const sum = (list, key) => list.reduce((a, d) => a + (Number(d[key]) || 0), 0);

/**
 * @param {{day:string,views:number,leads:number}[]} days  17 complete days, oldest first
 * @returns {{type:'site_traffic_drop'|'site_leads_stopped',facts:Record<string,number>}[]}
 */
export function siteSignals(days) {
  if (days.length < 17) return [];
  const baselineDays = days.slice(0, 14), recent = days.slice(14);
  const usual3 = sum(baselineDays, 'views') / 14 * 3, last3 = sum(recent, 'views');
  const signals = [];
  if (usual3 >= WATCH_RULES.minBaseline && last3 <= usual3 * WATCH_RULES.dropRatio) {
    signals.push({type: 'site_traffic_drop', facts: {usualViews3d: Math.round(usual3), lastViews3d: last3, changePercent: Math.round((last3 / usual3 - 1) * 100)}});
  }
  const last7 = days.slice(10), before = days.slice(0, 10);
  const leadsBefore = sum(before, 'leads'), leadsLast7 = sum(last7, 'leads');
  const viewsLast7 = sum(last7, 'views'), viewsUsual7 = sum(before, 'views') / 10 * 7;
  if (leadsBefore >= WATCH_RULES.leadsBefore && leadsLast7 === 0 && viewsUsual7 > 0 && viewsLast7 >= viewsUsual7 * WATCH_RULES.leadsViewsKept) {
    signals.push({type: 'site_leads_stopped', facts: {leadsBefore10d: leadsBefore, leadsLast7d: 0, viewsLast7d: viewsLast7, usualViews7d: Math.round(viewsUsual7)}});
  }
  return signals;
}

/** Whether an open traffic-drop signal has recovered on the last 3 complete days. */
export function recovered(type, facts, last3Views, last7Leads) {
  if (type === 'site_traffic_drop') return last3Views >= (Number(facts.usualViews3d) || 0) * WATCH_RULES.recoverRatio;
  if (type === 'site_leads_stopped') return last7Leads > 0;
  return false;
}

export function signalTitle(type, slug, facts) {
  if (type === 'site_traffic_drop') return `Les visites de « ${slug} » ont baissé de ${Math.abs(facts.changePercent)} % sur les 3 derniers jours`;
  return `« ${slug} » ne reçoit plus de demandes de contact depuis 7 jours, alors que les visites continuent`;
}
