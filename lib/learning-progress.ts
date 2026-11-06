// How Braand is learning this workspace's way of working: corrections the
// user had to make per answers over the weeks (fewer = Braand has learned),
// the rules and methods it took from them. Figures come from what is really
// stored (answers, corrections quoted from the user, method changes).
import {db} from './server';

const WEEK = 7 * 86400000;
type Row = {created_at: number; data: string; title?: string};

export async function learningProgress(tenant: string, weeks = 8, now = Date.now()) {
 const since = now - weeks * WEEK;
 const [runs, learned, skills] = await Promise.all([
  db().prepare("SELECT created_at FROM runs WHERE workspace_id=? AND status IN ('completed','partial') AND created_at>=?").bind(tenant, since).all<{created_at: number}>(),
  db().prepare("SELECT created_at,data,title FROM resources WHERE workspace_id=? AND kind='knowledge' AND status='saved' AND json_extract(data,'$.learning.kind') IN ('correction','preference') AND created_at>=?").bind(tenant, since).all<Row>(),
  db().prepare("SELECT title,data,created_at FROM resources WHERE workspace_id=? AND kind='skill' AND status!='deleted'").bind(tenant).all<Row>(),
 ]);
 const bucket = (at: number) => Math.min(weeks - 1, Math.floor((now - at) / WEEK));
 const series = Array.from({length: weeks}, (_, i) => ({weekStart: now - (weeks - i) * WEEK, answers: 0, corrections: 0, preferences: 0, methodChanges: 0}));
 const at = (i: number) => series[weeks - 1 - i];
 for (const run of runs.results) at(bucket(run.created_at)).answers++;
 const quotes: {kind: string; text: string; at: number}[] = [];
 for (const row of learned.results) {let data: {content?: string; learning?: {kind?: string}};try {data = JSON.parse(row.data);} catch {continue;}
  const kind = data.learning?.kind === 'correction' ? 'correction' : 'preference';at(bucket(row.created_at))[kind === 'correction' ? 'corrections' : 'preferences']++;
  quotes.push({kind, text: String(data.content || '').slice(0, 240), at: row.created_at});}
 const changes: {method: string; reason: string; by: string; at: number}[] = [];
 for (const skill of skills.results) {let data: {changeLog?: {at: number; by: string; reason?: string}[]};try {data = JSON.parse(skill.data);} catch {continue;}
  for (const entry of data.changeLog || []) if (entry.at >= since && entry.reason && !/^Création|créée/i.test(entry.reason)) {at(bucket(entry.at)).methodChanges++;changes.push({method: String(skill.title || ''), reason: entry.reason.slice(0, 240), by: entry.by, at: entry.at});}}
 const rate = (list: typeof series) => {const answers = list.reduce((a, w) => a + w.answers, 0), corrections = list.reduce((a, w) => a + w.corrections, 0);return answers ? Math.round(corrections / answers * 100) / 10 : null;};
 const half = Math.floor(weeks / 2), before = rate(series.slice(0, half)), after = rate(series.slice(half));
 const totalAnswers = series.reduce((a, w) => a + w.answers, 0);
 return {
  weeks, series: series.map(w => ({...w, correctionsPer10: w.answers ? Math.round(w.corrections / w.answers * 100) / 10 : null})),
  correctionsPer10: {before, after, trend: before === null || after === null ? 'insufficient' : after < before ? 'improving' : after > before ? 'worse' : 'stable'},
  totals: {answers: totalAnswers, corrections: series.reduce((a, w) => a + w.corrections, 0), preferences: series.reduce((a, w) => a + w.preferences, 0), methodChanges: changes.length},
  recentLessons: quotes.sort((a, b) => b.at - a.at).slice(0, 6),
  recentMethodChanges: changes.sort((a, b) => b.at - a.at).slice(0, 6),
  note: totalAnswers < 20 ? 'Encore peu de réponses sur la période : la tendance se lira mieux après quelques semaines d’utilisation.' : 'Corrections pour 10 réponses : moins il y en a, plus Braand a appris votre façon de faire.',
 };
}
