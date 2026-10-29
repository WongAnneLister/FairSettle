import { formatMinor } from './core.mjs';

export const PROPOSAL_ID = /^prop_[0-9A-HJKMNP-TV-Z]{26}$/;
export const OPS_CREDENTIAL = /^ops_[0-9a-f-]+\.[A-Za-z0-9_-]+$/i;

export function proposalListPath(status = 'PENDING_REVIEW') {
  if (!['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) throw new Error('Unknown proposal status');
  return `/ops/refund-proposals?status=${status}&limit=50`;
}
export function decisionPath(id) {
  if (!PROPOSAL_ID.test(id)) throw new Error('Invalid proposal id');
  return `/ops/refund-proposals/${id}/decision`;
}
export function decisionBody(action, reason = '') {
  if (action === 'APPROVE') return { action: 'APPROVE' };
  if (action !== 'REJECT') throw new Error('Unknown decision');
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 500) throw new Error('A rejection needs a reason of 1 to 500 characters');
  return { action: 'REJECT', reason: trimmed };
}
export function canReview(identity, proposal) {
  return identity?.role === 'OPS_REVIEWER' && proposal?.status === 'PENDING_REVIEW';
}
export function proposalView(p) {
  return {
    id: p.id, complaintId: p.complaintId, orderRef: p.orderRef, paymentId: p.paymentId,
    status: p.status, decision: p.decision, reasonCode: p.reasonCode,
    amount: p.currency === 'USD' ? formatMinor(p.amountMinor, p.currency, 2) : `${p.amountMinor} ${p.currency} (minor units)`,
    liability: p.liability.map(l => ({ party: l.party, basisPoints: l.basisPoints, percent: (l.basisPoints / 100).toFixed(2) + '%' })),
    explanation: p.explanation, evidenceRefs: p.evidenceRefs, traceId: p.agentRun?.traceId ?? null, createdAt: p.createdAt
  };
}
export function createProposalReview({ api, intent, render, notice }) {
  async function identify() {
    if (!OPS_CREDENTIAL.test(api.credential)) { notice('Enter an ops_… credential.'); return; }
    try {
      await api.latest('identity', '/ops/identity', data => { api.identity = data; });
      const role = api.identity?.role;
      notice('Signed in as ' + role + (role === 'OPS_REVIEWER' ? '. You can approve or reject.' : '. You can only view proposals.'));
      await load();
    } catch (error) { notice('Sign-in failed: ' + (error.data?.code ?? error.name)); }
  }
  async function load(status = 'PENDING_REVIEW') {
    try {
      await api.latest('proposals', proposalListPath(status), data => render(data.items.map(proposalView), {
        canReview: view => canReview(api.identity, view), pending: intent.pending?.context ?? null
      }));
    } catch (error) { notice('Could not load proposals: ' + (error.data?.code ?? error.name)); }
  }
  async function send(id, action) {
    try {
      const response = await intent.send();
      notice(action === 'APPROVE' ? `Proposal ${id} approved; refund ${response.data.refundId}.` : `Proposal ${id} rejected.`);
      await load();
      return response.data;
    } catch (error) {
      notice(`Decision for ${id} is not confirmed (${error.data?.code ?? error.name}). Retry sends the same request with the same key.`);
      return null;
    }
  }
  async function decide(id, action, reason = '') {
    const pendingId = intent.pending?.context?.proposalId;
    if (pendingId && pendingId !== id) {
      notice(`Retry or finish the pending decision for ${pendingId} first.`); return null;
    }
    let body;
    try { body = decisionBody(action, reason); }
    catch (error) { notice(error.message); return null; }
    try { intent.prepare(decisionPath(id), JSON.stringify(body), { proposalId: id, action }); }
    catch (error) {
      notice(`Decision for ${id} is not confirmed (${error.data?.code ?? error.name}). Retry sends the same request with the same key.`);
      return null;
    }
    return send(id, action);
  }
  async function retry() {
    if (!intent.pending) { notice('No decision is waiting for a retry.'); return null; }
    const { proposalId, action } = intent.pending.context;
    return send(proposalId, action);
  }
  return { identify, load, decide, retry };
}
