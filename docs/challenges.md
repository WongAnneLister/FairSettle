# Bugs and difficulties

Real problems found while building FairSettle. Each entry covers:

- what went wrong and how it was found;
- why it happened;
- what it would have cost;
- how it was fixed, and the lesson.

Open limitations that were deliberately left unfixed are in `docs/known-issues.md` instead.

## C-1 · Head-of-line blocking in the refund liability worker

Found: 2026-10-25, in the review of F17's work commit `557405f`, before merge. Found by reading the code; it never happened in a run. Area: `ledger`, `liability`.

### What happens

F17 posts each refund's liability split (restaurant / driver / platform) once the refund has posted. A worker does this in batches. Each tick:

1. selects the 25 oldest pending allocations whose refund is `SUCCEEDED`;
2. checks each one fully, which also requires the refund's accounting status to be `POSTED`;
3. posts those that pass.

The selection in step 1 is weaker than the check in step 2. A refund can be `SUCCEEDED` and still never reach `POSTED`:

- its PayPal balance transaction conflicts with what the ledger knows (permanent);
- or the balance transaction has not been imported yet (open-ended).

Such an allocation passes step 1, fails step 2, and stays exactly where it was: at the front of the queue. Once 25 of them exist, every tick picks the same 25, posts nothing, and every newer allocation waits behind them forever.

```text
tick 1: [stuck 1 … stuck 25] | new A, new B …   → posts 0
tick 2: [stuck 1 … stuck 25] | new A, new B …   → posts 0
…                                                 (A and B never post)
```

### Why it matters

- **No money is wrong.** Nothing is posted twice or posted early.
- **Receivables silently stop.** The restaurant's and driver's shares of new refunds never reach their accounts. `GET /v1/refunds/{id}/liability` keeps showing `PENDING`.
- **Nothing alerts anyone.** A row that is not ready was skipped without a log line, and failures were logged without a cause. In a demo, the first sign would be a liability that never posts.

### Fix

- **Rotation.** An attempt cursor, `platform.refund_liability_attempt`, is stamped in its own transaction before each try. The worker now takes never-tried rows first, then the least recently tried. A stuck row goes to the back after every attempt, so it can delay others by at most one tick. The revenue-share catch-up in the same ledger already uses this pattern (`share_catchup_cursor`).
- **Visibility.** Failures now log their error class and code or SQL state. A row that is still not ready logs a warning at attempts 10, 100 and 1000.
- **Test.** `RefundLiabilityIT.stuckAllocationsDoNotBlockNewerOnes` creates two stuck allocations, then one ready one, and runs the worker with a batch of two. Before the fix, the ready one never posts; after it, it posts on the second tick.

Specified in `docs/plans/F17.md`, "Review fixes", RF-1 and RF-4. Implemented in the commits `ledger: rotate liability posting attempts so stuck rows cannot block newer ones (F17), review fix` and `ledger: log why a liability posting attempt failed (F17), review fix`.

### Lesson

When a batch's selection rule is weaker than its processing rule, an item that fails processing must leave the front of the queue: rotate it, back it off, or park it. Otherwise a fixed batch size plus a stable order lets a few bad items starve everything behind them. The plan for F17 copied revenue share's posting logic but not its cursor, and the review caught the difference.
