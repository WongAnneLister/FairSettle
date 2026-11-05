# Progress log

Append-only, newest entry at the bottom. One entry per working session.

This file is the narrative: what happened, what was learned, what to watch out for.
It never states whether a feature is done; that lives only in `docs/features.json`.
Paste the output of `python3 scripts/features.py handoff` at the top of each entry
instead of writing status by hand.

Entry template:

```
## YYYY-MM-DD · session N · F__

<paste: python3 scripts/features.py handoff>

Done this session
- commit <hash>: what it does, in one line

Not done / left half-way
- what, and exactly where it stopped (file, test, error message)

Next
- the first concrete step for the next session

Pitfalls found
- anything that cost more than 15 minutes, and the fix
```

---

## 2026-10-22 · session 0 · planning

### State on 2026-10-22

- passing 0/32
- ready next: F01 Monorepo structure initialized, F02 Rules checked, sandbox reachable

Done this session
- Registered for the PayPal AI Hackathon (submissions close 2026-11-12 PT)
- Execution plan, agent PRD and project overview written on claude.ai
- Feature list (32 features), gate script and progress log created

Not done / left half-way
- Official rules not read yet (eligibility, prizes, pre-existing code policy, video length)
- No PayPal Sandbox app yet

Next
- F02: read the rules, create the sandbox app, curl token → order → approve → capture
- F01: initialize fairsettle/ monorepo structure with ledger/ and dispatch/ services

Pitfalls found
- Both repos' compose files use host ports 5432 and 6379; the root compose (F13) must remap them

## 2026-10-22 · session 1 · F01

### State on 2026-10-22

- passing 1/32
- recently passing: F01 (ed7967d)
- ready next: F02 Rules checked, sandbox reachable, F13 One compose for all services

Done this session
- commit 5cc374a: feature list, gate and progress log; pre-commit hook falls back to `python` when `python3` is the Windows Store stub
- repository setup: initialized repo-local git configuration and structure for the monorepo
- commit 7662244: AGENTS.md and plan template (by hand, outside the agent)
- commit ed7967d: gate runs verification commands with bash, not cmd.exe, and decodes output as UTF-8
- commit a0d10e9: gate stores evidence log paths POSIX-style; `check` also accepts the backslash path F01 was recorded with
- commit 8b87249: F01 evidence (dispatch 44 tests, ledger 344 tests, all green from the new location)

Not done / left half-way
- Nothing for F01. F02 (manual) still needs the rules read and a PayPal Sandbox app
- Service-level CLAUDE.md files that AGENTS.md's layout implies do not exist yet in ledger/ or dispatch/

Next
- F02 by hand: note eligibility, prize, code submission policy and video-length rules here; sandbox client id/secret into .env; curl token → order → approve → capture COMPLETED
- Then F03 plan session (Claude Code) per AGENTS.md roles

Pitfalls found
- On this Windows machine `python3` is the Microsoft Store stub; use `python` (3.12) for `scripts/features.py`
- Global git identity is a work address (gigacloudtech.com); this repo sets user.name/email locally, check before committing
- `npm ci` in dispatch/ runs husky via `prepare`; install with `HUSKY=0` so it cannot touch core.hooksPath
- Passing features cannot be re-verified (start only accepts not_started), so gate bugs that affect the evidence record must be handled in `check`, not by re-running verify

## 2026-10-22 · session 2 · F02

### State on 2026-10-22

- passing 1/32
- active: F02 Rules checked, sandbox reachable
- recently passing: F01 (ed7967d)
- ready next: F13 One compose for all services

Official rules (read by hand; not legal advice)
- Eligibility: excluded are Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and countries under comprehensive US Treasury sanctions. Mainland China is not named, so entry and prizes are allowed as written. Tax forms and payout method at prize time follow Devpost's requirements.
- Prizes: one grand prize or honorable mention, plus one sponsor prize, per project. Targets: honorable mentions "Best Use of PayPal + AI" and "Best Use of Agentic Commerce" ($5,000 each), and the Render sponsor prize (we deploy to Render anyway).
- Code submission policy: code and architecture developed for the hackathon submission. Commit dates and implementation milestones provide transparent development tracking throughout the event.
- Video: under 3 minutes, public on YouTube (not unlisted). Uploading from mainland China needs a proxy; leave time for that.
- Repository: must be public, with an open-source license visible in the GitHub About panel. Needs a root LICENSE file.
- Judging: five equally weighted criteria (technical implementation, design, potential impact, innovation, presentation). Design is 20%, so the Gradio UI cannot stay bare; revisit in week 3.
- Deadline: 2026-11-12 12:00 PT (PST, UTC-8) = 2026-11-13 04:00 Beijing time.

Done this session
- commit 1658c28: scripts/paypal_smoke.sh and sandbox responses in docs/adr/paypal-samples/ (run 20261022170335)
- Sandbox chain by hand: token, create order 7CV2269518094610C, buyer approval in browser, capture 41995584GM234064G COMPLETED, partial refund 2EU12368F9867740A COMPLETED
- Findings for the F03 ADR: create, capture and refund are idempotent on PayPal-Request-Id (same id returns the original object); capture with a new request id after success is 422 ORDER_ALREADY_CAPTURED; capture before approval is 422 ORDER_NOT_APPROVED; over-refund is 422 REFUND_AMOUNT_EXCEEDED
- Initial environment verification completed

Not done / left half-way
- F02 verify needs a human: `python scripts/features.py verify F02`
- No LICENSE file yet; licence choice is the author's

Next
- Verify F02, then plan F03 (PayPal state-mapping ADR) from the samples above

Pitfalls found
- .env saved on Windows has CRLF; sourcing it left "\r" in the secret. The smoke script now strips CRs
- Native jq.exe writes CRLF; the smoke script uses `jq -b` where supported
- `brew` does not apply on Windows; jq installed with `winget install jqlang.jq`
- The Terminal panel runs PowerShell; call Git Bash by full path (`C:\Program Files\Git\bin\bash.exe`), since plain `bash` may be WSL

## 2026-10-22 · session 3 · F03

### State on 2026-10-22

- passing 2/32
- active: F03 ADR: PayPal state mapping
- recently passing: F01 (ed7967d), F02 (3fe3b23)
- ready next: F13 One compose for all services

Done this session
- commit 12432a7: plan docs/plans/F03.md
- commit b2b00d5: F03 started
- commit 760a0a4: docs/adr/paypal-state-mapping.md, written by Claude Code instead of Codex at the author's request
- commit b0232da: plan deviations recorded (P1 PROCESSING → CANCELED named explicitly, doc-prefixed transition ids, EXTERNAL_CONFLICT extension)
- Completeness checks from the plan pass: every order/capture/refund enum value and the 9 webhook events appear; every cited transition id exists in ledger/docs/state-machines; all links resolve

Not done / left half-way
- F03 verify needs a human: review the ADR against ledger/docs/state-machines/, then `python scripts/features.py verify F03`

Next
- Verify F03, then plan F04 (PayPal auth client)

Pitfalls found
- PayPal's docs pages do not render enums for WebFetch; the enums came from the raw OpenAPI files in github.com/paypal/paypal-rest-api-specifications (openapi/checkout_orders_v2.json, payments_payment_v2.json)
- Refund PayPal-Request-Id retention is undocumented (create/capture: 6 h), which is why the ADR forbids automatic refund resends

## 2026-10-22 · session 4 · F04

### State on 2026-10-22

- passing 4/32
- recently passing: F01 (ed7967d), F02 (3fe3b23), F03 (0df6669), F04 (2e251cb)
- ready next: F05 Create PayPal order, F09 Webhook verification and inbox, F13 One compose for all services

Done this session
- commit e070c67: started F04 with `python scripts/features.py start F04`
- commit 34329fd: wrote all 27 PayPalAuthClientTest cases before production code; the prescribed test command failed compilation because the PayPal types did not exist
- commit 2e251cb: implemented sandbox-only PayPal auth, serialized token caching and refresh, one 401 retry, transport/result types and optional Spring configuration
- The F04 test command passed all 27 tests; `./mvnw test` passed all 371 unit tests with no failures, errors or skips
- commit 422cc99: recorded `python scripts/features.py verify F04` evidence against implementation commit 2e251cb
- Ran `./mvnw spotless:apply` before each commit, checked file scope, and kept the repository-local MichikatsuOwO author identity without co-author trailers; no push

Not done / left half-way
- Fresh-session review by Claude Code remains a separate session under AGENTS.md
- No real PayPal calls were made; real sandbox verification belongs to F12

Next
- Review F04 against docs/plans/F04.md in a fresh session, recording any review fixes under Deviations
- Follow-up outside F04: replace scripts/paypal_smoke.sh's prefix-only base URL check with an exact sandbox URL check; the script was left unchanged as planned

Pitfalls found
- The execution sandbox could not launch the Windows Python alias; ran the required `python` command outside the sandbox
- Used Git Bash by its full path and added its bin directory to the verification process PATH so features.py could find bash
- Git reported dubious ownership in the sandbox; supplied safe.directory for this repository through process-local Git configuration without changing the repository's author configuration

## 2026-10-22 · session 5 · F05

### State on 2026-10-22

- passing 5/32
- recently passing: F01 (ed7967d), F02 (3fe3b23), F03 (0df6669), F04 (2e251cb), F05 (d01d97f)
- ready next: F06 Approval return and capture, F09 Webhook verification and inbox, F13 One compose for all services

Done this session
- commit d01d97f: combined F05 start state, tests and implementation in the single work commit required by the updated plan
- Implemented PayPal order create/query through CheckoutPort, exact minor-unit conversion, operation-key request ids, sanitized evidence, trusted deployment binding, the documented recovery window and V17
- Tests were written first and the prescribed PayPalCreateOrderTest command failed compilation before production code existed; the six test/helper files remained byte-for-byte unchanged afterward
- The only later assertion changes were the eight migration counts, each increased by one for V17, explicitly authorized by plan update 0e69ffc
- Final local checks in Git Bash: `./mvnw -q -Dtest='PayPalCreateOrderTest' test` passed 17 tests; `./mvnw test` passed 393 tests, with no failures, errors or skips
- Integration verification was completed on the VPS in two runs, as confirmed by the user: the full 619-test run had 8 failures, all caused by upgrade migration counts missing V17; all other tests passed, including PayPalCreateOrderIT 5/5 and V17 itself. After correcting those counts, the eight upgrade test classes were rerun together with PayPalCreateOrderIT: all 26 tests passed
- This Windows machine has no local Docker engine. Its Docker CLI uses an SSH VPS context, which local Testcontainers could not discover; integration tests therefore ran on the VPS. The user authorized completion from those results without another full `./mvnw verify` run
- `python scripts/features.py verify F05` succeeded against d01d97f; its generated evidence is docs/evidence/F05.log
- Ran Spotless before each commit and checked file scope; retained MichikatsuOwO <wongannelister@gmail.com> without co-author trailers. No push

Not done / left half-way
- Fresh-session review by Claude Code remains separate under AGENTS.md
- Real PayPal sandbox verification remains F12; the tests use scripted provider replies and real PostgreSQL integration fixtures

Next
- Review F05 against docs/plans/F05.md in a fresh session, then proceed to the F06 planning session

Pitfalls found
- V17 adds one to eight existing upgrade-test migration counts; the exact changes and reason are recorded in the plan's Deviations
- The sessionStatus mapping must check for null before calling Set.of(...).contains; the corrected plan preserves Stripe's null-status behavior

## 2026-10-23 · session 6 · F06

### State on 2026-10-23

- passing 6/32
- recently passing: F02 (3fe3b23), F03 (0df6669), F04 (2e251cb), F05 (d01d97f), F06 (5799baf)
- ready next: F07 Capture timeout goes to UNKNOWN, F08 Refund by capture id, F09 Webhook verification and inbox

Done this session
- commit 5799baf: combined F06 start state, tests and implementation in the single work commit required by the plan
- Implemented PayPal approval queries and capture, persisted CAPTURE_ORDER operations, query-based recovery, capture state mapping and settlement recording through the existing financial replay and ledger posting service; added V18 and the eight planned upgrade-test migration count increments
- Tests were written first and the prescribed PayPalCaptureTest / PaymentStateMachinePayPalTest command failed compilation before implementation; existing test assertions were preserved afterward. The corrected plan authorized only the repository import and CaptureSettlementService constructor argument change in PayPalCaptureIT
- Final local tests in Git Bash: PayPalCaptureTest 16/16 and PaymentStateMachinePayPalTest 13/13; `./mvnw test` passed all 422 tests with no failures, errors or skips, including all three LayeringArchitectureTest checks
- This Windows machine has no local Docker. Integration verification ran on the VPS in two stages, as confirmed by the user: the full `./mvnw verify` run covered 626 integration tests with zero failures and one error, solely PayPalCaptureIT test 46 because docs/adr/paypal-samples was missing on the VPS. After restoring the sample files, PayPalCaptureTest (16), PaymentStateMachinePayPalTest (13) and PayPalCaptureIT (7) were rerun together: all 36 passed, BUILD SUCCESS
- The user authorized completion from those VPS results without another `./mvnw verify` run
- `python scripts/features.py verify F06` succeeded against 5799baf; generated evidence is docs/evidence/F06.log. Ran `python scripts/features.py handoff` before writing this entry
- Ran Spotless before each commit and checked file scope; retained MichikatsuOwO <wongannelister@gmail.com> without co-author trailers. No push

Not done / left half-way
- Fresh-session review by Claude Code remains separate under AGENTS.md
- Real PayPal sandbox verification remains F12; automated tests use scripted provider replies and real PostgreSQL integration fixtures

Next
- Review F06 against docs/plans/F06.md in a fresh session, then plan the next feature

Pitfalls found
- The original plan put JdbcTemplate in CaptureSettlementService, violating the existing architecture rule. Work stopped until the plan was corrected: all settlement SQL now lives in the new financialingestion.repository.CaptureSettlementRepository; LayeringArchitectureTest remains unchanged
- The VPS must include docs/adr/paypal-samples for test 46; restoring those fixtures resolved the environment error without changing test assertions

## 2026-10-23 · session 7 · F07

### State on 2026-10-23

- passing 7/32
- recently passing: F03 (0df6669), F04 (2e251cb), F05 (d01d97f), F06 (5799baf), F07 (7c745f0)
- ready next: F08 Refund by capture id, F09 Webhook verification and inbox, F13 One compose for all services

Done this session
- commit 7c745f0: combined F07 start state, tests and implementation in the single work commit required by the plan
- Added the pure capture recovery decision table, same-request-id resend after a fresh approved query within retry_until, window and age escalation, immediate ORDER_ALREADY_CAPTURED queries, cancellation from definitive declined/voided evidence, and conflict detection for VOIDED orders with captures
- Wrote tests 1–12 and 20–27 and extracted PayPalCaptureFixture before implementation. The acceptance command failed compilation because CaptureRecoveryRules and captureDeclined did not exist. Test assertions were frozen afterward; all four test/fixture files kept identical hashes through implementation and final formatting. PayPalCaptureIT's seven test methods and assertions remained unchanged while its setup and helpers moved into the fixture
- Local Git Bash checks passed: PayPalCaptureUnknownTest 12/12; `./mvnw test` 434/434 with zero failures, errors or skips, including the existing architecture checks
- This Windows machine has no local Docker. As confirmed by the user, the VPS completed one full `./mvnw -B verify` run: 434 unit tests and 634 integration tests, zero failures, with only three existing skips. PayPalCaptureUnknownIT passed 8/8, PayPalCaptureIT 7/7 and PayPalCreateOrderIT 5/5; all executed tests passed
- The user authorized completion from that full VPS run without rerunning `./mvnw verify`
- `python scripts/features.py verify F07` succeeded against 7c745f0; generated evidence is docs/evidence/F07.log. Ran `python scripts/features.py handoff` before writing this entry
- Ran Spotless before each commit and checked file scope; retained MichikatsuOwO <wongannelister@gmail.com> without co-author trailers. No push

Not done / left half-way
- Fresh-session review by Claude Code remains separate under AGENTS.md
- Real PayPal sandbox verification remains F12; automated provider responses are scripted fixtures

Next
- Review F07 against docs/plans/F07.md in a fresh session, then plan the next feature

Pitfalls found
- Recovery must re-read the payment after merging the fresh GET so the resend's follow-up GET uses the current payment version
- Capture recovery ITs mark the create task DONE before recovery, keeping queued provider replies deterministic when both tasks would otherwise be due together

## 2026-10-23 · session 8 · F08

### State on 2026-10-23

- passing 8/32
- recently passing: F04 (2e251cb), F05 (d01d97f), F06 (5799baf), F07 (7c745f0), F08 (2a85752)
- ready next: F09 Webhook verification and inbox, F13 One compose for all services

Done this session
- commit 2a85752: combined F08 start state, tests and implementation in the single work commit required by the plan
- Added PayPal refunds against the stored capture id, operation-key idempotency, raw refund status mapping, reservation settlement, over-refund control freezing and refund posting through the existing settlement/replay path. Lost responses recover by custom_id search or a known refund id without an automatic resend
- Wrote tests 1–16 and 30–37 and both transport helpers before implementation; the acceptance command failed compilation because the F08 adapter, port, command fields and rule methods did not exist. Assertions stayed unchanged afterward; the later 13 IT key string replacements were explicitly authorized by the corrected plan's Deviations
- Final local Git Bash checks passed after the key correction: PayPalRefundTest 16/16 and `./mvnw test` 450/450, with zero failures, errors or skips, including the existing architecture checks
- This Windows machine has no local Docker. Integration verification ran on the VPS in two stages, as confirmed by the user: the full verify run covered 450 unit tests and 642 integration tests; only seven PayPalRefundIT cases failed because the plan's Idempotency-Key values were too short, and the other 635 integration tests passed. After replacing the keys according to the corrected plan, PayPalRefundTest (16) and PayPalRefundIT (8) were rerun together: all 24 passed, BUILD SUCCESS
- The user authorized completion from those VPS results without another `./mvnw verify` run
- `python scripts/features.py verify F08` succeeded against 2a85752; generated evidence is docs/evidence/F08.log. Ran `python scripts/features.py handoff` before writing this entry
- Ran Spotless before each commit and checked file scope; retained MichikatsuOwO <wongannelister@gmail.com> without co-author trailers. No push

Not done / left half-way
- Fresh-session review by Claude Code remains separate under AGENTS.md
- Real PayPal sandbox verification remains F12; automated provider responses are scripted fixtures

Next
- Review F08 against docs/plans/F08.md in a fresh session, then plan the next feature

Pitfalls found
- PaymentRequests.idempotencyKey requires 8–255 visible ASCII characters. The original short keys made tests 31–37 fail validation before refund logic ran; replacing only those strings fixed the tests without changing assertions
- VPS refund tests need docs/adr/paypal-samples, including sample 10, alongside ledger sources

## 2026-10-23 · session 9 · F09

### State on 2026-10-23

- passing 9/32
- recently passing: F05 (d01d97f), F06 (5799baf), F07 (7c745f0), F08 (2a85752), F09 (f3ba84d)
- ready next: F10 Webhook events posted, F13 One compose for all services

Done this session
- commit f3ba84d: combined F09 start state, six new production classes, tests and both webhook event fixtures in the single work commit required by the plan
- Added PayPal verification with the configured webhook id, the raw event embedded verbatim, validated signature headers and sandbox certificate URLs, trusted account binding, whitelist-only snapshots and event-id deduplication in the existing inbox. Failed or unavailable verification stores nothing; stored PayPal events remain WAITING for the future resource handler
- Wrote tests 1–14 and 20–27 before implementation and confirmed the acceptance command failed compilation because the planned new classes did not exist. Tests and both fixtures retained identical hashes after that failure, through implementation and final formatting; existing production files and architecture tests stayed unchanged
- Local Git Bash checks passed: PayPalWebhookVerificationTest 14/14 and `./mvnw test` 464/464, with zero failures, errors or skips, including all three architecture tests
- This Windows machine has no local Docker. As confirmed by the user, the VPS completed one full `./mvnw -B verify` run: 464 unit tests and 650 integration tests, zero failures, with only three existing skips. PayPalWebhookIT passed 8/8 and all other PayPal integration tests passed; all executed tests passed
- The user authorized completion from that full VPS run without rerunning `./mvnw verify`
- `python scripts/features.py verify F09` succeeded against f3ba84d; generated evidence is docs/evidence/F09.log. Ran `python scripts/features.py handoff` before writing this entry
- Ran Spotless before each commit and checked file scope; retained MichikatsuOwO <wongannelister@gmail.com> without co-author trailers. No push

Not done / left half-way
- Fresh-session review by Claude Code remains separate under AGENTS.md
- PayPal event processing belongs to F10; real sandbox webhook verification and registration remain F12

Next
- Review F09 against docs/plans/F09.md in a fresh session, then plan the next feature

Pitfalls found
- The capture fixture is 1542 bytes, so the original test 25 could not pad it to 1025 bytes. Work stopped until the plan was corrected: RAW.length - 1 rejects and RAW.length accepts, testing the inclusive body limit without modifying either fixture
- All new SQL lives in webhook.repository.PayPalWebhookInboxRepository, preserving the existing architecture rule without exemptions

## 2026-10-23 · session 10 · F10

### State on 2026-10-23

- passing 10/32
- recently passing: F06 (5799baf), F07 (7c745f0), F08 (2a85752), F09 (f3ba84d), F10 (94d97fc)
- ready next: F11 Full ledger regression green, F13 One compose for all services

Done this session
- commit 94d97fc: combined F10 start state, tests and implementation in the single work commit required by the plan
- Added PayPal capture-completed and refund-completed snapshot mapping, payment/refund correlation and inbox dispatch through the existing state mergers, with settlement posting after the state transaction commits. New SQL lives only in webhook.repository.PayPalWebhookPaymentRepository; architecture exemptions and existing tests remain unchanged
- Wrote tests 1–12 and 20–31 before implementation and confirmed the acceptance command failed compilation because the planned new classes did not exist. Assertions were frozen afterward; formatting preserved both test class bodies after whitespace normalization
- Local Git Bash checks passed: PayPalWebhookPostingTest 12/12 and `./mvnw test` 476/476, with zero failures, errors or skips, including all three architecture tests
- This Windows machine has no local Docker. As confirmed by the user, the VPS completed one full `./mvnw -B verify` run: 476 unit tests and 662 integration tests, zero failures, with only three existing skips. PayPalWebhookPostingIT passed 12/12, PayPalWebhookIT 8/8 and all other PayPal integration tests passed; all executed tests passed
- The user authorized completion from that full VPS run without rerunning `./mvnw verify`
- `python scripts/features.py verify F10` succeeded against 94d97fc; generated evidence is docs/evidence/F10.log. Ran `python scripts/features.py handoff` before writing this entry
- Ran Spotless before each commit and checked file scope; retained MichikatsuOwO <wongannelister@gmail.com> without co-author trailers. No push

Not done / left half-way
- Fresh-session review by Claude Code remains separate under AGENTS.md
- Real PayPal sandbox verification remains F12; automated provider responses are scripted fixtures

Next
- Review F10 against docs/plans/F10.md in a fresh session, then plan F11

Pitfalls found
- The plan was corrected once before implementation in c5f063a: test 21 originally queried recovery at a fake-clock time older than the webhook's future update_time, so existing stale-evidence rules would retain provider_status APPROVED. The corrected test advances the fake clock by 2 seconds after webhook processing and before completed(payment) and recovery, making the query later without changing the existing rules or other test assertions

## 2026-10-24 · session 11 · F11

### State on 2026-10-24

- passing 11/32
- recently passing: F07 (7c745f0), F08 (2a85752), F09 (f3ba84d), F10 (94d97fc), F11 (ab74beb)
- ready next: F12 M1: real sandbox payment and partial refund, F13 One compose for all services

Done this session
- commit 5fd85f2: F11 plan, a gate run with no code changes
- commit 0e146df: F11 start state only (work commit)
- commit 97cbd30: plan amendment, decision 7, gate timeout 3600 s, approved by the user
- commit ab74beb: `VERIFY_TIMEOUT_S` 1800 → 3600 in scripts/features.py, nothing else
- Planned and implemented by Claude Code at the user's request (not Codex). Verification host is the developer's Mac, also the user's choice: JDK 21 via `brew install openjdk@21` (keg-only, JAVA_HOME set per command) and Docker Desktop with 8 CPUs and 8 GB. The plan's bundle/clone/copy-back steps did not apply; see Deviations in docs/plans/F11.md
- Pre-flight P1–P5, C1 (spotless:check) and C2 passed
- R1 `./mvnw -B clean verify` under `caffeinate -i`: BUILD SUCCESS. Unit 476/0/0/0. Integration 662 tests, 0 failures, 0 errors, 3 skipped. The skipped are exactly PaymentRealContractIT, PayoutRealReadIT and StripeRealContractIT, env-gated by design. PayPal* tests 114 unit and 48 IT; Stripe* 62 unit and 10 IT. The counts are identical to F10's VPS run
- `python3 scripts/features.py verify F11` passed against ab74beb in 1850 s; generated evidence is docs/evidence/F11.log. `features.py check`: feature list ok. Scanned the evidence log for credential patterns: none found

Not done / left half-way
- Fresh-session review by Claude Code against docs/plans/F11.md
- The six interview-langfuse-* Docker containers were stopped with `docker stop` (not removed) for the second R1 run, with the user's approval. Restart them with `docker start` when needed

Next
- Review F11 in a fresh session, then F12 (manual real-sandbox run) or plan F13

Pitfalls found
- The full suite takes about 30 minutes on this Mac. Pr18SequenceIT alone takes about 1058 s: 10,000 steps on real PostgreSQL, about 106 ms per step. The old 1800 s gate timeout had no margin, and V1 took 1850 s. Stopping unrelated containers did not help (1766 s → 1800 s)
- The first R1 ran overnight while the Mac kept going into maintenance sleep. It took 8+ hours, LedgerServiceIT failed one time-ordering assertion that passed 11/11 on rerun, and the run was discarded. Run long gates under `caffeinate -i` with the lid open
- Docker Hub pulls of postgres:16-alpine hung or failed with "unexpected EOF". Retrying `docker pull` succeeded once some layers were cached. Testcontainers gives up on a pull after 2 minutes, so pull the suite's images before verify
- The first `spotless:check` failed with a Maven Central read timeout, unrelated to the code; `-U` on the retry fixed it

## 2026-10-24 · session 12 · F12

### State on 2026-10-24

- passing 11/32
- active: F12 M1: real sandbox payment and partial refund
- recently passing: F07 (7c745f0), F08 (2a85752), F09 (f3ba84d), F10 (94d97fc), F11 (ab74beb)
- ready next: F13 One compose for all services

Done this session
- commit dfa69d4: F12 plan. Planning found three gaps that blocked any real run: local fixtures had only a FAKE provider account with no ingestion policy or ledger accounts; the partner revenue-share accounts were missing, so the first capture posting would throw; and the PayPal webhook switch had no env mapping
- commit d417263: plan amendment, the runbook and all new doc text in English
- commit a8e65e3: plan correction before the work commit. Test 11 step 4 snapshots business columns only, because `PaymentStateMerger#merge` always bumps the payment's `version` and `updated_at`
- commit 3505978: work commit by Codex. PayPal fixture mode, webhook switch, `PayPalSandboxFlowIT`, `ledger/scripts/paypal_sandbox_run.py` with tests, runbook. Codex reported all tests passing
- commit c39bc63: fresh-session review, no design issues, Deviations notes only. 476 unit, IdentityIT 19/19, PayPalSandboxFlowIT 2/2, script 10/10. Fast-forwarded `codex/f12-paypal-sandbox` into main
- commit 50d7636: ADR row `PAYMENT.CAPTURE.REFUNDED` resource type marked observed in sandbox (decision 10)
- Live run on the developer's Mac:
  - setup: API on 8080 and worker on 8091, run from one packaged jar; Postgres `pl-postgres` on 5434, because 5432/5433/8081 are used by other local containers; ngrok `https://teisha-rubiginous-gilbert.ngrok-free.dev`
  - webhook `8BE30672J4082781N` registered through the REST API, with the user's approval, for `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` only
  - result:

    ```
    F12 live run: PASS
    order id: 212765066K517111X
    capture id: 53C87138KN059374R
    refund id: 9CM11820VG785902L
    webhook event ids: WH-3S6588659H6941609-9N57485726595890B, WH-36B47346GH385805B-1RP83333MS3926505
    balance PSP_FEE_EXPENSE = 370
    balance SALES_REVENUE = -10000
    balance SALES_RETURNS = 2500
    balance PARTNER_PAYABLE = -1125
    balance PARTNER_SHARE_EXPENSE = 1125
    balance PSP_FUNDS = 7130
    balance SUSPENSE = 0
    ```

  - capture: $100.00 gross, $3.70 fee, $96.30 net. Partial refund: $25.00
  - the user confirmed the payment and the refund with these ids in the sandbox BUSINESS account
- Observed in the real sandbox, matching the fixtures:
  - `custom_id` is echoed on create, on capture, and in GET order refunds
  - the capture has `seller_receivable_breakdown`; the refund has `seller_payable_breakdown`
  - genuine webhooks pass `verify-webhook-signature` with the raw body
  - `PAYMENT.CAPTURE.REFUNDED` carries a refund resource (`paypal.refund`)
- Ran `python3 scripts/features.py handoff` before writing this entry. No push

Not done / left half-way
- `python3 scripts/features.py verify F12` must be run by the user in a terminal (manual feature), then the record commit
- The F11 review card ("Review F11 against its plan") was never started
- Attempt 1 left a refund stuck UNKNOWN for capture `2VE96620GC997535U`; that database was deleted (see Pitfalls), so nothing remains locally. PayPal never received that refund, but the $100.00 capture of attempt 1 is still in the sandbox merchant account, unrefunded
- Cleanup after verify: stop the API, worker and ngrok; optionally delete webhook `8BE30672J4082781N`

Next
- The user runs verify F12; then F13 (one compose for all services), or plan a feature for safe refund resend after a connect timeout (see Pitfalls)

Pitfalls found
- This network to `api-m.sandbox.paypal.com` fails intermittently: 1 of 6 timed connections never connected within 20 s. Attempt 1 lost the refund request to the 5 s connect timeout (`JdkPayPalTransport.CONNECT_TIMEOUT`):
  - the ledger recorded `TIMEOUT_UNKNOWN` / `NO_RESPONSE`, and later queries were `TRANSIENT_EMPTY`;
  - per ADR D7 a refund is never resent, so it stayed UNKNOWN;
  - a direct read of the sandbox showed the capture still `COMPLETED` with no refund, so no money moved.

  The user approved deleting the `pl-postgres-data` volume, which held only this run, and starting again.
- Attempt 2 lost the OAuth token call (`TOKEN_UNAVAILABLE`, `RETRYABLE_TRANSIENT`). The worker resent the create 8 s later and it succeeded, but the script had already exited on the 500. Rerunning the script on the same database is safe: the abandoned, never-approved payment has no postings.
- Design candidate, not in F12:
  - a connect timeout means the request never reached PayPal, and sample 09 shows a refund with the same `PayPal-Request-Id` is idempotent;
  - so a refund lost to a connect timeout could be resent safely with the original request id;
  - that changes ADR D7 and needs its own plan.
- The PayPal sandbox kept the capture fee on a partial refund (refund fee 0). The script compares against the BT amounts, so this needed no change
- The plan's decision 10 named two "spec, not yet observed" ADR rows; the ADR marks only one (`PAYMENT.CAPTURE.REFUNDED`), so only that row changed

## 2026-10-24 · session 13 · F13

### State on 2026-10-24

- passing 13/32
- recently passing: F09 (f3ba84d), F10 (94d97fc), F11 (ab74beb), F12 (50d7636), F13 (de35431)
- ready next: F14 Ledger contract for new endpoints, F15 Dispatch checkout through the ledger

Done this session
- commit 5c4c779: F13 plan. It squashes the original plan and its four amendments into one commit, at the user's request (see Pitfalls). Contents:
  - the verification's header-less `GET /graphql?query={__typename}` is rejected with 400 by Apollo Server 5's default CSRF prevention, which `@nestjs/apollo` does not override; the user chose a probe-only exemption over disabling CSRF or changing the verification
  - dispatch e2e runs on throwaway loopback containers (55432/56380) when host ports 5432/6380 are taken by other projects' containers; user's choice
  - `dotenv` moves to dispatch runtime dependencies, because `src/database/data-source.ts` imports it and `npm prune --omit=dev` removed it (Codex found `Cannot find module 'dotenv'`)
  - the dispatch lockfile is edited directly (3 lines), because `npm install --package-lock-only` (npm 11.19.0, macOS) dropped the `libc` field from four Linux-only `@css-inline` packages
  - decision 12: BuildKit cache mounts on the two Maven `RUN` lines in `ledger/Dockerfile`, user-approved after the first ledger image build failed after 2505 s on a Maven Central read timeout
- commit de35431: work commit. Root `docker-compose.yml` (8 services, only 8080/8081/4000 published, no interpolation, no secrets), `dispatch/Dockerfile` and `.dockerignore`, the probe middleware and its unit and e2e tests, `scripts/tests/test_compose.py`, the `dotenv` move, the ledger cache mounts, and the AGENTS.md lines
  - written mostly by Codex; Claude finished the build and checks after Codex ran out of quota
- Tests:
  - compose 9/9;
  - dispatch unit 51/51 (7 middleware);
  - e2e 3/3;
  - lint and typecheck clean.
- Checks 20–24:
  - images built;
  - verification rc 0 in 29 s, all eight services healthy;
  - the probe returns `{"data":{"__typename":"Query"}}`, while another header-less GET still gets 400;
  - dispatch migrations 7/7, ledger Flyway at V18;
  - after a `down`/`up` restart, the verification still passes and the data is kept.
- Fresh-session review (of the pre-squash commits, identical trees): no design issues, no review fixes
- `python3 scripts/features.py verify F13` passed against de35431 (re-run after the squash); evidence is docs/evidence/F13.log. The stack is down with its volumes kept. No push

Not done / left half-way
- Branch `codex/f13-compose` is not merged into main yet
- `redis-admin` (the user's container) is still stopped. It was stopped for 8081; restart with `docker start redis-admin`
- The F11 review card was never started

Next
- Merge `codex/f13-compose` into main, then plan F14 (ledger contract) or F15 (dispatch checkout through the ledger)

Pitfalls found
- Maven Central from inside Docker on this network stalls. A hung read waits up to Maven's 30-minute request timeout, and a failed `RUN` step is not cached, so attempts restarted from zero.
  - Fix used: `ledger/Dockerfile` cache mounts (decision 12).
  - Then a one-off, local-only seed of the BuildKit cache mount: prefetch on the host with `./mvnw dependency:go-offline -Daether.connector.requestTimeout=60000 -Daether.connector.connectTimeout=10000`, then a throwaway build that copies `~/.m2/repository` and `~/.m2/wrapper` into the mount with id `/root/.m2`. That build used `--build-context m2=$HOME/.m2` and `-o type=cacheonly`.
  - After that the image builds in about 20 s.
  - `dependency:go-offline` needs plugin dependencies that a normal host build never downloads, for example `kotlinx-coroutines-core-jvm`, so the host had to prefetch them too.
- Host ports on the developer's Mac: other projects publish 5432, 5433, 6380 and 8081. The root stack publishes nothing but 8080/8081/4000, so only 8081 had to be freed.
- `scripts/tests/__pycache__` is not ignored by the root `.gitignore`. Delete it before committing; do not stage with `git add -A`
- The dispatch lockfile resolves from `registry.npmmirror.com`. Docker builds of dispatch need that host reachable
- Too many commits per feature: F13 first had five plan commits: the plan and four amendments. At the user's request the plan and its amendments were squashed into one plan commit before pushing, which changed the work commit's hash, so verify was re-run. From now on, while the work commit does not exist and the plan commit is unpushed, a plan amendment amends the plan commit instead of adding a new one

## 2026-10-24 · session 14 · F14

### State on 2026-10-24

- passing 14/32
- recently passing: F10 (94d97fc), F11 (ab74beb), F12 (50d7636), F13 (de35431), F14 (4d0ad46)
- ready next: F15 Dispatch checkout through the ledger, F17 Liability accounts and allocation, F19 Agent clients against fixtures

Done this session
- commit 1a14ffc: F14 plan. Decisions taken with the user:
  - approval executes the refund and the liability split in one transaction;
  - a reviewer approves as submitted or rejects with a reason, with no edits;
  - the agent polls the proposal, and there is no webhook.
  
  The server URL is templated (`{scheme}://{host}:{port}`), because a literal `http://localhost:8080` trips Redocly's `no-server-example.com` warning. Codex found this, and the plan commit was amended.
- commit 58f75cc: work commit (Codex). It adds `contracts/ledger-openapi.yaml` (eight operations, OpenAPI 3.0.3, self-contained), `contracts/README.md` and `scripts/tests/test_ledger_contract.py` (12 tests).
- commit 71d56ad: review fix. It records deviations in the plan:
  - `PaymentSummary` nests `checkoutSessionId`/`latestChargeId` under `provider`, as `PaymentReader` really does;
  - some responses go beyond the plan's minimum.
- commit 4d0ad46: review fix, user's choice. A currency mismatch on `POST /v1/refund-proposals` is now `400 VALIDATION_ERROR`, detail field `currency`, instead of 422. The ledger's `ErrorCode` binds `VALIDATION_ERROR` to 400, and no new code was wanted.
- Review results:
  - tests 12/12;
  - Redocly 2.71.0: 0 errors, 0 warnings;
  - all 16 examples valid against their schemas;
  - all `RefundSummary` names and all `PaymentSummary` names exist in the reader classes.
- `python3 scripts/features.py verify F14` passed at 4d0ad46. Evidence is in `docs/evidence/F14.log`. No push.

Not done / left half-way
- Branch `codex/f14-ledger-contract` is not merged into main yet.
- These review design notes are not in the contract yet. F18 or F19 must handle them, and anything that changes the API starts in `contracts/`:
  - **The agent's credential must belong to the payment's application.** Payment and refund reads are filtered by `application_id`, so the agent needs a second `application_credential` of the application that created the payment, or it gets 404.
  - **New scopes need a migration.** The `application_credential.granted_scopes` CHECK (V2 migration) and `LocalFixtureInitializer` know only the four `payments:*`/`refunds:*` scopes. F18 adds `refund-proposals:read` and `refund-proposals:write`, and registers `ops:refund-proposal:read` and `ops:refund-proposal:review`.
  - **The three new error codes must also go into `ledger/docs/contracts/openapi.yaml`.** `ErrorCode.java` must match it code for code.
  - **The decision endpoint's precedence is undecided.** If a key is reused with a different action on a decided proposal, the contract doesn't say whether `IDEMPOTENCY_CONFLICT` or `PROPOSAL_NOT_PENDING` wins.
  - **Minor gaps:** a malformed path id returns 400, but the GET operations don't declare it; `listRefundProposals` declares 404 but no 400.

Next
- Merge `codex/f14-ledger-contract` into main, then plan F17 (liability allocation) or F15.

Pitfalls found
- Plans copy response field names from memory of the old contract. Decision 12 listed `PaymentReader`'s provider ids as top-level fields, the same mistake as F12's plan. Read the `resource(...)` method of the reader class itself when planning field lists.
- The ledger binds each error code to one HTTP status (`common/error/ErrorCode.java`). A contract must not pair an existing code with another status.

## 2026-10-24 · session 14 · F15

### State on 2026-10-24

- passing 15/32
- recently passing: F11 (ab74beb), F12 (50d7636), F13 (de35431), F14 (4d0ad46), F15 (4ad66e0)
- ready next: F16 Payment result drives order state, F17 Liability accounts and allocation, F19 Agent clients against fixtures

Done this session
- commit 99782ea: F15 plan. Two decisions were taken with the user:
  - Ledger payments only accept controlled prices (`unit × quantity`, quantity ≤ 10000). The bridge is a ledger fixture product `dispatch-order`: 1 cent, 0 bps share, with dispatch sending `quantity = amountMinor = total cents`. Checkout orders are therefore limited to USD 0.01–100.00.
  - "A retried order creation" means retries of one order's payment request. A client calling `createOrder` twice is out of scope.
- commit 19dd041: work commit, written by Codex. It contains:
  - opt-in `LEDGER_CHECKOUT`, default disabled;
  - an `order.payment` outbox event enqueued in the order transaction;
  - `HttpLedgerClient`, with outcomes accepted / pending / rejected / retryable;
  - `Idempotency-Key` and `orderKey` both `dispatch-order-<id>`;
  - order columns `ledgerPaymentId` (partial unique index) and `checkoutUrl`;
  - the ledger fixture `dispatch-order`, added on existing databases additively;
  - contract operation 9 `createPayment` and four error codes;
  - a fake ledger for e2e.
- Tests:
  - dispatch unit 61/61;
  - full e2e 73/73, checkout 10/10;
  - ledger unit 476/476, IdentityIT 21/21;
  - contract 12/12;
  - lint, typecheck and Spotless clean;
  - Redocly 2.71.0 0/0;
  - migration up/down/up clean, and `migration:generate --dryrun` finds no changes.
- Fresh-session review, two separate review-fix commits:
  - 47c4655: unit test 10 now omits each required checkout key in turn and rejects an `http` cancel URL;
  - 4ad66e0: the plan's Deviations.
- History: the review fixes were briefly squashed into the plan and work commits, then restored at the user's request: review fixes stay separate commits, and only plan amendments are folded into the plan commit.
- `python3 scripts/features.py verify F15` passed against 4ad66e0 (10/10); evidence is docs/evidence/F15.log, and the token does not appear in it. It ran on throwaway e2e databases on 127.0.0.1:55432/56380, since other projects hold 5432/6380. No push

Not done / left half-way
- The review listed four design issues, none fixed:
  1. **Most important, for F16.** The real ledger's replay returns `WAIT_FOR_CONFIRMATION` while the PayPal result is unknown or the checkout has expired, and `NONE` once the payment is paid or canceled. Dispatch treats both as "not ready", retries 5 times (about 30 s) and dead-letters a payment that is fine. The fake ledger always returns the link, so test 19 cannot show this.
  2. The outbox claim pushes `nextAttemptAt` 2 s ahead, but the ledger timeout defaults to 10 s. With several dispatch replicas, a slow call can be claimed twice. The shared key makes the second call a replay, so no second payment is created, but attempts can be double-counted.
  3. The "exactly 1 payment" assertions in e2e 14, 15, 17 and 19 cannot fail, because the fake stores payments by order key. The real evidence is that every request carries the same key. Test 15 does not check that the answer was a `200` replay.
  4. The payment-id mismatch path dead-letters the event but leaves the ledger's extra payment, which the dead event is the only trace of.
- The F11 review card was never started

Next
- Plan F16 (payment result drives order state), starting with design issue 1; or F17 (liability accounts) / F19 (agent clients)

Pitfalls found
- `AppModule` validates config at import time, so `checkout.e2e-spec.ts` imports the e2e harness dynamically after setting `LEDGER_*`, and restores the variables in `afterAll`
- Any history rewrite must happen before verify: evidence records the commit hash. F15 was verified twice for this reason; the evidence in this commit is from the restored history

## 2026-10-24 · session 14 · F16

### State on 2026-10-24

- passing 16/32
- recently passing: F12 (50d7636), F13 (de35431), F14 (4d0ad46), F15 (4ad66e0), F16 (ffcc084)
- ready next: F17 Liability accounts and allocation, F19 Agent clients against fixtures

Done this session
- commit 427afc6: F16 plan. It was amended once before the work commit, after Codex stopped on a conflict: decision 8 makes `LEDGER_NOTIFICATION_SECRET` required when checkout is enabled, so the plan now lets the two F15 test setups (the config test fixture, and the checkout e2e `envKeys` and `beforeAll`) add the secret. No F15 assertion changed.
- commit 688d926: work commit, written by Codex. It contains:
  - `paymentStatus` (`NotRequired` / `AwaitingPayment` / `Paid` / `Failed`), separate from fulfillment status, moved only by `evaluatePaymentEvent` in the order state machine;
  - `POST /webhooks/ledger`: HMAC-SHA256 over the raw body bytes (`rawBody: true`), ±300 s, a `ledger_notification` inbox keyed by eventId with a body digest (duplicate → 200, same id with a different body → 409), all in one transaction with `FOR UPDATE` on the order;
  - correlation by `orderKey` `dispatch-order-<id>`; amount, currency and full-capture checks;
  - the fix for F15 design issue 1: a replay whose next action is `NONE` now settles the outbox event instead of dead-lettering it;
  - `contracts/ledger-merchant-notifications.md` and the `ledger-payment-succeeded.json` fixture.
- Tests:
  - dispatch unit 71/71;
  - full e2e 85/85, payment-notification 11/11;
  - lint and typecheck clean;
  - migration up/down/up clean, and `migration:generate --dryrun` finds no changes.
- Fresh-session review, three separate review-fix commits:
  - f63fcd6: the receiver's `500` path logs the cause instead of a bare `catch`;
  - e74de56: import grouping and entity order;
  - ffcc084: the plan's Deviations.
- `python3 scripts/features.py verify F16` passed against ffcc084 (11/11); evidence is docs/evidence/F16.log. It ran on throwaway e2e databases on 127.0.0.1:55432/56380. No push

Not done / left half-way
- The review listed five design issues, none fixed:
  1. **Notifications are lost while checkout is disabled.** The receiver answers `404`, which the ledger treats as final. Recorded as KI-2 in `docs/known-issues.md`; decide in F24.
  2. The `applied` outcome does not check that the conditional update changed a row. The `FOR UPDATE` lock makes zero rows impossible today.
  3. The `businessKey` is not length-checked against its 256-character column. Only the ledger can sign such a key, and dispatch's keys are short.
  4. Invalid JSON gets `400` from the body parser before the `401` signature check. Nothing is stored.
  5. The exact F15 issue 1 case (a `200` replay with next action `NONE`) is covered only by unit test 8; e2e test 21 covers the first `201` answer.
- F15 design issues 2–4 are still open. `WAIT_FOR_CONFIRMATION` replays still dead-letter after 5 attempts.
- The F11 review card was never started

Next
- F17 (liability accounts and allocation) or F19 (agent clients against fixtures)
- F24 needs, on the ledger side: a public HTTPS target for dispatch, `MERCHANT_NOTIFICATION_*` with the key equal to dispatch's `LEDGER_NOTIFICATION_SECRET`, `PAYMENT_MESSAGING_ENABLED=true` on the worker, and the Kafka topic

Pitfalls found
- A config key that becomes required breaks every existing test that enables the feature. Plans must list those test setups explicitly, because the implementer may not edit existing tests on their own
- The signature covers the raw bytes, so `rawBody: true` must be set in both `main.ts` and the e2e harness's `createNestApplication`

## 2026-10-25 · session 14 · full test run and a PayPal webhook fix

### State on 2026-10-25

- passing 16/32
- recently passing: F12 (50d7636), F13 (de35431), F14 (4d0ad46), F15 (4ad66e0), F16 (ffcc084)
- ready next: F17 Liability accounts and allocation, F19 Agent clients against fixtures

Done this session
- Full run on the current code (d5c79cb), all green:
  - root compose: 8/8 healthy, the three F13 probes pass;
  - dispatch: unit 71/71, full e2e 85/85, lint, typecheck and build;
  - ledger `./mvnw verify`: no failures (671 integration tests, 3 skipped);
  - Redocly lint, script tests 21/21.
- Live sandbox run with `ledger/scripts/paypal_sandbox_run.py`:
  - order `6VU54619S8145584P`, capture `2S976987P5762051U`, refund `33107982G7973264X`;
  - ledger payment `pay_01M5QMBNBECWKTVMB07JEKF7V1`, refund `ref_01M5QMF1XD5EEA47TW2RQ7Y9F1`.
  - Capture (10000, fee 370, net 9630) and refund (-2500) are each posted once.
  - The script reported FAIL for two reasons:
    - The capture webhook stayed `WAITING` (`INCOMPLETE_CAPTURE`), the bug below.
    - Its PSP-entry and balance checks expect an empty database, and this one also holds the 2026-10-24 run. Every balance was exactly twice the single-run value, and the accounts sum to 0.
- Fix (this commit): PayPal delivered `PAYMENT.CAPTURE.COMPLETED` together with the refund event, after the refund, with the capture's status at send time, `PARTIALLY_REFUNDED`. `PayPalWebhookFacts.capture` only accepted `COMPLETED`, so the event waited forever.
  - It now accepts `PARTIALLY_REFUNDED` and `REFUNDED` as captured, mapped as `PayPalOrderMapping` maps a GET: the raw status, no settlement of its own.
  - `DECLINED`, `FAILED` and `PENDING` are still rejected.
  - Tests: unit `lateCaptureSnapshotEqualsOrderQueryFacts`, plus two rejected statuses. IT `captureEventArrivingAfterRefundIsDoneAndPostsNothing` reproduced the `WAITING` row before the fix.
  - Checks: ledger unit 477/477; `PayPalWebhookPostingIT` 13/13 and `PayPalSandboxFlowIT` 2/2; Spotless clean.
  - ADR row for `PAYMENT.CAPTURE.COMPLETED` updated.

Not done / left half-way
- The stuck inbox row for capture `2S976987P5762051U` is still `WAITING` in the local ledger database. Its `available_at` lets the processor retry it the next time the ledger runs with this code; it should then become `DONE` without posting anything.
- The live-run script assumes an empty ledger database; rerunning it on a used one always fails the balance checks. Recreate the database first, or teach the script to compare deltas.
- The merchant-account check for this run is the user's.

Next
- F17 (liability accounts) or F19 (agent clients)

Pitfalls found
- PayPal can deliver webhooks late and in any order; the resource in a webhook shows its state at send time, not at the event's time

## 2026-10-25 · session 15 · F17

### State on 2026-10-25

- passing 17/32
- recently passing: F13 (de35431), F14 (4d0ad46), F15 (4ad66e0), F16 (ffcc084), F17 (f871a5d)
- ready next: F18 Refund proposal API and review, F19 Agent clients against fixtures

Done this session
- commit 7f31988: F17 plan. It was corrected twice before the work commit: SQL moved into a repository (`LayeringArchitectureTest`), and migration counts allowed to move by one.
- commit 557405f: liability split and posting (Codex):
  - allocation rule: restaurant and driver floored, platform gets the remainder;
  - three new INTERNAL accounts and the `L-LIABILITY` journal;
  - `V19__refund_liability.sql`, the posting worker, and `GET /v1/refunds/{id}/liability`;
  - 15 unit tests and 11 ITs;
  - 8 existing migration-count assertions each moved by +1.
- commit cd776cc: review. The code matched the plan; four design issues were listed.
- Review fixes, decided with the user:
  - 2575124 (RF-1): attempt cursor, so stuck rows rotate instead of blocking the worker (head-of-line blocking, `docs/challenges.md` C-1);
  - 19308a2 (RF-2): first HTTP test of the endpoint. It caught `journalId` missing from the JSON: global `non_null` inclusion versus the F14 contract's required field. Fixed by writing the null explicitly (C-2);
  - e1f3485 (RF-3): `LIABILITY_ENABLED` / `LIABILITY_POLL_MS` in `application.yml`;
  - be28448 (RF-4): failure logs carry error class and code or SQL state; stuck rows warn at attempts 10, 100, 1000.
- commits e06d403 and b19d17b: plan corrections for the RF-1 test (token fixture, attempt counts 3 / 2 / 1).
- New `docs/challenges.md`: real bugs and difficulties, for the submission write-up (C-1, C-2).
- Checks on f871a5d:
  - `verify F17` passing;
  - ledger unit tests 496/496;
  - full `./mvnw verify`: 684 integration tests, 3 skipped, 0 failed (33 min 50 s);
  - Spotless clean.

Not done / left half-way
- Open F17 risks, all recorded in the plan:
  - a refund that fails after posting keeps its liability journal;
  - allocations for failed refunds stay `PENDING`;
  - a restaurant that is also a revenue-share partner is charged twice.
- V19 was edited in place during review. It has only ever run in Testcontainers. After this merge is pushed, any change needs V20.

Next
- F18: refund proposal API and review. It calls `LiabilityService.record` inside the approval transaction. F18 also adds the foreign key from `refund_liability.proposal_id` to the proposal table.

Pitfalls found
- `LayeringArchitectureTest` forbids `JdbcTemplate` outside `..repository..` packages, and its exemption list may only shrink. Plans for ledger services must put SQL in a repository.
- Several schema ITs pin the number of migrations; every new migration moves each of them by one.
- `PayPalTestTransport` replies are strict FIFO, and `PayPalAuthClient` caches its token. Queue `token()` only before the first PayPal call of an adapter in a test.
- A test that calls a service directly does not see global Jackson settings. Contracted endpoints need one HTTP test each.

## 2026-10-25 · session 15 · F18

### State on 2026-10-25

- passing 18/32
- recently passing: F14 (4d0ad46), F15 (4ad66e0), F16 (ffcc084), F17 (f871a5d), F18 (11d3710)
- ready next: F19 Agent clients against fixtures

Done this session
- commit 777b345: F18 plan. It covers the five remaining F14 contract operations (refundable amount, create and read a proposal, the ops list, the ops decision), V20, and roles and scopes.
- commit 705b9e5: refund proposals (Codex):
  - package `proposal`, with SQL in `proposal/repository` and pure rules in `proposal/domain`;
  - `V20__refund_proposals.sql`: the table, the guard trigger, the deferred check that an approved proposal has its liability allocation, and the two new application scopes;
  - approval in one transaction: proposal lock, then the existing refund reservation, then `LiabilityService.record`, then the audit row;
  - the local reviewer fixture;
  - 18 service tests and 2 HTTP tests;
  - 8 migration counts each moved by +1.
- Review (fresh session):
  - d3e2410: rollback test after the reservation;
  - 09aab9f: field order and decision replay checked over HTTP;
  - acc5fd9: Deviations.

  The production code matched the plan; four design issues were listed.
- Review fixes, decided with the user:
  - 10c2433 (RF-1): existing local databases gain the proposal scopes and `local-reviewer`;
  - 3145e52 (RF-2): approved refunds are reserved under a secret per-proposal `refund_key`. `prop_…` encodes the proposal UUID reversibly, so the old key could be pre-empted;
  - e8c38b0 (RF-3): a decision `Idempotency-Key` belongs to one proposal.
- Issue 4 recorded as `docs/known-issues.md` KI-3: an approved proposal whose refund fails still reads `APPROVED`, and its allocation stays `PENDING`.
- commits 86dd6c7, b3507c1, 11d3710: plan updates for the review fixes, their test corrections, and the recorded hashes.
- Checks on 11d3710:
  - `verify F18` passing;
  - ledger unit tests 517/517;
  - full `./mvnw verify`: 687 integration tests, 3 skipped, 0 failed (33 min 29 s);
  - Spotless clean.

Not done / left half-way
- KI-3 is open.
- V20 was edited in place during review and has only ever run in Testcontainers. After this merge is pushed, any change needs V21. A local database that ran an earlier V20 must be recreated.
- No ops UI page for proposals yet. Reviewers use the ops API (`ledger/docs/runbook/refund-proposals.md`).

Next
- F19: typed agent clients against recorded fixtures (dispatch GraphQL and ledger REST), built against `contracts/ledger-openapi.yaml`.

Pitfalls found
- `prop_…`, `ref_…` and the other ledger ids are reversible encodings of the stored UUIDs. Never treat an internal UUID as a secret.
- `PaymentRequests.idempotencyKey` requires 8 to 255 printable characters. Short keys in test plans fail validation.
- When a review fix changes a stored key's format, every test that asserts the old format must be listed for change in the plan.
- `LocalFixtureInitializer` returns early on an existing database. Each new fixture needs an idempotent upgrade path there too.

## 2026-10-27 · session 16 · F19

### State on 2026-10-27

- passing 19/32
- recently passing: F15 (4ad66e0), F16 (ffcc084), F17 (f871a5d), F18 (11d3710), F19 (bd0e86a)
- ready next: F20 Policy checks

Done this session
- commit 63d4430: F19 plan. Decided with the user: dispatch gains an order event log (`order_event`, written in the change's own transaction) and the read-only `orderTimeline` query; the agent authenticates to dispatch with a read-only service token (`AGENT_SERVICE_TOKEN`, header `X-Service-Token`, `getOrder` and `orderTimeline` only), not a user role. Amended once before the work commit: Codex found that `@nestjs/graphql` emits enum keys on the wire, so `OrderEventKind` keys now equal their values, and test D4b checks the wire spellings.
- commit ff57a52: work commit (Codex). The agent package `fairsettle_agent.clients` (async dispatch and ledger clients, Pydantic models with strict integer cents, typed errors, `FixtureReplay`); the dispatch migration, entity, write sites, guard and query; `contracts/dispatch-agent-operations.graphql`; 11 fixtures in `contracts/fixtures/agent/`, recorded by `dispatch/test/agent-fixtures.e2e-spec.ts` and `AgentFixturesHttpIT` and shape-checked by the same tests without `RECORD_AGENT_FIXTURES`. D16 is a real concurrent test: a fulfillment callback that loses a race now rolls back with 500 instead of answering 200.
- Review (fresh session): 348cd30 names the `order_event` foreign key as in the migration, so `migration:generate` reports no drift; bd0e86a records the findings under Deviations.
- Checks on bd0e86a (review session): verification command 20/20; dispatch unit 75, e2e 98 across 9 specs; the whole ledger IT suite green (3 real-provider skips); typecheck, lint and Spotless clean.
- `python3 scripts/features.py verify F19` passed at bd0e86a; evidence is `docs/evidence/F19.log`. No push.

Not done / left half-way
- `ledger-payment-captured.json` is not a real capture: `refundBody` sets the captured state by SQL, so the fixture shows `SUCCEEDED` with `providerStatus` `requires_payment_method`, `financialStatus` `NOT_APPLICABLE` and recovery `WAITING`. F19 uses only its amounts. F20/F21 must decide whether to re-record it through a fake-provider capture or to read only amount fields.
- `docker-compose.yml` sets no `AGENT_SERVICE_TOKEN`, so service access is off in the stack until a later feature provisions it (F22, F24). The agent's real ledger credential is also still F22's.
- Branch `codex/f19` is not merged into main yet.

Next
- Merge `codex/f19` into main, then plan F20 (policy checks), starting with the fixture question above.

Pitfalls found
- `@nestjs/graphql` builds GraphQL enum values from the TypeScript enum's keys, while TypeORM stores its values. Keep keys equal to values for any enum another service reads.
- A conditional `UPDATE` whose `affected` count is ignored can report success for a change that never happened. Check `affected` at every write site, especially before recording an event.
- The dispatch e2e on this Mac needs throwaway PostgreSQL/Redis on 127.0.0.1:55432/56380 and an uncommitted `.env.test`. Maven needs JDK 21 (Homebrew `openjdk@21`); the shell default is 17.
- `python` exists only inside `agent/.venv`; run `verify F19` in the shell where the venv is activated.

## 2026-10-27 · session 16 · F20

### State on 2026-10-27

- passing 20/32
- recently passing: F16 (ffcc084), F17 (f871a5d), F18 (11d3710), F19 (bd0e86a), F20 (c0d4876)
- ready next: F21 Gather and decide

Done this session
- commit 7a6c2d9: F20 plan. The agent PRD (2026-10-22) is not in the repository; the user supplied it as a PDF, and the plan copies the parts F20 relies on: the `RefundDecision` contract, the seven hard rules, the refund-cap table and the ten evaluation scenarios. Decided with the user: the late-delivery cap is a fixed `PolicyConfig.delivery_fee_cents` (default 299), since dispatch orders have no delivery-fee field; the 7-day complaint count is an input to the rules, and counting it is F22's.
- commit c0d4876: work commit (Codex). `fairsettle_agent/decision.py` (strict schema, no coercion), `evidence.py` (one run's evidence and its citable ids: `order:`, `order-item:`, `order-event:`, `payment:`, `refundable:`), `policy.py` (six `check_*` pure functions and `evaluate`). Any violation escalates with every reason in rule order, and `evaluate` returns the input decision object unchanged: nothing trims an amount.
- Review (fresh session): no defects and no review fixes. It mutation-tested P30 (an `os` import, an `httpx` import, a float literal and `float` each make it fail).
- `python3 scripts/features.py verify F20` passed at c0d4876 (38 tests, P27 runs 9 scenarios); the whole agent suite is 58. Evidence is `docs/evidence/F20.log`. No push.

Not done / left half-way
- `delivery_fee_cents` 299 is a placeholder until dispatch has a real delivery fee; until then a late-delivery refund over 299 escalates.
- PRD scenario 9 (an unconfirmed PayPal capture) is not a hard rule; F21 must escalate it during evidence gathering.
- F19's `ledger-payment-captured.json` finding is still open for F21 and F27; F20 does not read the status fields it gets wrong.
- Branch `codex/f20` is not merged into main yet.

Next
- Plan F21 (gather and decide): evidence gathering in parallel without the model, the schema retry, evidence ids shown to the model, scenario 9, and the fixture question.

Pitfalls found
- In Pydantic strict mode, `model_validate_json` accepts JSON arrays for tuple fields, but `model_validate` with a Python `list` is a `tuple_type` error. Build decisions from JSON, or pass tuples from Python.
- The PRD's design principles are not in the repository. Keep the PDF where the next planner can read it, or add it to `docs/`.

## 2026-10-29 · session 16 · F21

### State on 2026-10-29

- passing 21/32
- recently passing: F17 (f871a5d), F18 (11d3710), F19 (bd0e86a), F20 (c0d4876), F21 (15d1ff5)
- ready next: F22 Propose, pause, resume

Done this session
- commit e3ada7e: F21 plan. Decided with the user: keep LiteLLM (compared with a vendor SDK); DeepSeek, with `deepseek/deepseek-flash` for development and `deepseek/deepseek-v4-pro` for evaluation and the demo (`FAIRSETTLE_MODEL`), key `DEEPSEEK_API_KEY` from the environment only; Python stays 3.11 (the PRD says 3.12, a recorded difference). Checked while planning, with the network blocked: litellm 1.106.5 resolves with the existing pins; importing it fetches a price map unless `LITELLM_LOCAL_MODEL_COST_MAP=True`; DeepSeek supports `json_object` only, not `json_schema`, and may return empty content; `mock_response` exercises the real litellm path but cannot produce empty content.
- commit d17dafd: work commit (Codex). `complaint.py`, `gather.py` (two parallel rounds, only `ClientError` caught, PRD scenario 9 escalates on an unsettled payment), `model.py` (verbatim system prompt, evidence document with citable refs, data markers, strict parsing that tolerates only a code fence), `decide.py` (exact `acompletion` arguments, one retry on invalid output, none on provider errors, F20's `evaluate`, a `RunRecord` without complaint text or replies). Pins `litellm==1.106.5`, `openai==2.54.0`. Codex reran the suite with the key unset and a `sandbox-exec` firewall.
- Review (fresh session): b9976dd makes D1 connect to `127.0.0.1:9` instead of `example.com`, so it no longer depends on DNS; 15d1ff5 records it under Deviations. No design issues.
- Checked here: with name resolution failing and numeric addresses working (a real outage), the verification command passes 26 and the agent suite 84; the old D1 fails under the same condition.
- `python3 scripts/features.py verify F21` passed at 15d1ff5 (26 tests); evidence is `docs/evidence/F21.log`, which contains no key. No push.

Not done / left half-way
- No real DeepSeek call has been made yet. F27 is the first run against the model and measures how often the retry still fails.
- Production must set `LITELLM_LOCAL_MODEL_COST_MAP=True` too (F24/F29).
- F19's `ledger-payment-captured.json` finding is still open for F27. F21 reads only `payment_status` and `resolution_status`.
- Branch `codex/f21` is not merged into main yet.

Next
- Plan F22 (propose, pause, resume): LangGraph with a Postgres checkpointer, the ledger proposal (`complaint_id` as idempotency key, lowercase-to-contract enum mapping), counting complaints per customer for rule 6, and provisioning the agent's ledger credential (F14 note: it must belong to the payment's application).

Pitfalls found
- A network guard on `socket.connect` does not cover name resolution. A test that connects to a host name fails with `gaierror` when DNS is down; connect to a literal address.
- To simulate an outage, break name resolution for host names only. Making `getaddrinfo` fail for numeric addresses too is stricter than any real outage and fails tests for the wrong reason.
- One pytest warning comes from a third-party Pydantic `ReadOnly` deprecation in litellm's dependency chain; it is not ours.

## 2026-10-30 · session 17 · F22

### State on 2026-10-30

- passing 22/32
- recently passing: F18 (11d3710), F19 (bd0e86a), F20 (c0d4876), F21 (15d1ff5), F22 (edceee7)
- ready next: F23 Execute and trace

Done this session
- commit 7b09a4d: F22 plan. Decided with the user: count complaints per customer in the agent's own `agent_complaint` table (F21's `Complaint` unchanged, callers submit `ComplaintInput`); Testcontainers `postgres:16` for tests, which fail without Docker and never skip; the agent's ledger credential from the environment only (seeding is F24's); proposal fixtures recorded from the real ledger; F19's plain `ops_` credential check narrowed to the ops token shape, since a decided proposal contains `OPS_REVIEWER`. Checked while planning: the node that calls `interrupt()` runs again from its first line on resume; `Command(resume=…)` on a thread with no checkpoint silently starts a new run; a node that raised is re-run alone by `ainvoke(None)`; unregistered Pydantic types in state only warn now and will be blocked, so state is JSON only. Amended twice before the work commit, both after Codex stopped: Step 4 records only `AgentFixturesHttpIT#recordsRefundProposals`, because recording the whole class rewrites the five F19 ledger fixtures; Ryuk is disabled in `conftest.py`.
- commit 316eb8e: work commit (Codex). `proposal.py` (decision → contract request, fixed party order so retries replay), `store.py` (registry, 7-day count, run status), `graph.py` (gather, count, decide, submit, await_review, finish), `agent.py` (`Agent.start` / `poll`, `AgentConfig.from_env`, `open_persistence`, `open_agent`), proposal client methods and models, seven recorded `ledger-proposal-*` fixtures, `AgentFixturesHttpIT.recordsRefundProposals` (ledger test code only). R13 and R23 restart in a separate process; R23 kills it between the POST and the checkpoint and recovers through the ledger's idempotent replay.
- Review (fresh session): c159d3a makes R11 check that the complaint text is contained in no `agent_complaint` column (it only checked equality); edceee7 records it and three accepted small differences under Deviations. No design issues. Review reported 28/28, agent suite 112/112, `AgentFixturesHttpIT` 3/3.
- `python3 scripts/features.py verify F22` passed at edceee7 (28 tests); evidence is `docs/evidence/F22.log`, which contains no key. No push.

Not done / left half-way
- Branch `codex/f22` is not merged into main yet.
- No long-running process calls `poll()` yet, and the agent has no compose service or ledger credential in the stack (F24).
- A crash before `submit` leaves the row `running`; `poll` does not resume it (plan, Risks). F24 decides whether startup restarts such threads.
- One agent process per database: the lock in `Agent` is per process.

Next
- Merge `codex/f22` into main, then plan F23 (execute and trace): after `approved`, follow `refundId` through `GET /v1/refunds/{id}` (KI-3: an approved proposal whose refund fails still reads `APPROVED`), and Langfuse traces by complaint id, with `agentRun.traceId`.

Pitfalls found
- testcontainers-python 4.15.0's Ryuk fails on Docker Desktop for Mac in two ways: it reads Ryuk's port mapping once with no retry (`Port mapping … port 8080 is not available`), and it mounts the Mac's socket path, which does not exist in Docker Desktop's VM (`mkdir /host_mnt/…/docker.sock: operation not supported`). `TESTCONTAINERS_RYUK_DISABLED=true` plus stopping the container in `finally` fixed both. After a hard kill, remove leftovers with `docker rm -f $(docker ps -aq --filter label=org.testcontainers.lang=python)`.
- `RECORD_AGENT_FIXTURES=1` overwrites every fixture the selected tests touch. Record a new fixture with `-Dit.test='Class#method'`, then check all shapes without the variable.
- psycopg connects through libpq, so the agent tests' `socket.socket.connect` guard does not cover the database; the Docker SDK does use Python sockets, so the container must start in a session fixture, before the function-scoped guard.

## 2026-10-30 · session 18 · F23

### State on 2026-10-30

- passing 23/32
- recently passing: F19 (bd0e86a), F20 (c0d4876), F21 (15d1ff5), F22 (edceee7), F23 (865cd24)
- ready next: F24 M2: full chain with PayPal

Done this session
- commit 0ec662b: F23 plan. Decided with the user: refund following lives in the graph (one thread for the whole life cycle, so R13, R15 and R28 in `test_resume.py` change deliberately); Langfuse gets metadata only (the F21 `RunRecord` rule); one recorded `RESERVED` refund fixture, with terminal states built in memory; tracing is required unless `FAIRSETTLE_TRACING=off`. Checked while planning: `langfuse==5.0.4` and `opentelemetry-sdk==1.45.1` resolve with every existing pin; an in-memory exporter makes no connection, but `get_trace_url()` does. Amended three times before the work commit: no `refund_id` column (it would have broken F22's R11), `providerRefundId` / `providerStatus` default to None (the ledger omits null keys), and E16's definition of a root span.
- commit 77069b3: work commit (Codex). `execution.py` (`refund_outcome`, `refund_resume_value`), `tracing.py` (`Tracing`, `TracingConfig`; trace id `Langfuse.create_trace_id(seed=complaint_id)`, session id = complaint id), graph nodes `approved` and `await_refund`, statuses `refunded` and `refund_failed` (the status check is replaced in one transaction), `Agent.poll` reads `GET /v1/refunds/{id}` after checking `state.next`, `agentRun.traceId` only when tracing is on, `LedgerClient.get_refund`, the recorded `ledger-refund-reserved` fixture and `AgentFixturesHttpIT.recordsApprovedRefund` (ledger test code only). Codex reported 19, 28 and 131 passed, and with Docker stopped 97 passed and 34 Docker errors.
- Review (fresh session): e88958a makes E6 also reject a `_send` whose method is not a literal and any direct use of `self._http` other than `build_request`, `send` and `base_url`; ab810a9 makes E17 check that `retry_submit` is a root span, as the plan says; 865cd24 records both under Deviations. Review reran 19, 28 and 131 passed, and `AgentFixturesHttpIT` 4 passed without `RECORD_AGENT_FIXTURES`. Also checked: building `Tracing` leaves OpenTelemetry's global tracer provider untouched.
- `python3 scripts/features.py verify F23` passed at 865cd24 (19 tests); evidence is `docs/evidence/F23.log`. No push.

Not done / left half-way
- Branch `codex/f23` is not merged into main yet.
- Open design issues from review, not fixed:
  - Switching `FAIRSETTLE_TRACING` while a complaint is `submit_retry` changes the retried POST body (`traceId` added or removed); the ledger may answer `IDEMPOTENCY_CONFLICT`, and the complaint escalates as `proposal_refused`. Keep the setting fixed for a deployment, or have the ledger's idempotency comparison ignore `agentRun.traceId`.
  - `RefundProposal.refund_id` accepts any `[a-z]+_` prefix, while `get_refund` accepts only `ref_`. A different prefix would raise `ValueError` (not `ClientError`) in `poll()`, stopping every pass before later rows.
  - Small: `finish`'s `"APPROVED": "approved"` mapping can no longer be reached; `approved_thread` in `resume_factory.py` imports `asyncio` inside the function.
- The contract's `RefundSummary` lists `providerRefundId` and `providerStatus` as required and nullable; the ledger omits them when null (`docs/challenges.md` C-2). The agent accepts both. Making the contract say optional, or the ledger write explicit nulls, is a later contract change.
- No live Langfuse trace and no real terminal refund yet (F24). A refund that never becomes final keeps the complaint `approved` and is read on every `poll()`.

Next
- Merge `codex/f23` into main, then plan F24 (full chain with PayPal): the long-running `poll()` process, the agent's compose service and ledger credential (it needs `refunds:read`), a Langfuse server version that works with SDK 5.0.4, and a real sandbox refund to `SUCCEEDED`.

Pitfalls found
- Langfuse clients are singletons per public key: a second `Langfuse(...)` with the same key reuses the first exporter, even after shutdown. Tests use a new public key for each client.
- An observation opened with `trace_context` always has a parent: Langfuse 5.0.4 gives it a non-recording parent span that is never exported. Find roots by "no exported parent", not `parent is None`.
- `Langfuse.get_trace_url()` connects to the server to fetch the project id; never call it in the agent or tests.
- Maven needs JDK 21; the shell default here is 17. Set `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` per command.

## 2026-10-30 · session 19 · F24

### State on 2026-10-30

- passing 23/32
- active: F24 M2: full chain with PayPal
- recently passing: F19 (bd0e86a), F20 (c0d4876), F21 (15d1ff5), F22 (edceee7), F23 (865cd24)

Done this session
- commit 907b9e5: F24 plan (live compose overlay with self-hosted Langfuse 4.58.0, FastAPI agent service, agent fixture credential 42, English proposal review page, `scripts/m2_live_run.py`, runbook `docs/m2-live-run.md`). Amended twice before the work commit: English-only notices on the review page; the read-only `delivery_task` query and `scripts/__pycache__` cleanup.
- commit 61d6a83: work commit (Codex). Codex reported agent 143, root scripts 44, page tests 42, IdentityIT and PageHttpIT 31, ledger unit 517 passed; Docker build and in-image import pass.
- Review (fresh session): bfc6de0 and 5e2aade (blank lines), 52efdfc (`.env.live` values must not contain shell or interpolation characters), 8c14dcc records them under Deviations. Reran all named suites green.
- commit 07805ad: plan amendment after review (user decision): `main()` prints the summary and exits 2 on any unexpected exception, with new test M14. commit d014332 implements it (Codex); 45 root script tests pass.
- commit 0fd2e78: runbook Troubleshooting for `HELD` / `INVALID_DESTINATION` caused by fake-IP DNS (see Pitfalls), recorded under Deviations.
- Live run on the PayPal sandbox, script summary:

```
F24 live run: PASS
dispatch order id: 1
ledger payment id: pay_01M66HBBHGWVD58ZYGQR7MCK6Y
paypal order id: 7KR80011U08627743
paypal capture id: 6EK05389VT454793L
complaint id: complaint-m2-20261030225248
proposal id: prop_01M66HWK7QWWF99DZHHSDNZC1Q
ledger refund id: ref_01M66HZSTJPZX03DCJPBCC56JP
paypal refund id: 6AS25386B8603770P
refund amount: 300 USD
liability RESTAURANT 10000 bp = 300
liability DRIVER 0 bp = 0
liability PLATFORM 0 bp = 0
liability journal id: 59668f28-b92a-44a3-ba1d-7ffadbd31780
trace: http://localhost:3000/project/fairsettle-local/traces/bd653726fc552479c613ca4cf80b2bbf
```

- The agent (DeepSeek `deepseek-v4-pro`) proposed `PARTIAL_REFUND` 300 cents, `MISSING_ITEM`, restaurant 10000 bp, citing `order-item:2` and `order:1`; a human approved it unchanged on the review page.

Not done / left half-way
- A verify run on 2026-10-30 before any live run was confirmed by mistake; its uncommitted `docs/features.json` and `docs/evidence/F24.log` were discarded and F24 went back to `active`.
- Branch `codex/f24` is not merged into main yet. The live stack and the ngrok tunnel are still running; stop them with the runbook's Cleanup.
- Open design issues from review, not fixed: the review page's notice when a second decision is refused reads like a lost response; after a decision the page always reloads the `PENDING_REVIEW` list; `ledger-notification-target` writes the target row as `payments_migrator`, while the research notes name the configuration role.
- `dispatch/frontend` (the Next.js storefront) ignores `checkoutUrl` and `paymentStatus` and is not in compose; it defaults to port 3000, which Langfuse uses here. The user decided to add a feature for it after F24 and before F28; the user adds the entry to `docs/features.json`.

Next
- Merge `codex/f24` into main, then add the storefront PayPal feature and plan it.

Pitfalls found
- A local proxy with fake-IP DNS (here Shadowrocket, resolver `198.18.0.2`) makes Docker Desktop resolve the ngrok host to `198.18.x.x`; the ledger's `NotificationTargetPolicy` refuses that range, so every notification task is `HELD` with `INVALID_DESTINATION` and dispatch never becomes `Paid`. Fix: `always-real-ip = *.ngrok-free.dev` in the proxy, then wait 60 seconds for the held tasks to be checked again.
- The script prints nothing while it waits (payment, `Paid`, the agent's decision); check progress with the runbook's read-only `delivery_task` query and `logs agent` instead of assuming it is stuck.

## 2026-10-31 · session 20 · F33

### State on 2026-10-31

- passing 24/33
- active: F33 Storefront pays through PayPal
- recently passing: F20 (c0d4876), F21 (15d1ff5), F22 (edceee7), F23 (865cd24), F24 (0fd2e78)
- ready next: F27 Evaluation suite, F25 Proactive trigger, F26 Investigate node

Done this session
- commit c5cf239: F33 plan. Decided with the user: the order page triggers capture through a new customer-only `refreshOrderPayment` (the ledger captures an approved PayPal order only when its payment is read); PayPal's return goes to dispatch `/checkout/success` / `/checkout/cancel`, which redirect to the storefront; no client-side fees; all fake data removed from the order path; Chinese UI text; the storefront runs in the live overlay on 127.0.0.1:3001; the missing dish-belongs-to-restaurant check is KI-5.
- commit 80912ae: F33 added to `docs/features.json` by the user (script run by hand), F28 now depends on F33.
- commit 535a7ad: work commit (Codex). Codex reported dispatch unit 79, e2e 107 (98 + 9), storefront vitest 5, root scripts 46; storefront type check, production build and Docker build pass.
- Review (fresh session): 8ef73db makes the order page refresh once the customer is known (on a full page load after PayPal, the order could load before `me`, so the one-shot refresh was skipped and nothing captured); 4c10401 sorts the ledger module imports; e82f719 records both under Deviations. Review reran every suite green.
- Live check on the PayPal sandbox (stack rebuilt from `codex/f33`): storefront order 2, Margherita, 1200 cents; ledger payment `pay_01M66S55ZYSWJ10WTF8JZYVA3J`, PayPal order `0KR118477V189483U`, capture `5CM75026VV198534F` (`COMPLETED`, 1200 captured); every notification `DELIVERED`; the storefront order page showed 已支付.
- The live check found that checkout dropped cart quantities: dispatch's `createOrder` has no quantity, and the storefront sent one item per cart line, so four Margheritas ($48.00) became a $12.00 order (order 4, left unpaid; order 3 also unpaid). commit 70fcbe4 (review fix, test first) sends one item per unit through `orderItemsFromCart`; storefront 9 tests, `tsc` and `next build` pass.
- Live check after the fix: storefront order 5, five Margheritas, 6000 cents, matching the cart; ledger payment `pay_01M66SMNKN6TCYNKPKMSE87P4H`, PayPal order `5B364987DH5879225`, capture `9YE330191U532992V` (6000 captured, `succeeded`); notifications `DELIVERED`; order page 已支付.

Not done / left half-way
- Branch `codex/f33` is not merged into main yet. The live stack and the ngrok tunnel are still running; stop them with the runbook's Cleanup.
- KI-5 (`createOrder` accepts dishes from another restaurant) is recorded, not fixed.
- The quick demo login keeps its built-in demo passwords; F29 must decide before the storefront is public.

Next
- Merge `codex/f33` into main, then F28 (complaint UI) or F27 (evaluation suite).

Pitfalls found
- Next 14 bakes `rewrites()` destinations into the build: the storefront image needs `BACKEND_GRAPHQL_URL` / `BACKEND_UPLOADS_URL` as build arguments, not runtime env.
- A client page that waits for two queries (`getOrder` and `me`) must not consume a one-shot effect guard before both have loaded.
- Dispatch order items are units, not lines: any client must repeat a dish to order it twice. Check the charged amount against the cart, not only the status.
- Ledger, not investigated: after a PayPal payment succeeds, its `CREATE_CHECKOUT` recovery task stays `WAITING` and keeps querying PayPal although the operation is `RESOLVED` (order 2: 10 attempts, order 5: 5 within minutes), while the `CAPTURE_ORDER` task goes `DONE`. The F24 payment (`7KR80011U08627743`) shows where this ends: both tasks `ESCALATED` with `UNRESOLVED_AGE_LIMIT` and the payment's `resolution_status` back to `UNKNOWN`, although it is `SUCCEEDED`, captured and refunded. No money moved wrongly, but every successful PayPal payment becomes an escalation for a person. The ops console shows it as recovery `WAITING`.

## 2026-11-01 · session 21 · F34

### State on 2026-11-01

- passing 25/34
- active: F34 Settled payment recovery finishes
- recently passing: F21 (15d1ff5), F22 (edceee7), F23 (865cd24), F24 (0fd2e78), F33 (70fcbe4)
- ready next: F27 Evaluation suite, F28 Complaint UI, F25 Proactive trigger

Done this session
- commit 0a87ee9: KI-6 recorded. A read-only diagnosis (separate session, notes `paypal-recovery.md`) found two defects behind the recovery `WAITING` seen in the F33 live check: `OperationLeaseRules.paymentTaskDone` never finished a `CREATE_CHECKOUT` task whose payment succeeded with certainty, and `PaymentEvidenceRules.decide` turned a read with no evidence into `UNKNOWN` even for a settled payment, which the unresolved-age limit then escalated (the F24 payment `7KR80011U08627743`).
- commit cc0c99f: F34 plan. Decided with the user: fix both defects; verify by command (unit tests plus `PayPalCaptureIT` and `OperationRecoveryIT`); the escalated F24 payment is out of scope. Amended once before the work commit after Codex stopped: units and ITs are run separately to see the expected failures (Surefire stops before Failsafe), and U3 is written last because `noEvidence` did not exist yet.
- commit 9cf1208: F34 added to `docs/features.json` by the user (script run by hand); F29 now depends on F34.
- commit acf81f7: work commit (Codex). Before the fix: units 33 passed and 3 failed (the two changed `CREATE_CHECKOUT` assertions and U2), ITs 30 passed and exactly I1–I4 failed, U3 did not compile. After: the verification command 37 unit and 34 IT tests, `spotless:check`, all 519 unit tests, and one full `./mvnw verify` (699 ITs, 3 skipped) passed.
- Review (fresh session): no issues and no review fixes; reran the verification command, `spotless:check` and F06's verification command green.

Not done / left half-way
- Branch `codex/f34` is not merged into main yet.
- The F24 payment `7KR80011U08627743` in the local live database stays `ESCALATED`/`UNKNOWN` (KI-6 Resolution); the F33 payments' `WAITING` create tasks heal on their next successful query once the stack runs F34's code.
- The live stack and the ngrok tunnel may still be running from F33.

Next
- Merge `codex/f34` into main, then F28 (complaint UI) or F27 (evaluation suite).

Pitfalls found
- Surefire stops the build at the first failing unit test, so a single `verify` cannot show unit and IT failures together; run them separately (`-Dtest='NoSuchTest' -Dsurefire.failIfNoSpecifiedTests=false` for ITs only).
- A test that calls a method the plan adds later does not compile before the implementation; write it last and count the compile error as its failure.
- In a restricted sandbox, Mockito's JVM attach and local sockets fail; rerun outside the sandbox before suspecting the code.

## 2026-11-01 · session 22 · F25

### State on 2026-11-01

- passing 26/34
- active: F25 Proactive trigger
- recently passing: F22 (edceee7), F23 (865cd24), F24 (0fd2e78), F33 (70fcbe4), F34 (acf81f7)
- ready next: F27 Evaluation suite, F28 Complaint UI, F26 Investigate node

Done this session
- commit 716fb1a: F25 plan. Decided with the user:
  - a new terminal order status `DeliveryFailed`, only from `PickedUp`, with `failureReason` `DRIVER_FAULT` or `PLATFORM_FAULT` on its order event;
  - the agent pulls the new service-token query `deliveryFailures(afterEventId, limit)` from its poll loop, with a cursor in `agent_trigger_cursor`;
  - the provider callback and the assigned driver may report a failure (no storefront change);
  - proactive cases (`delivery-failed-<orderId>`) neither count toward nor are limited by the 7-day complaint total;
  - `FAIRSETTLE_PROACTIVE` defaults on.

  Amended twice before the work commit after Codex stopped:
  - the migration's `down` enum swap is written out as SQL, with `DROP DEFAULT` / `SET DEFAULT`, because `FixSchemaTypos` only renames a value in place;
  - `EXPECTED_NAMES` in `agent/tests/test_clients.py` gains the three new fixtures.
- commit b1ef767: work commit (Codex). Contract first. Dispatch: migration `1790000003000-DeliveryFailure`, state machine, `failureReasonCheck`, `deliveryFailures`, webhook reasons, re-recorded agent fixtures. Agent: `proactive.py`, client, store cursor, graph prior count 0, prompt and evidence carry `failureReason`, poll loop, API refuses `delivery-failed-` ids. The new tests failed first. After: agent 143 → 157 (`test_proactive.py` 14), dispatch unit 79 → 84, e2e 107 → 115, prettier and tsc pass, scripts 46.
- commit da9ab5d: review (fresh session), no fixes; recorded the work commit's harmless departures under Deviations. Reran every suite green. Ran the migration up, down, up on the e2e database, and saw `down` refuse while a `DeliveryFailed` order exists.

Not done / left half-way
- Branch `codex/f25` is not merged into main yet.
- The storefront does not know `DeliveryFailed`: a failed order shows an unknown status and there is no driver button. That is a later storefront change, before the demo video if F25 is shown.
- F25 was not run against the live stack; scenario 10 is evaluated in F27.

Next
- Merge `codex/f25` into main. Then F26 (investigate node) before F27, so the evaluation measures the final agent.

Pitfalls found
- Postgres cannot drop an enum value: a `down` that removes one must swap the type, and drop and restore the column default around the cast.
- A test that asserts the exact set of recorded fixtures (`EXPECTED_NAMES`) must change with every new fixture; check for exact-set assertions when planning new fixtures.
- `agent.py` imports `proactive.py`, so `proactive.py` imports `RunStatus` only for type checking and `DuplicateComplaint` inside the function, to avoid a circular import.

## 2026-11-01 · session 23 · F26

### State on 2026-11-01

- passing 27/34
- active: F26 Investigate node
- recently passing: F23 (865cd24), F24 (0fd2e78), F33 (70fcbe4), F34 (acf81f7), F25 (da9ab5d)
- ready next: F27 Evaluation suite, F28 Complaint UI, F29 Deployed

Done this session
- commit cd8fdd0: F26 plan. Decided with the user:
  - three argumentless read-only tools: `get_fulfillment_events`, `get_ledger_payment` and `get_customer_history` (30 days, from the agent's own store);
  - a separate `investigate` node between `count` and `decide`;
  - one tool call is one step, at most 3;
  - a failed tool call becomes an error result and a step;
  - results are context for `decide`, never citable evidence;
  - Langfuse gets the step count and tool names only.

  Planning found that LiteLLM 1.106.5 imports its MCP handler for any call with `tools` and fails without the `mcp` package. The user chose to add `mcp==2.3.0`; `uv.lock` only gained lines.

  Amended once, after Codex stopped: the PRD's `get_paypal_capture` became `get_ledger_payment`, because `tests/test_execute.py:155` forbids "paypal" anywhere in the agent package (the agent never calls PayPal).
- commit dae74dd: work commit (Codex). `test_investigate.py` failed at collection first. After the change: 15 passed, the agent suite 157 → 172, scripts 46, and the agent image builds.
- Review (fresh session):
  - bd45d21 records harmless departures.
  - Design issue: an unknown tool name chosen by the model reached the Langfuse metadata and the `decide` prompt verbatim. Through a crafted complaint, it could carry complaint text into the trace or close the evidence marker early.
  - The user approved recording every unknown call as `"unknown"`. 26409fe does this, changes I7 on purpose and adds I16, which brings the counts to 16 and 173. ea82dbf and 9399b4c record it under Deviations.

Not done / left half-way
- Branch `codex/f26` is not merged into main yet.
- F26 was not run against a real model. F27's evaluation is the first run with the investigate turn; every complaint now costs at least one extra model call.
- The live agent image has to be rebuilt to include `mcp` and F26.

Next
- Merge `codex/f26` into main, then plan F27 (evaluation suite).

Pitfalls found
- LiteLLM 1.106.5 `completion(..., tools=...)` raises `No module named 'mcp'` before any network call. The `mcp` package lives in LiteLLM's `mcp`/`proxy` extras. Add `mcp==2.3.0`, or the call silently fails.
- A guard test scans the agent package for "paypal"; PRD names that mention PayPal must be renamed for the agent side.
- Anything the model chooses (here a tool name) is untrusted and must not reach the trace or another prompt verbatim.

## 2026-11-02 · session 24 · F27

### State on 2026-11-02

- passing 29/34
- recently passing: F33 (70fcbe4), F34 (acf81f7), F25 (da9ab5d), F26 (9399b4c), F27 (7b1923b)
- ready next: F28 Complaint UI, F30 README and architecture, F29 Deployed

Done this session
- commit 9555a5b: F27 plan. Decided with the user:
  - Accuracy is strict: outcome, decision, reason, exact amount and the 10000-bp party. A model failure is never a correct escalation.
  - A violation is a model decision that breaks one of the five hard rules (not `REPEAT_COMPLAINT`, a routing rule).
  - Each run goes `gather → investigate → decide → policy` with fixtures.
  - The PRD's default refund and liable party went into the decide prompt first.

  The planner added lateness thresholds of 20 and 30 minutes to `PolicyConfig`, as prompt guidance only.
- commit 7b1923b: work commit (Codex). `agent/evals/` (ten fixed scenarios, runner, Markdown report). `test_evals.py` failed at collection first; after: 12 passed, agent suite 173 → 185. Without a key the CLI exits 2 and writes nothing.
- Review (fresh session): no issues, no review fixes.
- `verify F27` with the real `deepseek/deepseek-v4-pro`:
  - accuracy 28/30 (0.93), counted violations 0/30;
  - report in `docs/eval-results.md`, generated 2026-11-01T15:02:41Z at 7b1923b.

  Every scenario was 3/3 except s05 ("Already refunded"), which was 1/3: two runs escalated as `decide/decision_invalid`. s05 and s06 used the investigate turn (1.3 and 2.0 steps on average) and cost the most tokens (about 13k and 11k per run, against 4–7k elsewhere).

Not done / left half-way
- Branch `codex/f27` is not merged into main yet.
- s05's `decision_invalid` was not investigated. The model's reply failed to parse twice, after investigating. A likely cause is a reply cut off at `max_tokens=1200` or an invalid shape once investigation results are in the prompt. Look at it before the demo; the evaluation can be rerun at no code cost.

Next
- Merge `codex/f27` into main, then F28 (complaint UI).

Pitfalls found
- `verify F27` calls the real model and takes about 15 minutes. Read the key from `.env.live` with `export DEEPSEEK_API_KEY="$(sed -n 's/^DEEPSEEK_API_KEY=//p' .env.live)"`, never typed on the command line; check it with `echo ${#DEEPSEEK_API_KEY}`.
- The verify run rewrites `docs/eval-results.md`, so the record commit carries it too.

## 2026-11-02 · session 25 · F35

### State on 2026-11-02

- passing 30/35
- recently passing: F34 (acf81f7), F25 (da9ab5d), F26 (9399b4c), F27 (7b1923b), F35 (590c17e)
- ready next: F28 Complaint UI, F30 README and architecture, F29 Deployed

Done this session
- Probe of F27's s05 misses (read-only, scratchpad scripts, real model). `deepseek-v4-pro` writes hidden reasoning that counts against `max_tokens`:
  - with the old cap of 1200, replies ended with `finish_reason="length"` and empty or half-written JSON;
  - with a cap of 8000, s05 needed 1757–3094 completion tokens, of which 1644–2973 were reasoning, and took 25–44 s, above the 30 s timeout;
  - `investigate` also treated a truncated reply as "done", silently.
- commit 73f78fd: F35 plan. Decided with the user: defaults of 6000 tokens and 90 s; the M2 script waits 600 s for `POST /v1/complaints`. Planner: a truncated investigate turn stops as `truncated` and runs none of its tool calls.
- commit 4e16166: F35 added to `docs/features.json` by the user (script run by hand).
- commit 590c17e: work commit (Codex). Before: 6 failed, 1 passed (B7, because `Literal` is not enforced at runtime). After: 7 passed, agent suite 185 → 192, scripts 46.
- Review (fresh session): no issues, no review fixes.
- Evaluation rerun after `verify F35` (`deepseek/deepseek-v4-pro`, 3 runs): accuracy 29/30 (0.97), counted violations 0/30, `docs/eval-results.md` regenerated at 590c17e. No miss was a truncation. The one miss is s05 run 1, where the model chose `escalate` itself on the already-refunded case, a judgment call. s05 and s06 still use the investigate turn (2.0 and 3.0 steps on average).

Not done / left half-way
- Branch `codex/f35` is not merged into main yet.
- The live agent image still predates F26 and F35; rebuild with `up --build` before the next live run or demo.

Next
- Merge `codex/f35` into main, then F28 (complaint UI).

Pitfalls found
- Reasoning models count hidden reasoning against `max_tokens`; a low cap fails as empty content with `finish_reason="length"`, not as an error. Size the cap from `usage.completion_tokens_details.reasoning_tokens` on a real call.
- A model turn cut off by the cap must not be read as "no tool calls"; check `finish_reason` first.

## 2026-11-02 · session 26 · F28

### State on 2026-11-02

- passing 30/35
- active: F28 Complaint UI
- recently passing: F34 (acf81f7), F25 (da9ab5d), F26 (9399b4c), F27 (7b1923b), F35 (590c17e)
- ready next: F30 README and architecture, F29 Deployed

Done this session
- commit 0deb30b: F28 plan. Decided with the user:
  - an English Gradio page in the agent package (`fairsettle_agent/ui.py`, `gradio==6.31.0`), run as the `complaint-ui` service from the agent image on 127.0.0.1:7860, talking to the agent over HTTP only;
  - the page shows a decision summary (outcome, decision, amount, reason, basis points per party). For this, `GET /v1/complaints/{id}` gained `decision`, without the explanation, evidence refs, complaint text or escalation detail.
  - `gradio` was probed first: 18 packages added, no existing version changed; `huggingface-hub` comes transitively and is unused.
- commit 86ea22a: work commit (Codex). C1–C12 failed first. After: agent suite 192 → 204, scripts 46 → 47, the image builds.
- Review (fresh session):
  - dbfe8fb fixes the plan's swapped labels: an agent reject ends `declined`, a reviewer's reject ends `rejected`.
  - 8a36df6 records it.
  - After the first live check, 85c7a94 (user-approved) shows "Sending your complaint. This can take a few minutes." with the button disabled while the agent runs, and names the rule behind a policy escalation. UI tests 13, agent suite 205.
- Live check (stack rebuilt from `codex/f28`; order setup by a scratchpad helper reusing `scripts/m2_live_run.py`):
  - Order 1 complaint `ui-4405e04f87754a38`: a $12.00 missing-item proposal, restaurant 100%, later approved and refunded. A double click during the silent wait sent `ui-937e96ea7326479c`, which escalated as `repeat_complaint`. That double click led to 85c7a94.
  - Order 8 complaint `ui-d09aa813c20d4504`: $3.00, restaurant 100%, approved, PayPal refund `6CW54061F40677438`. The page had been reloaded, so the live update was not seen.
  - Order 8 again, `ui-61612411da5b4474`: escalated `decide: model unavailable`, because the DeepSeek balance had run out (HTTP 400 "Insufficient Balance"). The user topped up.
  - Order 9, new customer, complaint `ui-43228aed247e4c60`: proposal `prop_01M6DFT7G55NBYCEEBXX3TPHTQ`, $3.00 missing item, restaurant 10000 bp. The page showed "Waiting for a reviewer", then updated by itself to Approved and Refunded after approval on the review page, without a reload error. The ledger refund is `SUCCEEDED`, 300 cents, PayPal refund `1670162843023340L`. No errors in the `complaint-ui` logs.

Not done / left half-way
- Branch `codex/f28` is not merged into main yet.
- The page has no authentication (127.0.0.1 only); F29 must add it before going public.
- The page loses its case on reload, and there is no lookup by case id.

Next
- Merge `codex/f28` into main, then F30 (README and architecture) and F29 (deployed).

Pitfalls found
- A synchronous submit that takes minutes needs a visible "sending" state and a disabled button, or people click twice and open a second case. The repeat-complaint rule then escalates it.
- A model call that fails because the account balance ran out looks like `BadRequestError` ("model unavailable"). Check the balance with `GET https://api.deepseek.com/user/balance` before a demo or an evaluation. Two evaluation runs and the live checks used up the earlier balance.
- Each live complaint needs a fresh, paid and delivered order from a customer under the 7-day limit. The scratchpad helper (accounts, restaurant, order, PayPal link, then cook and deliver) saves the manual role switching.

## 2026-11-03 · session 27 · F30

### State on 2026-11-03

- passing 31/35
- active: F30 README and architecture
- recently passing: F25 (da9ab5d), F26 (9399b4c), F27 (7b1923b), F35 (590c17e), F28 (85c7a94)
- ready next: F31 Demo video, F29 Deployed

Done this session
- commit 31e962a: F30 plan. Decided with the user:
  - a two-part quick start: the core stack needs no credentials; the full chain needs your own PayPal sandbox app, a DeepSeek key and ngrok;
  - the boundary between pre-existing and hackathon work is 2026-10-01 00:00 UTC+8;
  - the license is AGPL-3.0;
  - the demo GIF is added after the work commit.

  Codex stopped once before starting: a bare `git log --before=2026-10-01` fills in the current time of day and listed 20 commits instead of 17. The plan was amended to `--before='2026-10-01T00:00:00+08:00'`.
- commit 7d26e01: work commit (Codex). Root `README.md`, `LICENSE` (AGPL-3.0 from gnu.org), `scripts/secret_scan.py`, S1–S13 and R1–R10. Scripts suite 47 → 70; scan `0 hits in 426 commits`.
- Review (fresh session): d87776c (evaluation command uses the agent's venv), eda7a30 (R9 loads the scanner by path), 26b0d0b (names which services have their own PostgreSQL), e589bf2 (records them).
- commit 71ffa5a: `docs/media/demo.gif`. Order 11 on the live stack: storefront order, PayPal confirmation, paid and delivered, complaint `ui-9431bfd7ded3430c`, proposal `prop_01M6FRNYT02NTP2RG2N07XPHQP` ($3.00 missing item, restaurant 100%), approved by the human, refund `ref_01M6FRTBKR3HRSCT89K18MT7M7`, Refunded.
  - 960×572, 1.5 MB.
  - Built from the Claude in Chrome GIF recorder plus full-size screenshots.
  - The human logged in to PayPal and approved both the payment and the proposal.
  - The order was advanced to Delivered through dispatch GraphQL by a temporary owner of the demo restaurant, restored afterwards.
  - An earlier take (order 10) was dropped because it had no PayPal frame.
- Quick start check: on this Mac, not a second machine.
  - The live stack was stopped (volumes kept) and `codex/f30` freshly cloned into a temp dir.
  - `docker compose up -d --wait --build` was healthy in 109 s; all three README checks returned the expected output.
  - The clone's stack was stopped and the clone removed, then the live stack restarted.
- `verify F30` by the human at 71ffa5a.

Not done / left half-way
- The quick start was not run on a second machine; the verify note says so.
- The README's clone URL is a placeholder until the repository is public.
- The storefront UI is in Chinese and shows so in the GIF.
- Two scanner design issues are listed in the plan's Deviations: quoted diff paths, and merge-only changes.

Next
- Merge `codex/f30` into main, then F31 (demo video): under 3 minutes, public on YouTube; the first 20 seconds state the problem and who pays.

Pitfalls found
- `git log --before=<date>` without a time uses the current time of day. Give a full timestamp with a UTC offset for a reproducible boundary.
- The Claude in Chrome GIF recorder adds frames only when the browser is driven (click, type, navigate, scroll), not for a bare screenshot. Pages reached by hand, such as PayPal, need their own still frames.
- The storefront's quick-advance buttons call `editOrder` as the signed-in customer, so they fail with "操作受限" unless the customer owns the restaurant.

## 2026-11-04 · session 28 · F36

### State on 2026-11-04

- passing 33/36
- recently passing: F27 (7b1923b), F35 (590c17e), F28 (85c7a94), F30 (71ffa5a), F36 (088c9e0)
- ready next: F31 Demo video, F29 Deployed

Done this session
- commit b941ca2: F36 plan. Decided with the user: English text in place with no i18n library; the order page's demo controls only for the role that may use them; `DeliveryFailed` in the storefront with driver-fault and platform-fault buttons for the assigned driver.
- commit fab25b4: work commit (Codex). `src/lib/order-actions.ts` (labels, `isFinished`, `quickActionsFor`, failure reasons, `markFailedInput`), `english.test.ts` (no CJK in `src/` or the README), red `Delivery failed` badge and timeline step, every page and the README in English, dates in `en-US`. Frontend tests 9 → 20.
- Review (fresh session): 355076e (owner toast uses status labels), 0597ba5 (ready-order toast names the restaurant once), f7d2b2f (singular dish and item counts), 127fd4e (order total label `Total`).
- Design issues the user asked to fix in review: 82e6b49 (order page refetches on a live update instead of rendering the push, which lacked `createdAt` and dishes), ffeceee (no sideways scroll at 375 px), 088c9e0 (dashboard tile counts, `Past deliveries`). Each is under the plan's Deviations.
- Live check on the stack rebuilt from `codex/f36`: home, login, restaurant, checkout, order and driver pages in English at desktop and 375 px; a customer sees no demo controls; order 12 went Pending → Cooking → Cooked (owner, order page), claimed by GraphQL `takeOrder`, PickedUp and `Failed: driver fault` (driver, order page). Badge, timeline and driver history show `Delivery failed`; `order_event` 42 has `DRIVER_FAULT`. Agent case `delivery-failed-12` is `escalated` (the order was never paid) and is left for the human.
- `verify F36` at 088c9e0.

Not done / left half-way
- Order 13 (unpaid, `Cooking`) was left on the live stack from the live-update check.
- `docs/media/demo.gif` still shows the Chinese storefront; it is replaced with the F31 recording.

Next
- F37, being planned in its own session: drivers' available-orders list (`getOrders` for `Delivery` filters `driverId = me`, so `/driver/available` is always empty), drivers reading an available order so the order page's Claim shows, and `myRestaurants` not loading `menu` (GraphQL error, owner dashboard shows 0 restaurants). The user chose: paid (or `NotRequired`) orders only in the available list.

Pitfalls found
- A driver cannot open an unassigned order (`canRead`), and the storefront never lists unassigned orders, so the driver claim flow works only through GraphQL `takeOrder` until F37.
- `document.documentElement.scrollWidth` still reports clipped content under `overflow-x: clip`; check `window.scrollX` after `scrollTo` to see whether the page really scrolls sideways.

## 2026-11-05 · session 29 · F37

### State on 2026-11-05

- passing 34/37
- recently passing: F35 (590c17e), F28 (85c7a94), F30 (71ffa5a), F36 (088c9e0), F37 (85ea521)
- ready next: F31 Demo video, F29 Deployed

Done this session
- commit 17e45d4: F37 plan. Decided with the user: drivers are offered only `Cooked`, unassigned orders that are `Paid` or `NotRequired`; `takeOrder` refuses unpaid orders inside its conditional UPDATE (ADR 0001).
- commit e3467f8: work commit (Codex). `src/orders/driver-offer.ts` (`isOfferedToDrivers`, `driverPreview`), new `availableOrders` query (previews, no customer or checkout link), `getOrder` preview for drivers, `cookedOrders` filtered and previewed, `takeOrder` payment predicate and `Order is not paid yet` (CONFLICT), `getOrders` joins customer and driver, `myRestaurants` loads `menu`. Storefront driver pages use `AVAILABLE_ORDERS_QUERY`, cards link to the order page, claim toasts from `claimFailureMessage`. New e2e `driver-offers` (E1–E14) and `storefront-queries` (runs every storefront query for its role).
- Review (fresh session): matches the plan. 2d01143 (Prettier formatting in `orders.service.ts`), 85ea521 (E13 owner list must not be empty). Both under the plan's Deviations. Unit 90, e2e 132, frontend 25, `tsc` and `next build` green.
- `verify F37` at 85ea521.
- Live check (plan step 6) on `dispatch` and `storefront` rebuilt from 85ea521, with the storefront's demo accounts: restaurant 6 `F37 Check Kitchen`, orders 14 and 15. Order 15 was paid in the PayPal sandbox and became `Paid` through the ledger notification; order 14 stayed `AwaitingPayment` in dispatch (see Pitfalls). Owner cooked both. Driver: dashboard `Find an order (1)`; `/driver/available` lists only #15 with `Placed at` and `View order details`; order page shows `Paid`, `Claim order` and no customer email; `/orders/14` shows "Order not found or access denied"; GraphQL `takeOrder` on 14 returns `Order is not paid yet` (CONFLICT); claim of 15 from the order page succeeded, `/driver/active` shows `Customer contact: client@demo.com`, `availableOrders` is then empty. Owner: dashboard `1 restaurant`, `2 orders`; `/owner/restaurants` `Menu: 1 dish`; `/owner/promotions` lists the restaurant.

Not done / left half-way
- Order 14 (`Cooked`, `AwaitingPayment` in dispatch, captured in the ledger) and order 15 (`Cooked`, claimed by `driver@demo.com`) are left on the live stack.
- The storefront's Add dish form fails with 400: it sends `photo`, which `CreateDishInput` does not define. Present since the F33 storefront; F37's audit covered queries only. The dish for the live check was created through GraphQL. Needs its own fix.

Next
- Fix the Add dish form, then F31 (demo video). The demo script must pay an order before a driver can see or claim it, and ngrok must be running before any payment.

Pitfalls found
- `getOrders` uses the query builder, which ignores `eager: true`; any relation the storefront reads must be joined explicitly. `storefront-queries` now catches a non-nullable relation that is not loaded.
- A paid-after-cooked order gets no `cookedOrders` push; drivers see it on the next 3 s poll only.
- The driver order page receives no `orderUpdates` while previewing; after another driver claims, the next poll shows "Order not found or access denied".
- After a Docker restart, other projects' `restart=always` containers took the live stack's ports first (`grafana` on 3001, `redis-admin` on 8081), so `storefront` and `ledger-worker` did not start. They were stopped by hand; they will take the ports again after the next Docker restart.
- ngrok does not come back after a restart. Without it the PayPal return shows ERR_NGROK_3200 and the ledger's merchant notifications get 404 and go `DEAD`, with no automatic redelivery. That is why order 14 is captured in the ledger but `AwaitingPayment` in dispatch. Start `ngrok http 4000` and check the host matches `PUBLIC_HOST` before taking any payment.

## 2026-11-05 · session 30 · F38

### State on 2026-11-05

- passing 35/38
- recently passing: F28 (85c7a94), F30 (71ffa5a), F36 (088c9e0), F37 (85ea521), F38 (033c17c)
- ready next: F31 Demo video, F29 Deployed

Done this session
- commit 9862bdf: F38 plan. Decided with the user: accept `photo` on `CreateDishInput` and `EditDishInput` (no migration; `Dish.photo` gets `@IsOptional()` so the production `ValidationPipe` still accepts a dish without one). Audit of every storefront mutation document against its input type: only `createDish` was broken; `CreateRestaurantOutput.restaurantId` was non-null but missing on the failure path, now nullable. Codex found two wrong failure expectations in the first draft (the e2e cannot compile before `dish-form.ts` exists; the no-photo `createDish` row never failed); fixed in the plan commit before implementation.
- commit a78e951: F38 entry in `docs/features.json`.
- commit 9116235: work commit (Codex). `parseDollars` (strict, integer arithmetic) replaces `dollarsToCents`; `frontend/src/lib/dish-form.ts` `createDishInput` validates the form and builds the exact `createDish` input; the menu page's price and photo start empty; `photo` on both dish inputs. New e2e `storefront-mutations` validates every mutation document and the variables its page sends against the live schema without executing (graphql-js `validate` + `getVariableValues`), importing the page's own helper; unit `dish-input.spec.ts` covers the validator.
- commit 033c17c: review (fresh session). No code differences from the plan; three test-shape deviations recorded in the plan. The reviewer confirmed the guards bite: removing `@IsOptional()` fails V1, removing `photo` from `CreateDishInput` fails M2 and M5.
- `verify F38` at 033c17c (frontend 36, unit 5, e2e 24).

Not done / left half-way
- Live check (plan step 7) not done yet: rebuild `dispatch` and `storefront` from 033c17c and add a dish with and without a photo, and try `12.0014.50` and a four-letter name, on `/owner/restaurants/<id>/menu`.
- The e2e app (`test/utils/e2e.ts`) installs no `ValidationPipe`, unlike `src/main.ts`, so no e2e spec exercises class-validator. A separate change; existing fixtures may not satisfy the validators.

Next
- F38 live check, then F31 (demo video). Start ngrok before any payment.

Pitfalls found
- The 400 came from GraphQL variable coercion, not document validation: a check that only validates documents would have passed. `storefront-mutations` coerces the page's real variables.
- `parseFloat` stops at the second dot: `12.0014.50` was saved as $12.00 with no error. Use `parseDollars`.
- `docs/features.json` can only be changed by `scripts/features.py`, which has no `add` command; the auto-mode classifier blocked a one-off script that appended F38, so the user ran it.
