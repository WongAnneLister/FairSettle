package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.paymentsledger.common.error.*;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.identity.TenantContext;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.liability.*;
import com.paymentsledger.liability.repository.LiabilityRepository;
import com.paymentsledger.payment.repository.*;
import com.paymentsledger.provider.adapter.paypal.*;
import com.paymentsledger.refund.RefundFinancialEvidence;
import java.net.http.HttpTimeoutException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.support.TransactionTemplate;

class RefundLiabilityIT extends PayPalCaptureFixture {
    final TenantContext refundsContext = new TenantContext(
            id(1), id(2), id(3), id(4), Set.of("USD"), false, Set.of("refunds:read", "refunds:write"));
    final LiabilitySplit split = new LiabilitySplit(3333, 3333, 3334);
    RefundRepository refunds;
    RefundExecutor refundExecutor;
    LiabilityService liability;
    UUID payment;

    @BeforeEach
    void configurePosting() {
        refunds = new RefundRepository(new PaymentRepositories(jdbc), tx, json, fake.clock(), repository);
        var settlement = new CaptureSettlementService(
                new CaptureSettlementRepository(jdbc),
                tx,
                json,
                new FinancialReplayService(
                        jdbc, tx, json, new LedgerPostingService(jdbc, json), new RefundFinancialEvidence(refunds)),
                fake.clock());
        var adapter = new PayPalRefundAdapter(transport.client(fake.clock()), scope, fake.clock());
        refundExecutor = new RefundExecutor(repository, refunds, adapter, adapter, settlement, "PAYPAL");
        liability = new LiabilityService(
                new LiabilityRepository(jdbc),
                tx,
                json,
                new LedgerPostingService(jdbc, json),
                new RefundRecordRepository(jdbc));
    }

    @Test
    void allocationPostsAfterRefundPosts() {
        paid();
        var refund = refunded("liability-01", 1250, "12.50", "0.44");
        var allocation = liability.record(refund.refundId(), proposal(1), split);
        assertThat(allocationRow(allocation))
                .containsEntry("posting_status", "PENDING")
                .containsEntry("journal_id", null);
        assertThat(liability.post(allocation)).isTrue();
        var row = allocationRow(allocation);
        assertThat(row).containsEntry("posting_status", "POSTED");
        assertThat(row.get("journal_id")).isNotNull();
        assertThat(row.get("posted_at")).isNotNull();
        assertThat(entries(allocation))
                .containsExactly(
                        line("REFUND_COST_PLATFORM", "DEBIT", 418),
                        line("REFUND_RECEIVABLE_DRIVER", "DEBIT", 416),
                        line("REFUND_RECEIVABLE_RESTAURANT", "DEBIT", 416),
                        line("SALES_RETURNS", "CREDIT", 1250));
        assertThat(jdbc.queryForMap(
                        "SELECT f.event_key,f.event_type FROM platform.financial_event f JOIN platform.journal j ON j.financial_event_id=f.id WHERE j.id=?",
                        row.get("journal_id")))
                .containsEntry("event_key", "liability.allocate:" + refund.refundId())
                .containsEntry("event_type", "L-LIABILITY");
        assertThat(net("SALES_RETURNS")).isZero();
        assertThat(net("REFUND_RECEIVABLE_RESTAURANT")).isEqualTo(416);
        assertThat(net("REFUND_RECEIVABLE_DRIVER")).isEqualTo(416);
        assertThat(net("REFUND_COST_PLATFORM")).isEqualTo(418);
    }

    @Test
    void pendingUntilRefundPosts() {
        paid();
        var refund = reserve("liability-02", 1250);
        var allocation = liability.record(refund.refundId(), proposal(2), split);
        long journals = count("journal");
        assertThat(liability.post(allocation)).isFalse();
        assertThat(allocationRow(allocation)).containsEntry("posting_status", "PENDING");
        assertThat(count("journal")).isEqualTo(journals);
        complete(refund, "12.50", "0.44");
        assertThat(liability.post(allocation)).isTrue();
    }

    @Test
    void unknownRefundNeverPosts() {
        paid();
        var refund = reserve("liability-03", 1250);
        transport.token().fail(new HttpTimeoutException("x"));
        refundExecutor.execute(refund.operationId());
        assertThat(row(refund))
                .containsEntry("refund_status", "SUBMITTED")
                .containsEntry("resolution_status", "UNKNOWN");
        var allocation = liability.record(refund.refundId(), proposal(3), split);
        long journals = count("journal");
        assertThat(liability.post(allocation)).isFalse();
        assertThat(liability.postReady(10)).isZero();
        assertThat(allocationRow(allocation))
                .containsEntry("posting_status", "PENDING")
                .containsEntry("journal_id", null);
        assertThat(count("journal")).isEqualTo(journals);
    }

    @Test
    void postingIsIdempotent() {
        paid();
        var refund = refunded("liability-04", 1250, "12.50", "0.44");
        var allocation = liability.record(refund.refundId(), proposal(4), split);
        assertThat(liability.post(allocation)).isTrue();
        long journals = count("journal"), events = count("financial_event");
        assertThat(liability.post(allocation)).isFalse();
        assertThat(liability.postReady(10)).isZero();
        assertThat(count("journal")).isEqualTo(journals);
        assertThat(count("financial_event")).isEqualTo(events);
    }

    @Test
    void workerPostsOnlyReadyAllocations() {
        paid();
        var a = refunded("liability-05a", 1250, "12.50", "0.44");
        var b = reserve("liability-05b", 1000);
        var first = liability.record(a.refundId(), proposal(5), split);
        var second = liability.record(b.refundId(), proposal(105), split);
        assertThat(liability.postReady(10)).isEqualTo(1);
        assertThat(allocationRow(first)).containsEntry("posting_status", "POSTED");
        assertThat(allocationRow(second)).containsEntry("posting_status", "PENDING");
    }

    @Test
    void zeroSharesOmitLines() {
        paid();
        var refund = refunded("liability-06", 450, "4.50", "0.16");
        var allocation = liability.record(refund.refundId(), proposal(6), new LiabilitySplit(10000, 0, 0));
        assertThat(liability.post(allocation)).isTrue();
        assertThat(entries(allocation))
                .containsExactly(
                        line("REFUND_RECEIVABLE_RESTAURANT", "DEBIT", 450), line("SALES_RETURNS", "CREDIT", 450));
    }

    @Test
    void recordIsIdempotentAndConflictsAreRejected() {
        paid();
        var a = reserve("liability-07a", 1250);
        var b = reserve("liability-07b", 1000);
        var allocation = liability.record(a.refundId(), proposal(7), split);
        assertThat(liability.record(a.refundId(), proposal(7), split)).isEqualTo(allocation);
        fails(() -> liability.record(a.refundId(), proposal(107), split), ErrorCode.EVIDENCE_CONFLICT);
        fails(
                () -> liability.record(a.refundId(), proposal(7), new LiabilitySplit(10000, 0, 0)),
                ErrorCode.EVIDENCE_CONFLICT);
        fails(() -> liability.record(b.refundId(), proposal(7), split), ErrorCode.EVIDENCE_CONFLICT);
        fails(() -> liability.record(UUID.randomUUID(), proposal(207), split), ErrorCode.NOT_FOUND);
        assertThat(count("refund_liability")).isEqualTo(1);
    }

    @Test
    void readReturnsTheContractShape() {
        paid();
        var refund = refunded("liability-08", 1250, "12.50", "0.44");
        var allocation = liability.record(refund.refundId(), proposal(8), split);
        var before = liability.read(refundsContext, refund.refundId());
        assertThat(before.keySet())
                .containsExactly(
                        "refundId", "proposalId", "currency", "amountMinor", "lines", "postingStatus", "journalId");
        assertThat(before)
                .containsEntry("refundId", PaymentIds.format("ref", refund.refundId()))
                .containsEntry("proposalId", PaymentIds.format("prop", proposal(8)))
                .containsEntry("currency", "USD")
                .containsEntry("amountMinor", 1250L)
                .containsEntry("postingStatus", "PENDING")
                .containsEntry("journalId", null);
        assertThat(before.get("lines"))
                .isEqualTo(List.of(
                        resourceLine("RESTAURANT", 3333, 416),
                        resourceLine("DRIVER", 3333, 416),
                        resourceLine("PLATFORM", 3334, 418)));
        assertThat(liability.post(allocation)).isTrue();
        var after = liability.read(refundsContext, refund.refundId());
        assertThat(after)
                .containsEntry("postingStatus", "POSTED")
                .containsEntry(
                        "journalId", allocationRow(allocation).get("journal_id").toString());
        for (String key : List.of("refundId", "proposalId", "currency", "amountMinor", "lines"))
            assertThat(after.get(key)).isEqualTo(before.get(key));
    }

    @Test
    void readIsScoped() {
        paid();
        var refund = refunded("liability-09", 1250, "12.50", "0.44");
        liability.record(refund.refundId(), proposal(9), split);
        fails(
                () -> liability.read(
                        new TenantContext(id(1), id(2), id(9), id(4), Set.of("USD"), false, Set.of("refunds:read")),
                        refund.refundId()),
                ErrorCode.NOT_FOUND);
        fails(
                () -> liability.read(
                        new TenantContext(id(1), id(2), id(3), id(4), Set.of("EUR"), false, Set.of("refunds:read")),
                        refund.refundId()),
                ErrorCode.NOT_FOUND);
        fails(
                () -> liability.read(
                        new TenantContext(id(1), id(2), id(3), id(4), Set.of("USD"), false, Set.of()),
                        refund.refundId()),
                ErrorCode.FORBIDDEN);
        var other = reserve("liability-09b", 1000);
        fails(() -> liability.read(refundsContext, other.refundId()), ErrorCode.NOT_FOUND);
    }

    @Test
    void databaseRejectsTampering() {
        paid();
        var a = refunded("liability-10a", 1250, "12.50", "0.44");
        var posted = liability.record(a.refundId(), proposal(10), split);
        assertThat(liability.post(posted)).isTrue();
        var b = reserve("liability-10b", 1250);
        var pending = liability.record(b.refundId(), proposal(110), split);
        var c = reserve("liability-10c", 1250);
        var beforePosted = allocationRow(posted);
        var beforePending = allocationRow(pending);
        assertThat(jdbc.queryForObject("SELECT current_user", String.class)).isEqualTo("payments_app");
        rejected(() -> jdbc.update(
                "UPDATE platform.refund_liability SET restaurant_minor=restaurant_minor+1,platform_minor=platform_minor-1 WHERE id=?",
                pending));
        rejected(() -> jdbc.update("UPDATE platform.refund_liability SET posting_status='POSTED' WHERE id=?", pending));
        rejected(() -> jdbc.update("DELETE FROM platform.refund_liability WHERE id=?", pending));
        rejected(() -> insertInvalid(c.refundId(), 1250, 417, 416, 417));
        rejected(() -> insertInvalid(c.refundId(), 1251, 416, 416, 419));
        rejected(() -> jdbc.update(
                "UPDATE platform.refund_liability SET posting_status='PENDING',journal_id=NULL,posted_at=NULL WHERE id=?",
                posted));
        assertThat(allocationRow(posted)).isEqualTo(beforePosted);
        assertThat(allocationRow(pending)).isEqualTo(beforePending);
        assertThat(count("refund_liability")).isEqualTo(2);
    }

    @Test
    void newPurposesAreAllowedOnlyAsInternal() {
        assertThatThrownBy(() -> admin.update(
                        "INSERT INTO platform.ledger_account(organization_id,environment_id,currency,account_purpose,source_domain,provider_account_id,balance_domain) VALUES (?,?,'USD','REFUND_COST_PLATFORM','PROVIDER',?,'PAYMENTS')",
                        id(1),
                        id(2),
                        id(4)))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("ledger_account_purpose_shape");
    }

    private UUID paid() {
        payment = create();
        approved(payment);
        captureAndComplete(payment);
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "POSTED");
        assertThat(jdbc.queryForObject(
                        "SELECT latest_charge_id FROM platform.payment WHERE id=?", String.class, payment))
                .isEqualTo(CAPTURE);
        return payment;
    }

    private RefundRepository.Intent reserve(String key, long amount) {
        return refunds.prepare(
                refundsContext, key, new RefundRequests.Create(payment, amount, "USD", null, null, null), "PAYPAL");
    }

    private Map<String, Object> row(RefundRepository.Intent i) {
        return jdbc.queryForMap("SELECT * FROM platform.refund WHERE id=?", i.refundId());
    }

    private List<PayPalTestTransport.Sent> refundCalls() {
        return transport.calls().stream()
                .filter(c -> c.uri().getPath().endsWith("/refund"))
                .toList();
    }

    private RefundRepository.Intent refunded(String key, long amount, String value, String fee) {
        var i = reserve(key, amount);
        complete(i, value, fee);
        return i;
    }

    private void complete(RefundRepository.Intent i, String value, String fee) {
        String providerId = "F17"
                + i.refundId().toString().replace("-", "").substring(0, 14).toUpperCase(Locale.ROOT);
        int calls = refundCalls().size();
        transport
                .token()
                .reply(
                        201,
                        refund(
                                providerId,
                                CAPTURE,
                                "COMPLETED",
                                value,
                                fee,
                                i.refundId().toString()));
        refundExecutor.execute(i.operationId());
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED");
        assertThat(refundCalls()).hasSize(calls + 1);
    }

    private UUID proposal(long n) {
        return new UUID(9, n);
    }

    private Map<String, Object> allocationRow(UUID id) {
        return jdbc.queryForMap("SELECT * FROM platform.refund_liability WHERE id=?", id);
    }

    private List<Map<String, Object>> entries(UUID allocation) {
        return jdbc.queryForList(
                "SELECT a.account_purpose,e.side,e.amount_minor FROM platform.journal_entry e JOIN platform.ledger_account a ON a.id=e.ledger_account_id JOIN platform.refund_liability l ON l.journal_id=e.journal_id WHERE l.id=? ORDER BY a.account_purpose",
                allocation);
    }

    private Map<String, Object> line(String purpose, String side, long amount) {
        return Map.of("account_purpose", purpose, "side", side, "amount_minor", amount);
    }

    private Map<String, Object> resourceLine(String party, int bp, long amount) {
        return Map.of("party", party, "basisPoints", bp, "amountMinor", amount);
    }

    private long net(String purpose) {
        return jdbc.queryForObject(
                "SELECT COALESCE(sum(CASE WHEN e.side='DEBIT' THEN e.amount_minor ELSE -e.amount_minor END),0) FROM platform.journal_entry e JOIN platform.ledger_account a ON a.id=e.ledger_account_id WHERE a.account_purpose=?",
                Long.class,
                purpose);
    }

    private void fails(Runnable action, ErrorCode code) {
        assertThatThrownBy(() -> new TransactionTemplate(tx).execute(s -> {
                    action.run();
                    return null;
                }))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }

    private void rejected(Runnable action) {
        assertThatThrownBy(() -> new TransactionTemplate(tx).execute(s -> {
                    action.run();
                    return null;
                }))
                .isInstanceOf(DataAccessException.class);
    }

    private void insertInvalid(UUID refund, long amount, long restaurant, long driver, long platform) {
        jdbc.update(
                "INSERT INTO platform.refund_liability(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,refund_id,proposal_id,amount_minor,restaurant_bp,driver_bp,platform_bp,restaurant_minor,driver_minor,platform_minor) SELECT organization_id,environment_id,application_id,provider_account_id,currency,payment_id,id,?, ?,3333,3333,3334,?,?,? FROM platform.refund WHERE id=?",
                proposal(210),
                amount,
                restaurant,
                driver,
                platform,
                refund);
    }
}
