/** Pure routing and validation helpers shared by Node tests and the Edge runtime. */
export const readRoutes = new Set(['metrics', 'jobs', 'people', 'applications', 'knowledge', 'outreach', 'conversations', 'operations','sources','eligibility-queue','source-candidates']);
export const statuses = new Set(['discovered', 'saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && uuid.test(value);
export function route(url, method) {
  const p = new URL(url).pathname;
  const marker = '/api/ci/';
  const at = p.indexOf(marker);
  if (at === -1) return null;
  const path = p.slice(at + marker.length);
  if (method === 'GET' && readRoutes.has(path)) return {type:'read',path};
  if (method === 'GET' && /^jobs\/[0-9a-f-]{36}\/evidence$/i.test(path) && isUuid(path.split('/')[1])) return {type:'evidence',jobId:path.split('/')[1]};
  if (method === 'GET' && /^batches\/\d{4}-\d{2}-\d{2}$/.test(path)) return {type:'batch',day:path.slice(8)};
  if (method === 'POST' && path === 'sources') return {type:'registerSource'};
  if (method === 'POST' && path === 'source-candidates/decision') return {type:'decideCandidate'};
  if (method === 'POST' && path === 'sources/scan') return {type:'scanSource'};
  if (method === 'POST' && path === 'eligibility/review') return {type:'reviewEligibility'};
  if (method === 'POST' && path === 'discover') return {type:'discover'};
  if (method === 'POST' && path === 'batches/generate') return {type:'generateBatch'};
  if (method === 'POST' && path === 'applications') return {type:'application'};
  if (method === 'POST' && path === 'outreach/drafts') return {type:'draft'};
  if (method === 'POST' && path === 'outreach/approve') return {type:'approveOutreach'};
  if (method === 'POST' && path === 'outreach/intents') return {type:'prepareOutreachIntent'};
  if (method === 'POST' && path === 'outreach/revoke') return {type:'revokeOutreach'};
  if (method === 'POST' && path === 'conversations') return {type:'conversation'};
  return null;
}
export function validApplication(input) {
  return !!input && isUuid(input.job_id) && statuses.has(input.status) &&
    (input.notes === undefined || (typeof input.notes === 'string' && input.notes.length <= 1000));
}
export function validDraft(input) {
  return !!input && isUuid(input.job_id) && isUuid(input.contact_id);
}
export function validReply(input) {
  return validDraft(input) && typeof input.body === 'string' && input.body.trim().length > 0 &&
    input.body.length <= 4000 && typeof input.source_url === 'string' && input.source_url.length <= 1000 &&
    /^https:\/\//.test(input.source_url);
}
export function classifyReply(text) {
  const t = text.toLowerCase();
  if (/unsubscribe|do not contact|remove me from|stop emailing/.test(t)) return 'opt_out';
  if (/unfortunately|cannot proceed|not moving forward|not selected|regret to inform/.test(t)) return 'rejected';
  if (/interview|schedule a call|speak with you|next round/.test(t)) return 'interview';
  if (/referr?al|refer you|referred you/.test(t)) return 'referral';
  return 'reply';
}
export const roleRestricted = (text) => /us.only|united states only|must be based in|must reside in|not hire outside|not able to hire/.test(text.toLowerCase());
