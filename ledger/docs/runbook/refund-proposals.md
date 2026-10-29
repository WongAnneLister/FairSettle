# Refund proposals and review

The agent submits immutable refund content and liability shares. It never moves money.

| Endpoint | Caller |
| --- | --- |
| `GET /v1/payments/{paymentId}/refundable` | Application with `payments:read` |
| `POST /v1/refund-proposals` | Application with `refund-proposals:write` |
| `GET /v1/refund-proposals/{proposalId}` | Application with `refund-proposals:read` |
| `GET /ops/refund-proposals` | Ops viewer, operator, reviewer or admin |
| `POST /ops/refund-proposals/{proposalId}/decision` | `OPS_REVIEWER` only |

A proposal starts as `PENDING_REVIEW` and ends as `APPROVED` or `REJECTED`.
Creation reserves nothing. Approval rechecks availability and control state, reserves the refund
through the existing refund reservation, records its liability split, decides the proposal and
writes the success audit in one transaction. Failure rolls all of these changes back. The existing
worker executes the refund; liability posts after the refund's accounting is confirmed. Rejection
records the reason and reviewer without creating a refund. Neither outcome allows edits.
A decision `Idempotency-Key` belongs to one proposal; reusing it for another proposal returns
`409 IDEMPOTENCY_CONFLICT`.

Local fixtures provision `local-reviewer` (`OPS_REVIEWER`) with credential id
`10000000-0000-0000-0000-000000000062`, using the same local ops secret as `local-viewer`.
Use this reviewer credential to approve; the viewer can only list proposals.

Create a proposal (replace every placeholder with a value from your sandbox):

```bash
curl -i http://localhost:8080/v1/refund-proposals \
  -H 'Authorization: Bearer <APPLICATION_TOKEN>' \
  -H 'Idempotency-Key: refund-proposal:<COMPLAINT_ID>' \
  -H 'Content-Type: application/json' \
  -d '{"complaintId":"<COMPLAINT_ID>","orderRef":"<ORDER_REF>","paymentId":"<PAYMENT_ID>","decision":"PARTIAL_REFUND","amountMinor":450,"currency":"USD","reasonCode":"MISSING_ITEM","liability":[{"party":"RESTAURANT","basisPoints":10000},{"party":"DRIVER","basisPoints":0},{"party":"PLATFORM","basisPoints":0}],"explanation":"The ordered drink was missing.","evidenceRefs":["<EVIDENCE_REF>"],"agentRun":{"threadId":"<THREAD_ID>"}}'
```

List pending proposals:

```bash
curl -i 'http://localhost:8080/ops/refund-proposals?status=PENDING_REVIEW&limit=50' \
  -H 'Authorization: OpsBearer <OPS_VIEWER_TOKEN>'
```

Approve exactly as submitted:

```bash
curl -i http://localhost:8080/ops/refund-proposals/<PROPOSAL_ID>/decision \
  -H 'Authorization: OpsBearer <OPS_REVIEWER_TOKEN>' \
  -H 'Idempotency-Key: <DECISION_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action":"APPROVE"}'
```

Keep the returned `refundId` and poll the refund and proposal resources. A successful decision
returns a pending allocation with an explicit `journalId: null` until posting completes.

## Agent credential (F24)

Set the optional `LOCAL_AGENT_SECRET` to provision credential
`10000000-0000-0000-0000-000000000042`, with key id `agent`, for the same `demo`
application as dispatch. Its scopes are `payments:read`, `refunds:read`,
`refund-proposals:read` and `refund-proposals:write`. It has no payment or refund
write scope. The secret must differ from the app and ops secrets. An existing fixture
database gains the credential once; provisioning never rotates it.

## Review page (F24)

Open `/refund-proposals.html` and sign in with
`ops_10000000-0000-0000-0000-000000000062.<LOCAL_OPS_SECRET>`. Credential 61 can only view.
Review the amount, shares, explanation and evidence references, then approve exactly as
submitted or reject with a reason. A pending retry keeps the same body and idempotency
key after a lost response. The page shows the trace id as text; the live-run script prints
its Langfuse URL.
