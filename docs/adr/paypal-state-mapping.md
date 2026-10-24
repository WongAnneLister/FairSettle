# ADR: PayPal state mapping

Status: Accepted · Date: 2026-10-22 · Feature: F03

Related: [payment state machine](../../ledger/docs/state-machines/payment.md) · [refund state machine](../../ledger/docs/state-machines/refund.md) · [provider operation state machine](../../ledger/docs/state-machines/provider-operation.md) · [ADR-0003 unknown provider result](../../ledger/docs/adr/0003-provider-unknown-result.md) · [provider port contract](../../ledger/docs/contracts/provider.md) · [sandbox samples](paypal-samples/SUMMARY.md)

Transition ids below refer to the ledger state-machine docs: `payment T7` is transition T7 in `payment.md`, `refund F3` is F3 in `refund.md`, `op O4` is O4 in `provider-operation.md`. `D1`–`D12` are this ADR's own decisions.

## 1. Context

PayPal Orders v2 with `intent=CAPTURE` is a two-step flow: the buyer approves the order on PayPal, then the merchant must call capture. The existing Stripe Checkout adapter captures automatically, so the ledger has no capture step today. With PayPal, money cannot move before the ledger itself calls capture.

The ledger keeps four orthogonal dimensions per payment (`payment_status`, `provider_status`, `resolution_status`, `financial_status`, see payment.md §1) and has no FAILED payment status. This ADR maps PayPal onto those dimensions and onto the refund and provider-operation state machines without adding statuses.

Facts verified in the sandbox (F02, run 20261022170335, files in `paypal-samples/`):

- The same `PayPal-Request-Id` on create, capture and refund returns the original object (samples 02, 06, 09).
- Capture before approval is 422 `ORDER_NOT_APPROVED` (03).
- Capture with a new request id after a successful capture is 422 `ORDER_ALREADY_CAPTURED` (07).
- Over-refund is 422 `REFUND_AMOUNT_EXCEEDED` (10).

PayPal's published OpenAPI files (`paypal/paypal-rest-api-specifications`, `checkout_orders_v2.json` and `payments_payment_v2.json`, read 2026-10-22) say the server stores create and capture request ids for 6 hours. The refund endpoint documents no retention. The 6-hour figure is documented, not measured.

## 2. Decisions

- **D1 No new payment or refund statuses.** PayPal maps onto the existing `PaymentStatus` and `refund_status` values. No migration changes the `payment_status` or `refund_status` CHECK.
- **D2 Approved-not-captured** is `payment_status=PROCESSING` and `provider_status='APPROVED'` and `captured_amount_minor=0`. PROCESSING fits because the buyer has finished and the remaining step is the ledger's own. F06 asserts this state.
- **D3 `provider_status` holds the raw PayPal order status** (`CREATED`, `PAYER_ACTION_REQUIRED`, `APPROVED`, `COMPLETED`, ...), never a capture or refund status. The raw capture status is kept in the capture observation (`ChargeFact.outcomeType`, F06); the payment attempt stores the normalized status (`succeeded`, `pending`, `failed`) that capture accounting and financial replay read, and the raw `status_details.reason` as `failure_code`. The refund status is kept raw on the refund's `provider_status`.
- **D4 A PayPal capture is the payment attempt.** The capture id plays the role of Stripe's charge id: it is the refund anchor (F08), and the normalized fact key is `CAPTURE:<capture id>`, so a webhook and a query of the same capture count once.
- **D5 Only the ledger starts a capture, and only after authoritative evidence of approval:** a GET order showing `APPROVED`, or a verified `CHECKOUT.ORDER.APPROVED` webhook. The buyer's return to `return_url` is level-5 evidence (payment R3) and only triggers a GET order. The capture is a new operation type `CAPTURE_ORDER`, one per payment (existing unique `(payment_id, operation_type)`), prepared in the same transaction that records the approval. Order creation reuses `CREATE_CHECKOUT`. Adding `CAPTURE_ORDER` to the `operation_type` CHECK belongs to F06.
- **D6 `PayPal-Request-Id` is the operation's persisted `operation_key`.** Never a new id for the same operation (op X1). Create, capture and each refund have different keys (provider-operation.md §3).
- **D7 Automatic resend window: 5 hours** from the operation's first send, for create and capture only (documented 6 hours minus a 1-hour margin). Refunds are never resent automatically, because PayPal documents no retention for the refund endpoint.
- **D8 Capture timeout: query, never resend blindly.** Recovery always starts with GET order; the full path is §5.
- **D9 Financial evidence.** PayPal has no balance-transaction import in this ledger (that module is out of scope). The `seller_receivable_breakdown` (`gross_amount`, `paypal_fee`, `net_amount`) on a capture with status `COMPLETED` is the financial evidence for posting. A capture in any other status posts nothing. PayPal decimal strings are converted to integer minor units exactly, never through floating point; a value with more decimals than the currency allows is `CONTRACT_MISMATCH`.
- **D10 Webhooks are level-3 evidence** (payment.md §6). They may move state forward along allowed transitions, never backwards, and never change a terminal state. A webhook that contradicts a recorded fact makes the object CONFLICT; it does not pick a side.
- **D11 Requests send `Prefer: return=representation`** on create, capture and refund, so responses carry full status and amounts. The refund sample 08 was a minimal response without the amount.
- **D12 Refund correlation.** Every refund request sets `custom_id` to the ledger refund id (UUID). Refund recovery finds refunds through GET order `purchase_units[0].payments.refunds[]` by `custom_id`.

Any order, capture or refund status not listed in §3, §4 or §7 is `CONTRACT_MISMATCH`: automatic processing stops and the evidence is kept. It is never mapped to the nearest known value.

## 3. Order status → payment

All six values of PayPal's `order_status`.

| PayPal order status | `payment_status` | resolution | Transition | Notes |
| --- | --- | --- | --- | --- |
| `CREATED` | AWAITING_CUSTOMER | KNOWN | payment T2 | Approval link is `rel=approve` or `rel=payer-action`; stored as the hosted URL |
| `PAYER_ACTION_REQUIRED` | AWAITING_CUSTOMER | KNOWN | payment T2 | What create returned in the sandbox (sample 01), link `rel=payer-action` |
| `SAVED` | unchanged | CONFLICT | — | Produced only by the save-order flow, which the ledger never uses. The adapter returns `CONTRACT_MISMATCH` |
| `APPROVED` | PROCESSING (approved-not-captured, D2) | KNOWN | payment T5 | Prepares `CAPTURE_ORDER` once (D5). A later GET still showing `APPROVED` changes nothing |
| `VOIDED` | CANCELED, only from a GET order with no entry in `payments.captures` | KNOWN | payment T9 (from AWAITING_CUSTOMER), P1 (from PROCESSING) | A webhook alone never cancels (payment R4). Any capture present: CONFLICT |
| `COMPLETED` | decided by the capture, §4 | per §4 | payment T7 / T8 | Order `COMPLETED` alone is not a capture fact; read `purchase_units[0].payments.captures` |

`REQUIRES_ACTION` is not used for PayPal: buyer authentication happens inside PayPal's approval page, before `APPROVED`.

**P1 (new, PayPal only): PROCESSING → CANCELED.** Guard: an authoritative GET order shows that no capture exists or every capture is `DECLINED`/`FAILED`, and the order can no longer be captured (`VOIDED`, or `COMPLETED` after a declined capture). This is the same evidence class as payment T9 (complete query proving no money moved), applied to the PayPal state where the buyer has already approved. The code already allows it: `PaymentEvidenceRules.decide` cancels a non-terminal payment on complete, unpaid query evidence regardless of the current status. Payment R4 still holds: a timeout or a webhook never cancels.

A GET order with more than one purchase unit or more than one capture is `CONTRACT_MISMATCH`. The ledger creates exactly one purchase unit and captures it once; sample 07 (`ORDER_ALREADY_CAPTURED`) confirms one capture per `intent=CAPTURE` order.

## 4. Capture status → payment and attempt

All six values of PayPal's `capture_status`.

| Capture status | attempt `captured` | `payment_status` | `financial_status` | Transition | Notes |
| --- | --- | --- | --- | --- | --- |
| `COMPLETED` | true | SUCCEEDED | POSTED once the D9 posting is written; PENDING_EVIDENCE until then | payment T7 / T8 | `captured_amount_minor` is the capture amount, not the requested amount (payment.md §7). Sample 05 |
| `PENDING` | false | PROCESSING | NOT_APPLICABLE | payment T5 (stays PROCESSING) | Keep raw `status_details.reason`. Wait for `PAYMENT.CAPTURE.COMPLETED` or a query. Never a failure |
| `DECLINED` | false | PROCESSING; CANCELED only by P1 | NOT_APPLICABLE | P1 | No money moved and the order cannot be captured again, so the payment ends CANCELED with query evidence. Never from a webhook alone (payment R4) |
| `FAILED` | false | as `DECLINED` | NOT_APPLICABLE | P1 | as `DECLINED` |
| `PARTIALLY_REFUNDED` | true | SUCCEEDED (unchanged if already) | unchanged | payment R1 (no change) | Refunds never change `payment_status` (payment.md §7); refund facts come from refund objects, §7 |
| `REFUNDED` | true | SUCCEEDED (unchanged if already) | unchanged | payment R1 | as `PARTIALLY_REFUNDED` |

`capture_status_details.reason` values (`BUYER_COMPLAINT`, `CHARGEBACK`, `ECHECK`, `INTERNATIONAL_WITHDRAWAL`, `OTHER`, `PENDING_REVIEW`, `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION`, `REFUNDED`, `TRANSACTION_APPROVED_AWAITING_FUNDING`, `UNILATERAL`, `VERIFICATION_REQUIRED`, `DECLINED_BY_RISK_FRAUD_FILTERS`) are stored raw on the attempt and never decide a transition.

For the same capture id, an observation that moves backwards (for example `PENDING` after `COMPLETED`) is stale and ignored. `COMPLETED` followed by `DECLINED` or `FAILED` is CONFLICT (payment R6).

## 5. Capture call outcomes and the timeout path

`POST /v2/checkout/orders/{id}/capture`, operation `CAPTURE_ORDER`. Each outcome maps to exactly one `ProviderCallClassification` (provider.md §5).

| Outcome | Classification | Operation | Payment | Next step | Ref |
| --- | --- | --- | --- | --- | --- |
| 201, capture in body | SUCCESS | ACKNOWLEDGED → RESOLVED | per §4 | none | op O3, O6; sample 05 |
| 200, replay of the same request id | SUCCESS | as above; no second effect | per §4 | none | sample 06 |
| 422 `ORDER_NOT_APPROVED` | DEFINITIVE_REJECT | ACKNOWLEDGED | AWAITING_CUSTOMER once the GET in the next step confirms it | GET order; capture again only after new approval evidence (D5) | payment T11; sample 03 |
| 422 `INSTRUMENT_DECLINED` | DEFINITIVE_REJECT | ACKNOWLEDGED | AWAITING_CUSTOMER once a GET confirms it | Buyer re-approves through the payer-action link. Documented, not observed | payment T11 |
| 422 `ORDER_ALREADY_CAPTURED` | TIMEOUT_UNKNOWN | UNKNOWN | PROCESSING, resolution UNKNOWN | GET order and adopt the existing capture; never send another capture. A capture exists, so this is never a failure | op O4, O5; sample 07 |
| 422, any other issue | CONTRACT_MISMATCH | UNKNOWN | resolution CONFLICT | Manual investigation; evidence kept | provider.md §5 |
| 400 | DEFINITIVE_REJECT | ACKNOWLEDGED | unchanged, resolution CONFLICT (the ledger's request was wrong) | Manual investigation | |
| 401 | after F04's single token refresh and retry with the same request id: RETRYABLE_TRANSIENT | UNKNOWN | resolution UNKNOWN | as timeout | F04 |
| 403 | CAPABILITY_UNAVAILABLE | ACKNOWLEDGED | unchanged | Manual investigation | |
| 404 `RESOURCE_NOT_FOUND` | NOT_FOUND | UNKNOWN | resolution UNKNOWN | Not proof that nothing happened; escalate if it persists | op O8 |
| 409 or 422 for a concurrent request with the same request id | RETRYABLE_TRANSIENT | UNKNOWN | resolution UNKNOWN | as timeout. PayPal documents that a second simultaneous request "might fail". Documented, not observed | |
| 429 | RATE_LIMITED | UNKNOWN | resolution UNKNOWN | back off, then as timeout | |
| 5xx | RETRYABLE_TRANSIENT | UNKNOWN | resolution UNKNOWN | as timeout | |
| No response, read timeout | TIMEOUT_UNKNOWN | UNKNOWN | PROCESSING, `provider_status` stays `APPROVED`, resolution UNKNOWN | the timeout path below | op O4; ADR-0003 |

### Timeout path: query, never resend blindly

The order id is always known when capture is sent (it is the operation's `external_object_id`), so recovery always starts with a query.

1. GET `/v2/checkout/orders/{id}` (level-2 evidence, payment.md §6).
2. Order `COMPLETED` with one capture: adopt it per §4. Operation RESOLVED (op O5). No capture is sent.
3. Order `APPROVED` with no capture: resend capture only with the original `PayPal-Request-Id`, only while less than 5 hours have passed since the operation's first send (D7), and only directly after this GET in the same recovery attempt (op O7). If the first request was accepted, PayPal returns the original capture.
4. Order `APPROVED` with no capture and the 5 hours have passed: ESCALATED (op O8). No resend, no new request id, not marked failed.
5. Order `VOIDED` with no capture: payment CANCELED (P1), operation RESOLVED.
6. GET times out, or returns 5xx, 429 or 404: stay UNKNOWN with L1 backoff (provider-operation.md §8); after the age limit, ESCALATED.
7. Never: a new request id (op X1), a resend outside the window (op X3), a resend without a fresh GET, a resend because "enough time has passed" (op X5), marking the payment failed (op X2).

```text
                 capture: no response / 5xx / ORDER_ALREADY_CAPTURED
                                 │
                                 ▼
                   operation UNKNOWN, payment PROCESSING
                                 │
                                 ▼
                     GET /v2/checkout/orders/{id}
          ┌──────────────┬───────┴────────┬─────────────────┐
          ▼              ▼                ▼                 ▼
   COMPLETED with    APPROVED,         VOIDED,         no answer / 5xx /
   one capture       no capture        no capture      429 / 404
          │              │                │                 │
          ▼              ▼                ▼                 ▼
   adopt capture    < 5 h since       CANCELED (P1)    stay UNKNOWN,
   (§4), RESOLVED   first send?       RESOLVED         L1 backoff,
                    ├─ yes ─► resend with the           then ESCALATED
                    │         ORIGINAL request id
                    └─ no ──► ESCALATED
                              ✗ no new id  ✗ no resend  ✗ not failed
```

## 6. Order creation outcomes

`POST /v2/checkout/orders`, operation `CREATE_CHECKOUT`.

| Outcome | Classification | Payment | Ref |
| --- | --- | --- | --- |
| 200 / 201 with order | SUCCESS | AWAITING_CUSTOMER per §3 | payment T2; sample 01 |
| 200, replay of the same request id | SUCCESS, same order id | unchanged | sample 02 |
| 400 / 422 | DEFINITIVE_REJECT | CANCELED only if no order id was ever recorded (`ProviderResultRules.rejectLeftRemoteTrace`) | payment T10 |
| No response, 5xx, 429 | TIMEOUT_UNKNOWN / RETRYABLE_TRANSIENT / RATE_LIMITED | PROCESSING, resolution UNKNOWN | payment T3; op O4 |

Create timeout recovery: PayPal has no order search, so the only recovery is a resend with the original `PayPal-Request-Id` within 5 hours of the first send (op O7), which returns the original order if one was created (sample 02). After 5 hours: ESCALATED (op O8). An unapproved duplicate order moves no money, but the rule does not change.

## 7. Refund status and outcomes → refund

All four values of PayPal's `refund_status`.

| PayPal refund status | `refund_status` | H / R effect | Transition |
| --- | --- | --- | --- |
| `COMPLETED` | SUCCEEDED | H −= a, R += a | refund F3 / F5 |
| `PENDING` | PENDING | H kept | refund F4 |
| `FAILED` | FAILED | H released | refund F6 |
| `CANCELLED` (PayPal spelling, two L) | CANCELED | H released | refund F7 |

`RefundFactRules.STATUSES` maps Stripe's lowercase values today; F08 adds this mapping and matches `CANCELLED` exactly. `refund_status_details.reason` (only `ECHECK`) is stored raw.

`POST /v2/payments/captures/{capture_id}/refund`, operation `CREATE_REFUND`:

| Outcome | Classification | Refund | Ref |
| --- | --- | --- | --- |
| 201 with status | SUCCESS | per the status table | sample 08 |
| 200, replay of the same request id | SUCCESS; no second effect | per the status table | sample 09 |
| 422 `REFUND_AMOUNT_EXCEEDED` or `CAPTURE_FULLY_REFUNDED` | DEFINITIVE_REJECT | FAILED, H released (`RefundFactRules.rejectionReleasesHold`). The refund control also moves to `EXTERNAL_CONFLICT`: the ledger believed the amount fit within C − R − H, so PayPal knows a refund the ledger does not | refund F6, N1, refund.md §3; sample 10 |
| 422, any other issue | CONTRACT_MISMATCH | H kept, resolution CONFLICT | refund N4 |
| 400 / 403 | DEFINITIVE_REJECT / CAPABILITY_UNAVAILABLE | H kept until a person confirms; resolution CONFLICT | refund N4; F08: 400 and other 422 are classified CONTRACT_MISMATCH; the hold is kept and the refund stays UNKNOWN until the custom_id search or the age limit brings it to a person |
| No response, 5xx, 429, 401 after one refresh | TIMEOUT_UNKNOWN / RETRYABLE_TRANSIENT / RATE_LIMITED | SUBMITTED, resolution UNKNOWN, H kept | refund F8 |

The `EXTERNAL_CONFLICT` move extends refund.md §3, whose trigger today is an ingested external refund; here the external refund is inferred from PayPal's rejection. New refunds stay blocked until the mapping is reconciled, as refund.md §3 requires.

Refund timeout recovery: GET order and look in `purchase_units[0].payments.refunds[]` for `custom_id` equal to the ledger refund id (D12).

- Exactly one match: adopt it and record its id (refund F9).
- More than one: CONFLICT.
- None: stay UNKNOWN with L1 backoff, then ESCALATED.

No automatic resend for refunds (D7), not even with the original request id.

## 8. Webhook events and ordering

| Event | Resource | Effect |
| --- | --- | --- |
| `CHECKOUT.ORDER.APPROVED` | order | Same as a GET showing `APPROVED` (§3): approved-not-captured, `CAPTURE_ORDER` prepared once |
| `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | order | No direct state change; schedules a GET order, whose result is applied per §3 |
| `PAYMENT.CAPTURE.COMPLETED` | capture | Per §4 `COMPLETED`; linked to the payment through `supplementary_data.related_ids.order_id` |
| `PAYMENT.CAPTURE.PENDING` | capture | Per §4 `PENDING` |
| `PAYMENT.CAPTURE.DECLINED` | capture | Records the attempt; payment stays PROCESSING; CANCELED only after a GET (P1) |
| `PAYMENT.CAPTURE.REFUNDED` | refund (observed in sandbox, F12, 2026-10-24) | Per §7 `COMPLETED`, matched by refund id, else by `custom_id` |
| `PAYMENT.REFUND.PENDING` | refund | Per §7 `PENDING` |
| `PAYMENT.REFUND.FAILED` | refund | Per §7 `FAILED` |
| `PAYMENT.CAPTURE.REVERSED` | capture | Stored in the inbox and left unprocessed (WAITING). Reversals belong to the dispute module, which is out of scope |
| any other event, including `CHECKOUT.ORDER.COMPLETED` (marketplaces only) | | Stored, not processed |

Ordering rules:

1. Verification comes first (F09). An event that fails verification, or whose verification call times out, is never stored as verified and never changes state.
2. Transport dedup by event id in the existing `webhook_inbox` (unique per provider account and event id).
3. Semantic dedup: a capture seen by a query and by a webhook is one fact (`CAPTURE:<capture id>`, D4); a refund is one fact per PayPal refund id.
4. Staleness: the resource's `update_time` is the event time passed to `PaymentEvidenceRules.isStale`. An event older than the last applied webhook, or not newer than the last successful query, changes nothing.
5. Terminal states never regress: payment SUCCEEDED and refund SUCCEEDED/FAILED/CANCELED do not change on any later event (payment R1, refund.md §7). A contradicting event (different amount, currency or order, or one terminal status to another) is CONFLICT.
6. An event whose order or capture is not yet known locally (for example `PAYMENT.CAPTURE.COMPLETED` before the capture response was written) goes to the existing `dependency_wait` and is retried, not dropped.
7. A webhook may skip intermediate states (payment T8): `PAYMENT.CAPTURE.COMPLETED` while the payment is still AWAITING_CUSTOMER moves it to SUCCEEDED.
8. A webhook alone never cancels a payment, and never releases a refund hold, except `PAYMENT.REFUND.FAILED`, which is an explicit failure (refund F6).

## 9. Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Add an `APPROVED` payment status | Needs a migration on a CHECK that Stripe code paths share, and changes every status switch. PROCESSING plus `provider_status` carries the same fact (D2) |
| Capture directly when the buyer returns, without a GET | The return is not evidence (payment R3). A GET costs one call, and a capture would be rejected anyway if the order is not approved |
| On capture timeout, resend capture at once | Usually safe within 6 hours, but a resend without a GET hides `ORDER_ALREADY_CAPTURED` cases, and outside the window PayPal may treat it as a new request (op X3) |
| Resend refunds with the original request id after a timeout | PayPal documents no refund retention; a second refund is a real loss |
| Treat `ORDER_ALREADY_CAPTURED` as a rejection | It proves a capture exists; treating it as failure would cancel a paid payment |
| Use the capture webhook as the only capture signal | Webhooks are late, duplicated and out of order; the capture response and GET order are authoritative |

## 10. Consequences

Positive

- No schema change for payment or refund statuses; only one new operation type (`CAPTURE_ORDER`, F06).
- A double capture is excluded by design: one capture operation per payment, one request id per operation, and recovery that queries before it resends.
- Money moves only on the ledger's capture call, so a payment whose `CAPTURE_ORDER` never left PREPARED has provably moved no money. That allows a later local cancel (payment T10); no feature implements it yet.

Negative

- Payments can sit in approved-not-captured while the worker is down. The L2 scan finds PROCESSING payments with an open `CAPTURE_ORDER`.
- Refunds with lost responses need a person more often than Stripe refunds, because they are never resent. Observed in the F12 live run; impact, workarounds and a proposed fix are in [KI-1](../known-issues.md#ki-1--a-refund-whose-request-is-lost-stays-unknown-until-a-person-steps-in).
- PayPal posting relies on the capture's `seller_receivable_breakdown`, not on a balance-transaction import, so fee corrections PayPal makes later are not picked up.
- The 5-hour window rests on PayPal's documentation. It is not measured, and F12 does not measure it either.

## 11. Verification ownership

| Rule | Feature | Test |
| --- | --- | --- |
| D6, §6 order creation | F05 | `PayPalCreateOrderTest` |
| 401 refresh | F04 | `PayPalAuthClientTest` |
| D2, D5, §3, §4, D9 | F06 | `PayPalCaptureTest`, `PaymentStateMachinePayPalTest` |
| §5 timeout path | F07 | `PayPalCaptureUnknownTest` |
| §7 refunds, D12 | F08 | F08 plan |
| §8 rules 1–2 | F09 | F09 plan |
| §8 rules 3–8 | F10 | F10 plan |
| The whole map against the real sandbox, including the rows marked "not observed" | F12 | manual |
