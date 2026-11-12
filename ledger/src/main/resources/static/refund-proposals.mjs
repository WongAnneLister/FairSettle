import { ApiSession, CommandIntent } from './ui/core.mjs';
import { createProposalReview } from './ui/proposals.mjs';

const element = id => document.getElementById(id);
const api = new ApiSession({ scheme: 'OpsBearer' });
const intent = new CommandIntent(api);
const syncPending = () => { element('retry').hidden = !intent.pending; };

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const controller = createProposalReview({
  api, intent,
  notice(message) {
    element('notice').textContent = message;
    const role = api.identity?.role;
    element('identity').textContent = role ? `Role: ${role}` : '';
    if (role) {
      element('identity').className = 'identity-badge role-' + role.toLowerCase();
    }
    syncPending();
  },
  render(views, { canReview }) {
    element('proposals').replaceChildren();
    if (views.length === 0) {
      const empty = make('div', 'No proposals found matching this filter.', 'empty-state');
      element('proposals').append(empty);
      syncPending();
      return;
    }
    for (const view of views) {
      const card = make('article', undefined, 'proposal-card');

      // Header: IDs and Status badge
      const header = make('div', undefined, 'card-header');
      const idGroup = make('div', undefined, 'id-group');
      idGroup.append(
        make('span', view.id, 'badge-prop-id'),
        make('span', `Order #${view.orderRef}`, 'badge-order')
      );
      if (view.paymentId) {
        idGroup.append(make('span', `Pay: ${view.paymentId}`, 'badge-subtle'));
      }
      const statusBadge = make('span', view.status.replace(/_/g, ' '), `status-badge status-${view.status.toLowerCase()}`);
      header.append(idGroup, statusBadge);
      card.append(header);

      // Highlight Row: Amount & Reason
      const metricsRow = make('div', undefined, 'metrics-row');
      const amountBox = make('div', undefined, 'metric-box');
      amountBox.append(
        make('div', 'Proposed Refund', 'metric-label'),
        make('div', view.amount, 'metric-amount')
      );
      const reasonBox = make('div', undefined, 'metric-box');
      reasonBox.append(
        make('div', 'Decision & Reason Code', 'metric-label'),
        make('div', `${view.decision} · ${view.reasonCode.replace(/_/g, ' ')}`, 'metric-val')
      );
      metricsRow.append(amountBox, reasonBox);
      card.append(metricsRow);

      // Liability Allocation Section
      const liabilitySection = make('div', undefined, 'liability-section');
      liabilitySection.append(make('div', '⚖️ Liability Allocation', 'section-title'));

      const progressBar = make('div', undefined, 'liability-bar');
      const partyColors = {
        RESTAURANT: '#f56311',
        COURIER: '#2563eb',
        DRIVER: '#2563eb',
        PLATFORM: '#059669'
      };
      const partyIcons = {
        RESTAURANT: '🍽️',
        COURIER: '🛵',
        DRIVER: '🛵',
        PLATFORM: '🛡️'
      };
      const cardsGrid = make('div', undefined, 'party-grid');

      for (const line of view.liability) {
        const party = line.party.toUpperCase();
        const color = partyColors[party] || '#64748b';
        const icon = partyIcons[party] || '📌';
        const pctNum = parseFloat(line.percent) || 0;

        if (pctNum > 0) {
          const seg = make('div', undefined, 'bar-seg');
          seg.style.width = `${pctNum}%`;
          seg.style.backgroundColor = color;
          seg.title = `${line.party}: ${line.percent}`;
          progressBar.append(seg);
        }

        const partyCard = make('div', undefined, 'party-card');
        partyCard.style.borderTopColor = color;
        const pHeader = make('div', undefined, 'party-header');
        pHeader.append(make('span', icon, 'party-icon'), make('span', line.party, 'party-name'));
        const pPct = make('div', line.percent, 'party-pct');
        pPct.style.color = color;
        const pBp = make('div', `${line.basisPoints.toLocaleString()} bp`, 'party-bp');
        partyCard.append(pHeader, pPct, pBp);
        cardsGrid.append(partyCard);
      }
      liabilitySection.append(progressBar, cardsGrid);
      card.append(liabilitySection);

      // Explanation & Evidence
      if (view.explanation) {
        const expBox = make('div', undefined, 'explanation-box');
        expBox.append(make('div', 'Agent Explanation', 'box-label'));
        expBox.append(make('p', view.explanation, 'explanation-text'));
        card.append(expBox);
      }

      const metaRow = make('div', undefined, 'meta-row');
      const evidenceBox = make('div', undefined, 'evidence-box');
      evidenceBox.append(make('span', 'Cited Evidence: ', 'meta-label'));
      const evList = make('span', undefined, 'evidence-chips');
      for (const ref of view.evidenceRefs) {
        evList.append(make('span', ref, 'chip'));
      }
      evidenceBox.append(evList);
      metaRow.append(evidenceBox);

      card.append(metaRow);

      const details = make('dl', undefined, 'meta-details');
      for (const [label, value] of [
        ['Complaint id', view.complaintId],
        ['Langfuse trace id', view.traceId ?? 'None'],
        ['Created at', view.createdAt]
      ]) details.append(make('dt', label, 'meta-label'), make('dd', value));
      card.append(details);

      // Human Review Actions
      if (canReview(view)) {
        const actions = make('div', undefined, 'action-panel');
        const approve = make('button', '✓ Approve & Execute PayPal Refund', 'btn-approve');
        approve.type = 'button';
        approve.addEventListener('click', () => controller.decide(view.id, 'APPROVE'));

        const rejectDetails = make('details', undefined, 'reject-details');
        rejectDetails.append(make('summary', 'Decline proposal...', 'reject-summary'));
        const rejectBody = make('div', undefined, 'reject-body');
        const label = make('label', 'Rejection reason:', 'reject-label');
        const reason = document.createElement('textarea');
        reason.rows = 2;
        reason.placeholder = 'Provide reason for rejection...';
        label.append(reason);
        const reject = make('button', 'Confirm Rejection', 'btn-reject');
        reject.type = 'button';
        reject.addEventListener('click', () => controller.decide(view.id, 'REJECT', reason.value));
        rejectBody.append(label, reject);
        rejectDetails.append(rejectBody);

        actions.append(approve, rejectDetails);
        card.append(actions);
      }

      element('proposals').append(card);
    }
    syncPending();
  }
});

// Demo helper: fills only the public reviewer key id; the secret is still typed by hand.
const demoBtn = element('btn-demo-fill');
if (demoBtn) {
  demoBtn.addEventListener('click', () => {
    const credInput = element('credential');
    if (!credInput.value.startsWith('ops_')) {
      credInput.value = 'ops_10000000-0000-0000-0000-000000000062.';
      credInput.focus();
    }
  });
}

element('identity-form').addEventListener('submit', event => {
  event.preventDefault();
  api.setCredential(element('credential').value.trim());
  controller.identify();
});

element('refresh').addEventListener('click', () => controller.load(element('status-filter').value));
element('status-filter').addEventListener('change', () => controller.load(element('status-filter').value));
element('retry').addEventListener('click', () => controller.retry());
window.addEventListener('pagehide', () => api.clear());
