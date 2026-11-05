// One reading of a browser session, shared by the chat card and the live panel,
// so they can never contradict each other ("Terminée" here, "Reconnexion…"
// there, or a takeover button on a closed session).

const TERMINAL = new Set(['completed', 'uncertain', 'failed', 'cancelled', 'expired']);
export const isTerminal = status => TERMINAL.has(status);

const PHASES = {
  draft: {phase: 'draft', label: 'Brouillon', tone: 'muted'},
  queued: {phase: 'preparing', label: 'Préparation du navigateur', tone: 'progress'},
  running: {phase: 'running', label: 'En cours', tone: 'progress'},
  awaiting_approval: {phase: 'needs_you', label: 'Votre accord est requis', tone: 'attention'},
  awaiting_login: {phase: 'needs_you', label: 'Votre intervention est requise', tone: 'attention'},
  paused: {phase: 'paused', label: 'En pause', tone: 'muted'},
  completed: {phase: 'done', label: 'Terminée', tone: 'success'},
  uncertain: {phase: 'review', label: 'Résultat à vérifier', tone: 'attention'},
  failed: {phase: 'failed', label: 'Interrompue', tone: 'danger'},
  cancelled: {phase: 'stopped', label: 'Arrêtée', tone: 'muted'},
  expired: {phase: 'stopped', label: 'Expirée', tone: 'muted'},
};

/** @param {{status:string,control:'agent'|'human',executionSource?:string}} session */
export function sessionState(session) {
  const base = PHASES[session?.status] || {phase: 'unknown', label: 'État inconnu', tone: 'muted'};
  const terminal = isTerminal(session?.status), draft = session?.status === 'draft';
  const human = session?.control === 'human' && !terminal;
  const active = !terminal && !draft;
  return {
    ...base,
    ...(human ? {phase: 'human', label: 'Vous avez la main', tone: 'attention'} : {}),
    terminal, active,
    // The live picture exists only while a browser really runs.
    live: active && session.status !== 'queued',
    canStop: active,
    canTakeControl: active && !human && session.executionSource !== 'background' && ['awaiting_login', 'paused'].includes(session.status),
    canGiveBack: human,
  };
}

const domain = url => {try {return new URL(url).hostname.replace(/^www\./, '');} catch {return '';}};
const clip = (text, max) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text);

/** What the agent is doing right now, in the user's words. */
export function currentStep(session) {
  if (session?.pendingAction?.description) return 'À valider : ' + clip(session.pendingAction.description, 120);
  if (session?.control === 'human' && !isTerminal(session.status)) return 'Braand attend que vous rendiez la main.';
  if (session?.resultReview?.summary) return clip(session.resultReview.summary, 140);
  if (session?.status === 'failed' && session.lastError) return clip(session.lastError, 140);
  const title = (session?.observation?.title || session?.title || '').trim();
  const where = title || domain(session?.observation?.url || session?.url || '');
  if (!where) return session?.status === 'queued' ? 'Ouverture du navigateur…' : '';
  return (isTerminal(session.status) ? 'Dernière page : ' : 'Sur ') + '« ' + clip(where, 90) + ' »';
}

/** Tabs named by their page title (domain as fallback), never two identical labels. */
export function tabLabels(tabs) {
  const seen = new Map();
  return (tabs || []).map(tab => {
    const name = clip((tab.title || '').trim() || domain(tab.url) || 'Nouvel onglet', 32);
    const count = (seen.get(name) || 0) + 1; seen.set(name, count);
    return {id: tab.id, url: tab.url, domain: domain(tab.url), label: count > 1 ? `${name} (${count})` : name};
  });
}
