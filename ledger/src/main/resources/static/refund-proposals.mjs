import { ApiSession, CommandIntent } from './ui/core.mjs';
import { createProposalReview } from './ui/proposals.mjs';

const element = id => document.getElementById(id);
const api = new ApiSession({ scheme: 'OpsBearer' });
const intent = new CommandIntent(api);
const syncPending = () => { element('retry').hidden = !intent.pending; };
const make = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const controller = createProposalReview({
  api, intent,
  notice(message) {
    element('notice').textContent = message;
    element('identity').textContent = api.identity?.role ?? '';
    syncPending();
  },
  render(views, { canReview }) {
    element('proposals').replaceChildren();
    for (const view of views) {
      const article = make('article'); article.className = 'panel';
      const dl = make('dl');
      for (const [label, value] of [
        ['Proposal id', view.id], ['Complaint id', view.complaintId], ['Order', view.orderRef],
        ['Payment id', view.paymentId], ['Status', view.status], ['Amount', view.amount],
        ['Reason code', view.reasonCode], ['Decision', view.decision],
        ...view.liability.map(line => ['Liability', `${line.party} · ${line.basisPoints} bp · ${line.percent}`]),
        ['Explanation', view.explanation], ['Langfuse trace id', view.traceId ?? 'None'], ['Created at', view.createdAt]
      ]) dl.append(make('dt', label), make('dd', value));
      article.append(dl, make('h2', 'Evidence references'));
      const refs = make('ul');
      for (const ref of view.evidenceRefs) refs.append(make('li', ref));
      article.append(refs);
      if (canReview(view)) {
        const approve = make('button', 'Approve'); approve.type = 'button';
        approve.addEventListener('click', () => controller.decide(view.id, 'APPROVE'));
        const label = make('label', 'Rejection reason'); const reason = make('textarea'); label.append(reason);
        const reject = make('button', 'Reject'); reject.type = 'button';
        reject.addEventListener('click', () => controller.decide(view.id, 'REJECT', reason.value));
        article.append(approve, label, reject);
      }
      element('proposals').append(article);
    }
    syncPending();
  }
});
element('identity-form').addEventListener('submit', event => {
  event.preventDefault(); api.setCredential(element('credential').value); controller.identify();
});
element('refresh').addEventListener('click', () => controller.load(element('status-filter').value));
element('status-filter').addEventListener('change', () => controller.load(element('status-filter').value));
element('retry').addEventListener('click', () => controller.retry());
window.addEventListener('pagehide', () => api.clear());
