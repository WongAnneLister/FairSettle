import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiSession, CommandIntent } from '../../src/main/resources/static/ui/core.mjs';
import {
  proposalListPath, decisionPath, decisionBody, proposalView, canReview, createProposalReview
} from '../../src/main/resources/static/ui/proposals.mjs';

const token = 'ops_00000000-0000-0000-0000-000000000062.' + 'a'.repeat(43);
const proposal = {
  id: 'prop_01M63ZP4P0HXQZAVQJCQQKZNY2', complaintId: 'complaint-1', orderRef: 'order-1',
  paymentId: 'pay_01M63ZP4P0HXQZAVQJCQQKZNY2', status: 'PENDING_REVIEW', amountMinor: 450,
  currency: 'USD', decision: 'REFUND', reasonCode: 'MISSING_ITEMS',
  liability: [{ party: 'RESTAURANT', basisPoints: 10000 }, { party: 'COURIER', basisPoints: 0 }, { party: 'PLATFORM', basisPoints: 0 }],
  explanation: 'Missing item.', evidenceRefs: ['item:1'], agentRun: { traceId: '0'.repeat(32) }, createdAt: '2026-10-30T00:00:00Z'
};
const reply = (data, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(data) });
const english = notices => { for (const message of notices) assert.doesNotMatch(message, /[\u4e00-\u9fff]/); };
function setup(fetch) {
  const calls = [], notices = [], renders = [];
  const api = new ApiSession({ scheme: 'OpsBearer', fetch: async (path, init) => {
    calls.push([path, init]);
    if (fetch) return fetch(path, init);
    return reply(path === '/ops/identity' ? { role: 'OPS_REVIEWER' } : init.method === 'POST' ? { refundId: 'ref_01M63ZP4P0HXQZAVQJCQQKZNY2' } : { items: [proposal] });
  } });
  api.setCredential(token);
  const intent = new CommandIntent(api);
  const controller = createProposalReview({ api, intent, render: (...args) => renders.push(args), notice: message => notices.push(message) });
  return { api, intent, controller, calls, notices, renders };
}

test('paths and bodies are validated', () => {
  assert.equal(proposalListPath(), '/ops/refund-proposals?status=PENDING_REVIEW&limit=50');
  assert.throws(() => proposalListPath('OTHER'), /Unknown proposal status/);
  assert.throws(() => decisionPath('bad'), /Invalid proposal id/);
  assert.equal(decisionPath(proposal.id), `/ops/refund-proposals/${proposal.id}/decision`);
  for (const reason of ['   ', 'x'.repeat(501)]) assert.throws(() => decisionBody('REJECT', reason), /A rejection needs a reason of 1 to 500 characters/);
  assert.throws(() => decisionBody('EDIT'), /Unknown decision/);
  assert.deepEqual(decisionBody('APPROVE', 'ignored'), { action: 'APPROVE' });
  assert.deepEqual(decisionBody('REJECT', '  Missing evidence  '), { action: 'REJECT', reason: 'Missing evidence' });
});
test('proposal view formats money and shares exactly', () => {
  const view = proposalView(proposal);
  assert.equal(view.amount, '4.50 USD');
  assert.deepEqual(view.liability.map(line => line.percent), ['100.00%', '0.00%', '0.00%']);
  assert.equal(view.traceId, proposal.agentRun.traceId);
  assert.equal(proposalView({ ...proposal, agentRun: undefined }).traceId, null);
  assert.equal(proposalView({ ...proposal, currency: 'JPY' }).amount, '450 JPY (minor units)');
});
test('only a reviewer can review a pending proposal', () => {
  assert.equal(canReview({ role: 'OPS_REVIEWER' }, proposal), true);
  assert.equal(canReview({ role: 'OPS_VIEWER' }, proposal), false);
  assert.equal(canReview({ role: 'OPS_REVIEWER' }, { ...proposal, status: 'APPROVED' }), false);
  assert.equal(canReview(null, proposal), false);
});
test('approve sends one keyed POST and reloads', async () => {
  const { controller, calls, notices } = setup();
  await controller.identify();
  const result = await controller.decide(proposal.id, 'APPROVE');
  assert.deepEqual(calls.map(([path, init]) => [init.method, path]), [
    ['GET', '/ops/identity'], ['GET', proposalListPath()], ['POST', decisionPath(proposal.id)], ['GET', proposalListPath()]
  ]);
  const init = calls[2][1];
  assert.equal(init.headers.Authorization, `OpsBearer ${token}`);
  assert.match(init.headers['Idempotency-Key'], /^ops-/);
  assert.equal(init.body, '{"action":"APPROVE"}');
  assert.equal(result.refundId, 'ref_01M63ZP4P0HXQZAVQJCQQKZNY2');
  assert.ok(notices.some(message => message.includes(result.refundId)));
  english(notices);
});
test('a lost decision response is retried with the same key', async () => {
  let posts = 0;
  const { controller, calls, notices } = setup(async (path, init) => {
    if (init.method === 'POST' && ++posts === 1) throw new TypeError('network');
    return reply(path === '/ops/identity' ? { role: 'OPS_REVIEWER' } : init.method === 'POST' ? { refundId: 'ref_01M63ZP4P0HXQZAVQJCQQKZNY2' } : { items: [proposal] });
  });
  await controller.identify();
  assert.equal(await controller.decide(proposal.id, 'APPROVE'), null);
  assert.match(notices.at(-1), /not confirmed/);
  const count = calls.length;
  assert.equal(await controller.decide('prop_01M63ZP4P0HXQZAVQJCQQKZNY3', 'APPROVE'), null);
  assert.equal(calls.length, count);
  await controller.retry();
  const requests = calls.filter(([, init]) => init.method === 'POST');
  assert.equal(requests.length, 2);
  assert.equal(requests[0][1].headers['Idempotency-Key'], requests[1][1].headers['Idempotency-Key']);
  assert.equal(requests[0][1].body, requests[1][1].body);
  english(notices);
});
test('an invalid rejection sends nothing', async () => {
  const { controller, calls, notices } = setup();
  await controller.identify();
  const count = calls.length;
  await controller.decide(proposal.id, 'REJECT', '');
  assert.equal(calls.length, count);
  assert.equal(notices.at(-1), 'A rejection needs a reason of 1 to 500 characters');
  english(notices);
});
test('notices are English and never echo core messages', async () => {
  const invalid = setup();
  invalid.api.setCredential('not-a-token');
  await invalid.controller.identify();
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.notices.at(-1), 'Enter an ops_… credential.');
  const unauthorized = setup(() => reply({ code: 'UNAUTHORIZED', message: 'x' }, 401));
  await unauthorized.controller.identify();
  assert.equal(unauthorized.notices.at(-1), 'Sign-in failed: UNAUTHORIZED');
  const broken = setup(path => reply(path === '/ops/identity' ? { role: 'OPS_REVIEWER' } : { code: 'INTERNAL_ERROR' }, path === '/ops/identity' ? 200 : 500));
  await broken.controller.identify();
  assert.equal(broken.notices.at(-1), 'Could not load proposals: INTERNAL_ERROR');
  english([...invalid.notices, ...unauthorized.notices, ...broken.notices]);
});
