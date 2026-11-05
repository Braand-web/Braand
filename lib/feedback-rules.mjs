// Suggestions board: pure business rules (no I/O), shared by the server and tests.
import {FEEDBACK_STATUSES, FEEDBACK_TYPES} from './feedback-schema.mjs';

export const PRODUCT_NAME = 'Braand';
export const FEEDBACK_LIMITS = Object.freeze({
  posts: {max: 5, periodMs: 86_400_000, message: 'Vous avez publié 5 suggestions aujourd’hui. Revenez demain, ou votez pour celles qui existent déjà.'},
  comments: {max: 30, periodMs: 86_400_000, message: 'Vous avez écrit 30 réponses aujourd’hui. Revenez demain pour continuer la discussion.'},
  votes: {max: 60, periodMs: 60_000, message: 'Trop de votes en une minute. Patientez un instant.'},
  reports: {max: 20, periodMs: 3_600_000, message: 'Trop de signalements en une heure. Réessayez plus tard.'},
});
export const OPEN_STATUSES = Object.freeze(['new', 'under_review', 'planned', 'in_progress']);
export const STATUS_LABELS = Object.freeze({new: 'Nouveau', under_review: 'À l’étude', planned: 'Prévu', in_progress: 'En cours', done: 'Livré', declined: 'Refusé', duplicate: 'Doublon'});
export const BUG_PROMPT = 'Décrivez ce que vous faisiez, ce qui s’est passé et ce que vous attendiez.';

export class FeedbackRuleError extends Error {constructor(message, field) {super(message); this.name = 'FeedbackRuleError'; this.field = field;}}

// Control characters except \n and \t, and bidirectional marks that could disguise a link.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
/** Plain text only: it is always rendered escaped, never as HTML. */
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(BIDI, '')
    .split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Validates and normalises a new suggestion. Throws FeedbackRuleError with a field. */
export function validatePost(input) {
  const type = input?.type;
  if (!FEEDBACK_TYPES.includes(type)) throw new FeedbackRuleError('Choisissez « Fonctionnalité » ou « Bug ».', 'type');
  const title = cleanText(input.title).replace(/\s+/g, ' ');
  const body = cleanText(input.body);
  if (title.length < 8) throw new FeedbackRuleError('Le titre doit faire au moins 8 caractères.', 'title');
  if (title.length > 120) throw new FeedbackRuleError('Le titre doit faire au plus 120 caractères.', 'title');
  if (body.length > 5000) throw new FeedbackRuleError('La description doit faire au plus 5 000 caractères.', 'body');
  if (type === 'bug' && body.length < 10) throw new FeedbackRuleError(BUG_PROMPT, 'body');
  if (input.security && type !== 'bug') throw new FeedbackRuleError('Seul un bug peut être signalé comme problème de sécurité.', 'security');
  return {type, title, body, private: type === 'bug' && input.security === true};
}

export function validateComment(value) {
  const body = cleanText(value);
  if (!body) throw new FeedbackRuleError('Écrivez votre réponse.', 'body');
  if (body.length > 3000) throw new FeedbackRuleError('La réponse doit faire au plus 3 000 caractères.', 'body');
  return body;
}

export function validateReason(value) {
  const reason = cleanText(value).replace(/\s+/g, ' ');
  if (reason.length > 300) throw new FeedbackRuleError('La raison doit faire au plus 300 caractères.', 'reason');
  return reason;
}

const NAME_CHARS = /[^\p{L}'’-]/gu;
const word = value => String(value || '').replace(NAME_CHARS, '').replace(/^['’-]+|['’-]+$/g, '');
/** « Marie D. » — never an e-mail address; « Membre Braand » when unknown. */
export function publicName(fullName, product = PRODUCT_NAME) {
  const raw = typeof fullName === 'string' && !fullName.includes('@') ? fullName.trim() : '';
  const parts = raw.split(/\s+/).map(word).filter(Boolean);
  if (!parts.length) return `Membre ${product}`;
  const first = parts[0].slice(0, 30), first2 = first.charAt(0).toLocaleUpperCase('fr') + first.slice(1);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last ? `${first2} ${last.charAt(0).toLocaleUpperCase('fr')}.` : first2;
}

const HOUR = 3_600_000;
/** Trending weight: activity divided by age and by inactivity. */
export function trendingScore(post, now = Date.now()) {
  const ageHours = Math.max(0, (now - post.created_at) / HOUR);
  const idleHours = Math.max(0, (now - (post.last_activity_at || post.created_at)) / HOUR);
  const weight = 1 + (post.vote_count || 0) + 0.5 * (post.comment_count || 0);
  return weight / Math.pow(ageHours + 2, 0.9) / Math.pow(1 + idleHours / 72, 0.5);
}
export const SORTS = Object.freeze(['trending', 'top', 'discussed', 'recent']);
const open = post => (OPEN_STATUSES.includes(post.status) ? 0 : 1);
/** Pinned first, then (for trending) open before shipped/declined/duplicate, then the chosen order. */
export function sortPosts(posts, sort = 'trending', now = Date.now()) {
  const key = SORTS.includes(sort) ? sort : 'trending';
  const score = post => key === 'top' ? post.vote_count : key === 'discussed' ? post.comment_count : key === 'recent' ? post.created_at : trendingScore(post, now);
  return [...posts].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    || (key === 'trending' ? open(a) - open(b) : 0)
    || score(b) - score(a) || b.created_at - a.created_at || String(a.id).localeCompare(String(b.id)));
}

// Similar titles while typing: normalised tokens without accents, stop words or plurals.
const STOP = new Set('le la les l un une des du de d et ou a au aux en dans sur pour par avec sans ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je tu il elle on nous vous ils elles qui que quoi dont est sont etre avoir plus pas ne n y se s c qu the a an of to and or in on for with is are be it this that can could would should please'.split(' '));
export function tokens(text) {
  return [...new Set(cleanText(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean)
    .map(t => (t.length > 3 && /[sx]$/.test(t) ? t.slice(0, -1) : t))
    .filter(t => t.length > 1 && !STOP.has(t)))];
}
export const SIMILAR_THRESHOLD = 0.34;
export function similarity(a, b) {
  const left = tokens(a), right = new Set(tokens(b));
  if (!left.length || !right.size) return 0;
  const common = left.filter(t => right.has(t)).length;
  return common / Math.max(left.length, right.size, 2);
}
export function similarPosts(title, posts, limit = 5) {
  return posts.filter(post => post.status !== 'duplicate')
    .map(post => ({post, score: similarity(title, post.title)}))
    .filter(row => row.score >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.score - a.score || (b.post.vote_count || 0) - (a.post.vote_count || 0))
    .slice(0, limit).map(row => row.post);
}

/** Hidden: team only. Private: its author and the team. */
export function canSee(post, viewer) {
  if (viewer?.team) return true;
  if (post.hidden_at) return false;
  if (post.private) return !!viewer?.userId && post.author_id === viewer.userId;
  return true;
}
/** What a member may receive: never the author's id or moderation data. */
export function toPublicPost(post, viewer, extra = {}) {
  const base = {
    id: post.id, type: post.type, title: post.title, body: post.body, status: post.status, statusLabel: STATUS_LABELS[post.status],
    private: !!post.private, duplicateOf: post.duplicate_of || null, hasAttachment: !!post.attachment_path,
    voteCount: post.vote_count, commentCount: post.comment_count, pinned: !!post.pinned, authorName: post.author_name,
    mine: !!viewer?.userId && post.author_id === viewer.userId, createdAt: post.created_at, statusChangedAt: post.status_changed_at || null,
    lastActivityAt: post.last_activity_at, ...extra,
  };
  if (!viewer?.team) return base;
  return {...base, authorId: post.author_id || null, paidVoteCount: post.paid_vote_count, reportCount: post.report_count, hiddenAt: post.hidden_at || null};
}
export function toPublicComment(comment, viewer) {
  const base = {id: comment.id, body: comment.body, authorName: comment.author_name, isTeam: !!comment.is_team, pinned: !!comment.pinned, mine: !!viewer?.userId && comment.author_id === viewer.userId, createdAt: comment.created_at};
  return viewer?.team ? {...base, authorId: comment.author_id || null, hiddenAt: comment.hidden_at || null} : base;
}
export function isStatus(value) {return FEEDBACK_STATUSES.includes(value);}
