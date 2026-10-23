package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.paymentsledger.common.error.*;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.identity.TenantContext;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.payment.repository.PaymentRepositories;
import com.paymentsledger.provider.adapter.paypal.*;
import com.paymentsledger.refund.RefundFinancialEvidence;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.*;

class PayPalRefundIT extends PayPalCaptureFixture {
    static final String R1 = "2EU12368F9867740A", R2 = "3FV23479G0978851B";
    final TenantContext refundsContext = new TenantContext(
            id(1), id(2), id(3), id(4), Set.of("USD"), false, Set.of("refunds:read", "refunds:write"));
    RefundRepository refunds;
    RefundExecutor refundExecutor;
    UUID payment;

    @BeforeEach
    void configureRefunds() {
        refunds = new RefundRepository(new PaymentRepositories(jdbc), tx, json, fake.clock(), repository);
        var refundSettlement = new CaptureSettlementService(
                new CaptureSettlementRepository(jdbc),
                tx,
                json,
                new FinancialReplayService(
                        jdbc, tx, json, new LedgerPostingService(jdbc, json), new RefundFinancialEvidence(refunds)),
                fake.clock());
        var refundAdapter = new PayPalRefundAdapter(transport.client(fake.clock()), scope, fake.clock());
        refundExecutor =
                new RefundExecutor(repository, refunds, refundAdapter, refundAdapter, refundSettlement, "PAYPAL");
    }

    @Test
    void partialThenFullRefundAgainstCaptureAndPost() throws Exception {
        paid();
        var i1 = reserve("pp-ref-1", 4000);
        transport
                .token()
                .reply(
                        201,
                        refund(
                                R1,
                                CAPTURE,
                                "COMPLETED",
                                "40.00",
                                "1.40",
                                i1.refundId().toString()));
        refundExecutor.execute(i1.operationId());
        var i2 = reserve("pp-ref-2", 6000);
        transport.reply(
                201,
                refund(R2, CAPTURE, "COMPLETED", "60.00", "2.09", i2.refundId().toString()));
        refundExecutor.execute(i2.operationId());
        assertError(() -> reserve("pp-ref-3", 1), ErrorCode.REFUND_LIMIT_EXCEEDED);
        var calls = refundCalls();
        assertThat(calls)
                .hasSize(2)
                .allSatisfy(
                        c -> assertThat(c.uri().getPath()).isEqualTo("/v2/payments/captures/" + CAPTURE + "/refund"));
        String key1 = operation(i1).get("operation_key").toString(),
                key2 = operation(i2).get("operation_key").toString();
        assertThat(key1).isNotEqualTo(key2);
        assertThat(calls.getFirst().headers()).containsEntry("PayPal-Request-Id", key1);
        assertThat(calls.get(1).headers()).containsEntry("PayPal-Request-Id", key2);
        assertThat(json.readTree(calls.getFirst().body())
                        .path("amount")
                        .path("value")
                        .asText())
                .isEqualTo("40.00");
        assertThat(json.readTree(calls.get(1).body())
                        .path("amount")
                        .path("value")
                        .asText())
                .isEqualTo("60.00");
        assertThat(json.readTree(calls.getFirst().body()).path("custom_id").asText())
                .isEqualTo(i1.refundId().toString());
        assertThat(json.readTree(calls.get(1).body()).path("custom_id").asText())
                .isEqualTo(i2.refundId().toString());
        for (var i : List.of(i1, i2)) {
            assertThat(row(i))
                    .containsEntry("refund_status", "SUCCEEDED")
                    .containsEntry("resolution_status", "KNOWN")
                    .containsEntry("provider_status", "COMPLETED")
                    .containsEntry("provider_charge_id", CAPTURE)
                    .containsEntry("balance_transaction_id", i == i1 ? R1 : R2);
        }
        assertThat(control())
                .containsEntry("refunded_minor", 10000L)
                .containsEntry("reserved_minor", 0L)
                .containsEntry("control_state", "NORMAL");
        assertThat(bt(R1))
                .containsEntry("state", "POSTED")
                .containsEntry("amount_minor", -4000L)
                .containsEntry("fee_minor", -140L)
                .containsEntry("net_minor", -3860L);
        assertThat(bt(R2)).containsEntry("state", "POSTED");
        assertThat(jdbc.queryForList("""
                SELECT a.account_purpose,e.side,e.amount_minor FROM platform.journal_entry e
                JOIN platform.ledger_account a ON a.id=e.ledger_account_id
                JOIN platform.balance_transaction b ON b.journal_id=e.journal_id
                WHERE b.bt_id=? ORDER BY a.account_purpose
                """, R1))
                .containsExactly(
                        Map.of("account_purpose", "PSP_FEE_EXPENSE", "side", "CREDIT", "amount_minor", 140L),
                        Map.of("account_purpose", "PSP_FUNDS", "side", "CREDIT", "amount_minor", 3860L),
                        Map.of("account_purpose", "SALES_RETURNS", "side", "DEBIT", "amount_minor", 4000L));
        assertProjection();
    }

    @Test
    void reservationLimitIsEnforcedBeforeSending() {
        paid();
        assertError(() -> reserve("pp-ref-a1", 10001), ErrorCode.REFUND_LIMIT_EXCEEDED);
        assertThat(reserve("pp-ref-b1", 6000).replay()).isFalse();
        assertError(() -> reserve("pp-ref-c1", 5000), ErrorCode.REFUND_LIMIT_EXCEEDED);
        assertThat(reserve("pp-ref-d1", 4000).replay()).isFalse();
        assertThat(refundCalls()).isEmpty();
        assertThat(control()).containsEntry("reserved_minor", 10000L);
    }

    @Test
    void retryWithSameKeyIsIdempotent() {
        paid();
        var i = reserve("pp-ref-k1", 4000);
        var j = reserve("pp-ref-k1", 4000);
        assertThat(j.replay()).isTrue();
        assertThat(j.refundId()).isEqualTo(i.refundId());
        assertThat(j.operationId()).isEqualTo(i.operationId());
        transport
                .token()
                .reply(
                        201,
                        refund(
                                R1,
                                CAPTURE,
                                "COMPLETED",
                                "40.00",
                                "1.40",
                                i.refundId().toString()));
        refundExecutor.execute(i.operationId());
        refundExecutor.execute(i.operationId());
        assertThat(refundCalls()).hasSize(1);
        assertThat(count("refund")).isEqualTo(1);
        assertError(() -> reserve("pp-ref-k1", 5000), ErrorCode.IDEMPOTENCY_CONFLICT);
    }

    @Test
    void lostResponseIsFoundByCustomIdNeverResent() {
        var i = timeout("pp-ref-t1");
        int before = transport.calls().size();
        transport.reply(
                200,
                orderWithRefunds(
                        ORDER,
                        payment.toString(),
                        CAPTURE,
                        refund(
                                R1,
                                CAPTURE,
                                "COMPLETED",
                                "40.00",
                                "1.40",
                                i.refundId().toString())));
        refundRecovery().recoverDue(10);
        assertThat(row(i))
                .containsEntry("refund_status", "SUCCEEDED")
                .containsEntry("resolution_status", "KNOWN")
                .containsEntry("provider_refund_id", R1);
        assertThat(control()).containsEntry("reserved_minor", 0L).containsEntry("refunded_minor", 4000L);
        assertThat(bt(R1)).containsEntry("state", "POSTED");
        assertThat(refundCalls()).hasSize(1);
        var queries = transport.calls().subList(before, transport.calls().size());
        assertThat(queries).hasSize(1);
        assertThat(queries.getFirst().method()).isEqualTo("GET");
        assertThat(queries.getFirst().uri().getPath()).isEqualTo("/v2/checkout/orders/" + ORDER);
    }

    @Test
    void noMatchStaysUnknownThenEscalatesNeverResent() {
        var i = timeout("pp-ref-t1");
        transport.reply(200, orderWithRefunds(ORDER, payment.toString(), CAPTURE));
        refundRecovery().recoverDue(10);
        assertThat(row(i)).containsEntry("resolution_status", "UNKNOWN");
        assertThat(control()).containsEntry("reserved_minor", 4000L);
        assertThat(operation(i)).containsEntry("status", "UNKNOWN");
        transport.reply(200, orderWithRefunds(ORDER, payment.toString(), CAPTURE));
        fake.clock().advance(Duration.ofHours(1));
        refundRecovery().recoverDue(10);
        assertThat(operation(i))
                .containsEntry("status", "ESCALATED")
                .containsEntry("escalation_reason", "UNRESOLVED_AGE_LIMIT");
        assertThat(refundCalls()).hasSize(1);
    }

    @Test
    void twoMatchesIsConflict() {
        var i = timeout("pp-ref-t1");
        transport.reply(
                200,
                orderWithRefunds(
                        ORDER,
                        payment.toString(),
                        CAPTURE,
                        refund(
                                R1,
                                CAPTURE,
                                "COMPLETED",
                                "40.00",
                                "1.40",
                                i.refundId().toString()),
                        refund(
                                R2,
                                CAPTURE,
                                "COMPLETED",
                                "40.00",
                                "1.40",
                                i.refundId().toString())));
        refundRecovery().recoverDue(10);
        assertThat(row(i)).containsEntry("resolution_status", "CONFLICT");
        assertThat(control()).containsEntry("control_state", "EXTERNAL_CONFLICT");
        assertThat(operation(i))
                .containsEntry("status", "ESCALATED")
                .containsEntry("escalation_reason", "CONFLICTING_REFUND_ANCHORS");
        assertThat(refundCalls()).hasSize(1);
    }

    @Test
    void providerOverRefundFailsAndFreezes() throws Exception {
        paid();
        var i = reserve("pp-ref-o1", 4000);
        transport.token().reply(422, Files.readString(Path.of("../docs/adr/paypal-samples/10-over-refund.json")));
        refundExecutor.execute(i.operationId());
        assertThat(row(i)).containsEntry("refund_status", "FAILED").containsEntry("resolution_status", "KNOWN");
        assertThat(control())
                .containsEntry("reserved_minor", 0L)
                .containsEntry("refunded_minor", 0L)
                .containsEntry("control_state", "EXTERNAL_CONFLICT");
        assertThat(jdbc.queryForObject(
                        "SELECT status FROM platform.recovery_task WHERE operation_id=?",
                        String.class,
                        i.operationId()))
                .isEqualTo("DONE");
        assertError(() -> reserve("pp-ref-o2", 1000), ErrorCode.EVIDENCE_CONFLICT);
        assertThat(refundCalls()).hasSize(1);
    }

    @Test
    void pendingRefundCompletesOnQuery() {
        paid();
        var i = reserve("pp-ref-p1", 4000);
        transport
                .token()
                .reply(
                        201,
                        refund(
                                R1,
                                CAPTURE,
                                "PENDING",
                                "40.00",
                                null,
                                i.refundId().toString()));
        refundExecutor.execute(i.operationId());
        assertThat(row(i)).containsEntry("refund_status", "PENDING").containsEntry("provider_refund_id", R1);
        assertThat(control()).containsEntry("reserved_minor", 4000L);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.balance_transaction WHERE bt_id=?", Long.class, R1))
                .isZero();
        onlyRefundTasksRecover();
        fake.clock().advance(Duration.ofSeconds(6));
        int before = transport.calls().size();
        transport.reply(
                200,
                refund(R1, CAPTURE, "COMPLETED", "40.00", "1.40", i.refundId().toString()));
        refundRecovery().recoverDue(10);
        var queries = transport.calls().subList(before, transport.calls().size());
        assertThat(queries).hasSize(1);
        assertThat(queries.getFirst().method()).isEqualTo("GET");
        assertThat(queries.getFirst().uri().getPath()).isEqualTo("/v2/payments/refunds/" + R1);
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED");
        assertThat(bt(R1)).containsEntry("state", "POSTED");
        assertThat(refundCalls()).hasSize(1);
    }

    UUID paid() {
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

    RefundRepository.Intent reserve(String key, long amount) {
        return refunds.prepare(
                refundsContext, key, new RefundRequests.Create(payment, amount, "USD", null, null, null), "PAYPAL");
    }

    RefundRepository.Intent timeout(String key) {
        paid();
        var i = reserve(key, 4000);
        transport.token().fail(new HttpTimeoutException("x"));
        refundExecutor.execute(i.operationId());
        assertThat(row(i)).containsEntry("refund_status", "SUBMITTED").containsEntry("resolution_status", "UNKNOWN");
        assertThat(control()).containsEntry("reserved_minor", 4000L);
        assertThat(operation(i)).containsEntry("status", "UNKNOWN");
        onlyRefundTasksRecover();
        fake.clock().advance(Duration.ofSeconds(6));
        return i;
    }

    void onlyRefundTasksRecover() {
        admin.update(
                "UPDATE platform.recovery_task SET status='DONE' WHERE operation_id IN (SELECT id FROM platform.provider_operation WHERE operation_target='PAYMENT')");
    }

    OperationRecoveryCoordinator refundRecovery() {
        return new OperationRecoveryCoordinator(
                repository,
                executor,
                refundExecutor,
                new RecoveryPolicy(
                        Duration.ofSeconds(30),
                        Duration.ofDays(1),
                        Duration.ofDays(1),
                        0,
                        Duration.ofHours(1),
                        Duration.ZERO));
    }

    List<PayPalTestTransport.Sent> refundCalls() {
        return transport.calls().stream()
                .filter(c -> c.uri().getPath().endsWith("/refund"))
                .toList();
    }

    Map<String, Object> row(RefundRepository.Intent i) {
        return jdbc.queryForMap("SELECT * FROM platform.refund WHERE id=?", i.refundId());
    }

    Map<String, Object> operation(RefundRepository.Intent i) {
        return jdbc.queryForMap("SELECT * FROM platform.provider_operation WHERE id=?", i.operationId());
    }

    Map<String, Object> control() {
        return jdbc.queryForMap("SELECT * FROM platform.refund_control WHERE payment_id=?", payment);
    }

    Map<String, Object> bt(String id) {
        return jdbc.queryForMap("SELECT * FROM platform.balance_transaction WHERE bt_id=?", id);
    }

    void assertError(Runnable action, ErrorCode code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }

    void assertProjection() {
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM platform.ledger_account a
                LEFT JOIN platform.balance_projection p ON p.ledger_account_id=a.id
                LEFT JOIN (SELECT ledger_account_id,sum(CASE WHEN side='DEBIT' THEN amount_minor::numeric ELSE
                    -amount_minor::numeric END) rebuilt FROM platform.journal_entry GROUP BY ledger_account_id) e ON
                    e.ledger_account_id=a.id
                WHERE coalesce(p.balance_minor,0)<>coalesce(e.rebuilt,0)
                """, Long.class)).isZero();
    }
}
