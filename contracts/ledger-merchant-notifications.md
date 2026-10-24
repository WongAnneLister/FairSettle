# Ledger merchant notifications consumed by dispatch (F16)

The ledger sends payment notifications at least once. Dispatch receives them at
`POST /webhooks/ledger` when `LEDGER_CHECKOUT=enabled`. The authoritative sender
contract is [the ledger merchant notification contract](../ledger/docs/contracts/merchant-notifications.md).
This document describes the dispatch receiver. Real ledger delivery is verified
in F24; F16 uses signed local HTTP deliveries.

## Wire format

The request is UTF-8 `application/json`, at most 16384 bytes. Retries preserve the
exact body, eventId and businessKey, but use a new timestamp and signature.
Each of these headers must be present and single-valued:

- `X-Payments-Event-Id`: the event UUID.
- `X-Payments-Business-Key`: the business key.
- `X-Payments-Timestamp`: Unix seconds for this delivery attempt.
- `X-Payments-Signature`: `v1=` followed by 64 lowercase hexadecimal characters.

The signature is HMAC-SHA256 using the shared `LEDGER_NOTIFICATION_SECRET`, at
least 32 bytes. Its input is the UTF-8 prefix
`<timestamp>.<eventId>.<businessKey>.` followed immediately by the original body
bytes. Dispatch uses `req.rawBody`, never re-serialized JSON, checks a timestamp
window of plus or minus 300 seconds, and compares signatures in constant time.
Secrets, credentials, request headers and request bodies must not enter logs or
the database.

The sender body contains these fields:

| Field | Meaning |
| --- | --- |
| schemaVersion | Integer 1 |
| eventId | Lowercase UUID identifying the immutable event |
| eventType | `payment.succeeded`, `payment.canceled`, or `payment.state_changed` |
| organizationId, environmentId, applicationId, providerAccountId | Ledger scope UUIDs |
| paymentId, orderId | Internal ledger UUIDs |
| orderKey | Dispatch correlation key: `dispatch-order-<positive order id>` |
| resourceVersion | Payment resource version |
| currency | Currency code |
| amountMinor, capturedAmountMinor | Non-negative integer minor units; USD cents |
| paymentStatus | Ledger payment business status |
| origin | Sender origin, such as `NATIVE` or `RECONCILIATION` |
| occurredAt | Event time string, ISO-8601 from the sender |
| businessKey | `organizationId:environmentId:applicationId:orderId:eventType` |

Dispatch validates schemaVersion, eventId, eventType, orderKey, currency,
amountMinor, capturedAmountMinor, paymentStatus, businessKey and occurredAt.
Other fields are retained in the parsed notification but not interpreted.
The body eventId and businessKey must equal their header values. Missing or
invalid required fields produce 400 and no inbox row.

## Durable receipt and payment result

Dispatch inserts an inbox row keyed by eventId, with the SHA-256 digest of the
raw body, and applies any effect in the same database transaction. A repeat
with the same digest is a duplicate. Reusing an eventId with different bytes is
a conflict. Every validated signed event is recorded, including ignored events.
The inbox stores only the event identity, type, business key, digest, local
order id and outcome; it does not store the request body.

Correlation uses orderKey. The notification paymentId is an internal UUID,
whereas F15 stores the API identifier `pay_<ULID>`; these are not compared.
The receiver locks the identified order before checking currency and amount.
An unknown order, non-USD currency or a different order total is recorded and
ignored. A succeeded event also requires `paymentStatus=SUCCEEDED` and
`capturedAmountMinor=amountMinor`; otherwise it is ignored as not a full capture.
The sender emits payment.succeeded once for a full NATIVE capture. A businessKey
may repeat across informational payment.state_changed events.

Order payment status is separate from fulfillment status:

- Orders created with checkout disabled, and pre-F16 orders, are `NotRequired`.
- Orders created with checkout enabled start `AwaitingPayment`.
- `payment.succeeded` moves `AwaitingPayment` to `Paid`.
- `payment.canceled` moves `AwaitingPayment` to `Failed`.
- `payment.state_changed` is informational and ignored.
- Repeating a final result is a no-op; conflicting or out-of-order results never
  move an order backwards or across. Events on `NotRequired` are ignored.

All payment changes use the payment transition evaluator in the order state
machine. The database update includes the current paymentStatus in its WHERE
condition. Payments do not change fulfillment OrderStatus or gate cooking or
courier dispatch in F16.

## Responses

| Result | HTTP and body |
| --- | --- |
| Checkout disabled | 404 |
| Raw body missing / larger than 16384 bytes | 400 / 413 |
| Missing or invalid headers, signature or timestamp | 401 `{"error":"invalid signature"}` |
| Invalid JSON fields or header/body mismatch | 400 |
| Same eventId and digest | 200 `{"received":true,"duplicate":true}` |
| Same eventId with different digest | 409 `{"error":"event id reused with different content"}` |
| Recorded result | 200 with `received:true`, `duplicate:false`, `applied` and `reason` |
| Database failure | 500; no successful acknowledgement |

The ledger treats 2xx as done. It retries network failures, 408, 429 and 5xx.
Other responses, including 401 and 409, become DEAD and require investigation.
The receiver commits its inbox row and business effect before returning 2xx.
