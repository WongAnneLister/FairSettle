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
