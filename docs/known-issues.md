# Known issues

Known limitations that were found, judged, and deliberately left unfixed for now. Each entry says what happens, how bad it is, what to do meanwhile, how a fix would look, and when to revisit it.

This file is not a work list. Planned work lives only in `docs/features.json`. Turning an entry into work means adding a feature and writing its plan.

## KI-1 · A refund whose request is lost stays UNKNOWN until a person steps in

Status: **deferred** (2026-10-24, after F12). Area: `ledger`, PayPal refunds.

### What happens

The ledger sends a refund, but the request never reaches PayPal, or the response never comes back. The ledger records `TIMEOUT_UNKNOWN`, and its recovery only queries PayPal (GET order, look for the refund by `custom_id`). It never sends the refund again. ADR D7: "Refunds are never resent automatically, because PayPal documents no retention for the refund endpoint."

When the request never arrived, the query can never find anything. The refund then stays `SUBMITTED` / `UNKNOWN` until the unresolved-age limit escalates it to a person.

### Observed

F12 live run, attempt 1, 2026-10-24, sandbox:

| Time (UTC) | Call | Classification |
| --- | --- | --- |
| 05:56:24 | `CREATE_REFUND` | `TIMEOUT_UNKNOWN`, `NO_RESPONSE`. It hit the 5 s `JdkPayPalTransport.CONNECT_TIMEOUT` |
| 05:56:39 | `QUERY_REFUND` | `TIMEOUT_UNKNOWN`, `NO_RESPONSE` |
| 05:57:04, 05:57:41, 05:58:49 | `QUERY_REFUND` | `TRANSIENT_EMPTY`: HTTP 200, no refund with this `custom_id` |

A direct read of the sandbox showed capture `2VE96620GC997535U` still `COMPLETED`, with no refund in the order: PayPal never received the request. The network was the cause. Timed connections to `api-m.sandbox.paypal.com` from the developer's Mac failed about 1 in 6 times, through a local proxy/TUN. The local database was then recreated and the run repeated. Attempt 3 passed. See the F12 entry in `docs/progress.md`.

### Impact

- **Money is safe.** No duplicate refund is possible: one operation key per refund, used as `PayPal-Request-Id`, and never resent. The failure mode is "not refunded", never "refunded twice".
- **The customer is not refunded** until a person acts.
- **The amount stays reserved.** For example, a stuck $25 refund on a $100 capture leaves only $75 refundable. Revenue share has already been reduced for the reservation.
- **No in-system way out.** After escalation there is no resend path: `/ops/tasks/{id}/retry` does not resend an expired UNKNOWN operation. A refund made by hand in the PayPal dashboard carries no ledger `custom_id`, so the ledger cannot match it. It is likely to surface as an external refund or a conflict that needs a manual adjustment.

### Likelihood

It depends on the network between the ledger and PayPal:

- **Flaky local networks or proxies:** frequent. About 1 in 6 connections failed on the developer's Mac.
- **A cloud host:** rare.

The most exposed moment is the F24 live demo (complaint → proposal → approval → PayPal refund), if it runs from a local network.

### Workarounds without code

- Run live demos and sandbox runs from a host with a stable connection to PayPal, for example the deployment planned for F24.
- In a local sandbox run, recreate the local ledger database and start the run again, as in F12. This only works for disposable data.

### Proposed fix

**Query-confirmed resend with the original request id, inside a short window.** This mirrors F07's capture recovery (`CaptureRecoveryRules`). Amend ADR D7 so that recovery may resend a refund only when **all** of these hold:

| Condition | Rule |
| --- | --- |
| Trigger | Only from recovery, directly after a GET order in the same lease |
| Query | That GET is at least 2 minutes after the first send, and its `refunds[]` has no entry whose `custom_id` is this refund's id (D12) |
| Request id | The operation's original `PayPal-Request-Id`, never a new one |
| Window | Within 1 hour of the first send, at most 3 resends |
| Amount | The capture's remaining refundable amount still covers the refund |
| After the window | `ESCALATED` with reason `REFUND_RESEND_WINDOW_EXPIRED`; no resend, not failed |

**Why it is safe.** A duplicate refund needs two independent guards to fail at once:

- PayPal has forgotten the request id, so it would create a new refund instead of returning the original;
- and the original refund is still missing from GET order 2 minutes after the first send.

The short window makes the first unlikely. The query delay makes the second unlikely. PayPal also rejects over-refunds (sample `10-over-refund.json`), so the exposure is capped at the capture's remaining amount.

**Why not resend only after a connect timeout.** A connect timeout does prove that nothing was sent. But the rule would then depend on the transport's exception type. Behind a local proxy or TUN, the JDK connects to the proxy, so a request that never reached PayPal shows up as a read timeout. The rule would not fire in exactly the environment where F12 failed. It would also leave lost responses (read timeouts after the request arrived) stuck.

**Shape of the change.**

- A pure rule `RefundRecoveryRules.next` → `RESOLVE` / `RESEND` / `ESCALATE` / `WAIT`, applied under the recovery lease. This is the same structure as `CaptureRecoveryRules.next`.
- No change to the transport, the adapters, posting or migrations.

**Evidence to gather first** (sandbox samples for the ADR). The 1-hour window and the 2-minute delay are estimates; measure them before fixing the numbers. Sandbox behavior is not a production guarantee, so set both with margin.

- **Request-id retention for refunds:** resend a refund with the same `PayPal-Request-Id` after 1 hour and after 6 hours, and record whether PayPal returns the original refund.
- **Visibility lag:** how long a new refund takes to appear in GET order `refunds[]`.

**Later, separately:** an ops "resend with approval" action for refunds escalated after the window, under independent review like adjustments.

### Revisit when

- A refund gets stuck on a stable cloud host, not only on a local network.
- It becomes clear that the F24 demo must run from a local network.
- Real merchants or real money are in scope.

### Adding the feature

New features cannot be added to `docs/features.json` with the current tooling. `scripts/features.py` only changes the state of existing features, and AGENTS.md forbids editing the file any other way. Decide that process before planning this fix.

### Related

- `docs/adr/paypal-state-mapping.md`: D7, D12, §7 (refund timeout recovery), §10 (consequences).
- `docs/plans/F07.md`: the capture resend design this mirrors.
- `docs/plans/F12.md` and the F12 entry in `docs/progress.md`.
- `docs/adr/paypal-samples/09-refund-same-request-id.json`: same request id within seconds returns the same refund.
