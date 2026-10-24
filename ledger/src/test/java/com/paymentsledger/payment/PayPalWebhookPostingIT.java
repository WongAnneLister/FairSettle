package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.identity.TenantContext;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.payment.repository.PaymentRepositories;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import com.paymentsledger.provider.adapter.paypal.*;
import com.paymentsledger.refund.RefundFinancialEvidence;
import com.paymentsledger.webhook.*;
import com.paymentsledger.webhook.repository.*;
import java.math.BigDecimal;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.junit.jupiter.api.*;

class PayPalWebhookPostingIT extends PayPalCaptureFixture {
    static final String R1 = "2EU12368F9867740A";
    static final Instant T = Instant.parse("2026-10-22T09:05:08Z");
    final TenantContext refundsContext = new TenantContext(
            id(1), id(2), id(3), id(4), Set.of("USD"), false, Set.of("refunds:read", "refunds:write"));
    RefundRepository refunds;
    RefundExecutor refundExecutor;
    WebhookInboxRepository inbox;
    PayPalWebhookReceiver receiver;
    WebhookProcessor processor;
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
        var refundAdapter = new PayPalRefundAdapter(transport.client(fake.clock()), scope, fake.clock());
        refundExecutor = new RefundExecutor(repository, refunds, refundAdapter, refundAdapter, settlement, "PAYPAL");
        inbox = new WebhookInboxRepository(jdbc, tx, json, fake.clock());
        receiver = new PayPalWebhookReceiver(new PayPalWebhookInboxRepository(jdbc), tx, json, fake.clock());
        var handler = new PayPalWebhookHandler(
                inbox, repository, refunds, new PayPalWebhookPaymentRepository(jdbc), settlement);
        processor = new WebhookProcessor(inbox, repository, json, fake.clock(), null, null, null, handler);
    }

    @Test
    void captureEventAfterQueryChangesNothing() throws Exception {
        payment = create();
        approved(payment);
        captureAndComplete(payment);
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "POSTED");
        var before = paymentRow(payment);
        assertThat(before)
                .containsEntry("payment_status", "SUCCEEDED")
                .containsEntry("provider_status", "COMPLETED")
                .containsEntry("resolution_status", "KNOWN")
                .containsEntry("financial_status", "POSTED")
                .containsEntry("captured_amount_minor", 10000L)
                .containsEntry("latest_charge_id", CAPTURE);
        assertThat(deliver(captureEvent("WH-F10-CAP-20", payment, T)).duplicate())
                .isFalse();
        assertThat(process()).isEqualTo(1);
        assertThat(inboxRow("WH-F10-CAP-20")).containsEntry("status", "DONE");
        assertThat(paymentRow(payment)).isEqualTo(before);
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(count("journal")).isEqualTo(1);
        assertThat(successNotifications()).isEqualTo(1);
        assertThat(captureFacts()).isEqualTo(1);
        assertThat(captureCalls()).hasSize(1);
        assertThat(count("dependency_wait")).isZero();
    }

    @Test
    void captureEventSettlesTimedOutCapture() throws Exception {
        payment = timeout();
        deliver(captureEvent("WH-F10-CAP-21", payment, later(1)));
        process();
        assertThat(inboxRow("WH-F10-CAP-21")).containsEntry("status", "DONE");
        assertThat(paymentRow(payment))
                .containsEntry("payment_status", "SUCCEEDED")
                .containsEntry("provider_status", "APPROVED")
                .containsEntry("resolution_status", "KNOWN")
                .containsEntry("financial_status", "POSTED")
                .containsEntry("captured_amount_minor", 10000L)
                .containsEntry("latest_charge_id", CAPTURE);
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT * FROM platform.payment_attempt"))
                .containsEntry("provider_object_id", CAPTURE)
                .containsEntry("captured", true)
                .containsEntry("balance_transaction_id", CAPTURE)
                .containsEntry("payment_intent_id", ORDER);
        assertThat(bt(CAPTURE))
                .containsEntry("state", "POSTED")
                .containsEntry("amount_minor", 10000L)
                .containsEntry("fee_minor", 349L)
                .containsEntry("net_minor", 9651L);
        assertThat(count("journal")).isEqualTo(1);
        assertThat(entries(CAPTURE))
                .containsExactly(
                        Map.of("account_purpose", "PSP_FEE_EXPENSE", "side", "DEBIT", "amount_minor", 349L),
                        Map.of("account_purpose", "PSP_FUNDS", "side", "DEBIT", "amount_minor", 9651L),
                        Map.of("account_purpose", "SALES_REVENUE", "side", "CREDIT", "amount_minor", 10000L));
        assertThat(successNotifications()).isEqualTo(1);
        assertThat(captureFacts()).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                        "SELECT first_source FROM platform.normalized_observation WHERE fact_key=?",
                        String.class,
                        "CAPTURE:" + CAPTURE))
                .isEqualTo("WEBHOOK");
        assertThat(captureCalls()).hasSize(1);
        fake.clock().advance(Duration.ofSeconds(2));
        completed(payment);
        recovery().recoverDue(10);
        assertThat(captureOperation()).containsEntry("status", "RESOLVED");
        assertThat(captureCalls()).hasSize(1);
        assertThat(paymentRow(payment)).containsEntry("provider_status", "COMPLETED");
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(count("journal")).isEqualTo(1);
    }

    @Test
    void redeliveredAndRepeatedCaptureEventsPostOnce() throws Exception {
        payment = timeout();
        var first = captureEvent("WH-F10-CAP-22A", payment, later(1));
        assertThat(deliver(first).duplicate()).isFalse();
        assertThat(deliver(first).duplicate()).isTrue();
        assertThat(deliver(captureEvent("WH-F10-CAP-22B", payment, later(2))).duplicate())
                .isFalse();
        assertThat(count("webhook_inbox")).isEqualTo(2);
        assertThat(process()).isEqualTo(2);
        assertThat(inboxRow("WH-F10-CAP-22A")).containsEntry("status", "DONE");
        assertThat(inboxRow("WH-F10-CAP-22B")).containsEntry("status", "DONE");
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(count("journal")).isEqualTo(1);
        assertThat(successNotifications()).isEqualTo(1);
        assertThat(captureFacts()).isEqualTo(1);
        assertThat(paymentRow(payment))
                .containsEntry("payment_status", "SUCCEEDED")
                .containsEntry("financial_status", "POSTED");
    }

    @Test
    void captureEventForUnknownOrderWaits() throws Exception {
        deliver(captureEvent("WH-F10-CAP-23", UUID.fromString("00000000-0000-0000-0000-0000000000bb"), later(1)));
        assertThat(process()).isEqualTo(1);
        assertThat(inboxRow("WH-F10-CAP-23"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "MISSING_PAYMENT_DEPENDENCY");
        fake.clock().advance(Duration.ofSeconds(11));
        assertThat(process()).isEqualTo(1);
        assertThat(inboxRow("WH-F10-CAP-23"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "MISSING_PAYMENT_DEPENDENCY")
                .containsEntry("attempt_count", 2);
        assertThat(waitRow("WH-F10-CAP-23"))
                .containsEntry("dependency_type", "PAYMENT")
                .containsEntry("dependency_id", ORDER);
        assertThat(count("payment_attempt")).isZero();
        assertThat(count("balance_transaction")).isZero();
        assertThat(count("journal")).isZero();
    }

    @Test
    void captureAmountMismatchIsConflict() throws Exception {
        payment = timeout();
        var event = captureEvent("WH-F10-CAP-24", payment, later(1));
        var resource = event.path("resource");
        ((ObjectNode) resource.path("amount")).put("value", "90.00");
        var breakdown = resource.path("seller_receivable_breakdown");
        ((ObjectNode) breakdown.path("gross_amount")).put("value", "90.00");
        ((ObjectNode) breakdown.path("paypal_fee")).put("value", "3.14");
        ((ObjectNode) breakdown.path("net_amount")).put("value", "86.86");
        deliver(event);
        process();
        assertThat(inboxRow("WH-F10-CAP-24"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "AMOUNT_CURRENCY_CONFLICT");
        assertThat(waitRow("WH-F10-CAP-24"))
                .containsEntry("dependency_type", "EVIDENCE")
                .containsEntry("dependency_id", CAPTURE);
        assertThat(paymentRow(payment))
                .containsEntry("payment_status", "PROCESSING")
                .containsEntry("resolution_status", "CONFLICT")
                .containsEntry("captured_amount_minor", 0L);
        assertThat(count("payment_attempt")).isZero();
        assertThat(count("balance_transaction")).isZero();
        assertThat(count("journal")).isZero();
        assertThat(successNotifications()).isZero();
    }

    @Test
    void captureForAnotherPaymentIsConflict() throws Exception {
        payment = timeout();
        deliver(captureEvent("WH-F10-CAP-25", UUID.randomUUID(), later(1)));
        process();
        assertThat(inboxRow("WH-F10-CAP-25"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "RELATIONSHIP_CONFLICT");
        assertThat(paymentRow(payment))
                .containsEntry("payment_status", "PROCESSING")
                .containsEntry("resolution_status", "CONFLICT");
        assertThat(count("payment_attempt")).isZero();
        assertThat(count("balance_transaction")).isZero();
    }

    @Test
    void unsupportedPayPalEventIsNotProcessed() throws Exception {
        payment = timeout();
        var event = captureEvent("WH-F10-CAP-26", payment, later(1));
        event.put("event_type", "PAYMENT.CAPTURE.PENDING");
        ((ObjectNode) event.path("resource")).put("status", "PENDING");
        deliver(event);
        process();
        assertThat(inboxRow("WH-F10-CAP-26"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "FUTURE_RESOURCE_HANDLER");
        assertThat(waitRow("WH-F10-CAP-26"))
                .containsEntry("dependency_type", "FUTURE_RESOURCE")
                .containsEntry("dependency_id", CAPTURE);
        assertThat(paymentRow(payment))
                .containsEntry("payment_status", "PROCESSING")
                .containsEntry("resolution_status", "UNKNOWN")
                .containsEntry("captured_amount_minor", 0L);
        assertThat(count("payment_attempt")).isZero();
    }

    @Test
    void captureEventArrivingAfterRefundIsDoneAndPostsNothing() throws Exception {
        paid();
        var i = reserve("pp-whk-late-cap", 2500);
        transport
                .token()
                .reply(
                        201,
                        refund(
                                R1,
                                CAPTURE,
                                "COMPLETED",
                                "25.00",
                                "0.00",
                                i.refundId().toString()));
        refundExecutor.execute(i.operationId());
        long journals = count("journal"), bts = count("balance_transaction");
        var event = captureEvent("WH-F10-CAP-LATE", payment, later(5));
        ((ObjectNode) event.path("resource")).put("status", "PARTIALLY_REFUNDED");
        deliver(event);
        assertThat(process()).isEqualTo(1);
        assertThat(inboxRow("WH-F10-CAP-LATE")).containsEntry("status", "DONE");
        assertThat(paymentRow(payment))
                .containsEntry("payment_status", "SUCCEEDED")
                .containsEntry("financial_status", "POSTED")
                .containsEntry("captured_amount_minor", 10000L)
                .containsEntry("latest_charge_id", CAPTURE);
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED");
        assertThat(control()).containsEntry("refunded_minor", 2500L).containsEntry("control_state", "NORMAL");
        assertThat(count("journal")).isEqualTo(journals);
        assertThat(count("balance_transaction")).isEqualTo(bts);
        assertThat(count("dependency_wait")).isZero();
        assertThat(captureCalls()).hasSize(1);
    }

    @Test
    void refundEventAfterRefundResponseChangesNothing() throws Exception {
        paid();
        var i = reserve("pp-whk-r27", 4000);
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
        long journals = count("journal");
        deliver(refundEvent("WH-F10-REF-27", R1, i.refundId(), "40.00", "1.40"));
        process();
        assertThat(inboxRow("WH-F10-REF-27")).containsEntry("status", "DONE");
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED").containsEntry("provider_refund_id", R1);
        assertThat(control())
                .containsEntry("refunded_minor", 4000L)
                .containsEntry("reserved_minor", 0L)
                .containsEntry("control_state", "NORMAL");
        assertThat(refundBtCount()).isEqualTo(1);
        assertThat(bt(R1)).containsEntry("state", "POSTED");
        assertThat(count("journal")).isEqualTo(journals);
        assertThat(count("refund")).isEqualTo(1);
        assertThat(refundCalls()).hasSize(1);
    }

    @Test
    void refundEventSettlesLostRefundResponse() throws Exception {
        var i = lostRefund("pp-whk-r28", "WH-F10-REF-28");
        assertThat(inboxRow("WH-F10-REF-28")).containsEntry("status", "DONE");
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED").containsEntry("provider_refund_id", R1);
        assertThat(control()).containsEntry("reserved_minor", 0L).containsEntry("refunded_minor", 4000L);
        assertThat(bt(R1))
                .containsEntry("state", "POSTED")
                .containsEntry("amount_minor", -4000L)
                .containsEntry("fee_minor", -140L)
                .containsEntry("net_minor", -3860L);
        assertThat(entries(R1))
                .containsExactly(
                        Map.of("account_purpose", "PSP_FEE_EXPENSE", "side", "CREDIT", "amount_minor", 140L),
                        Map.of("account_purpose", "PSP_FUNDS", "side", "CREDIT", "amount_minor", 3860L),
                        Map.of("account_purpose", "SALES_RETURNS", "side", "DEBIT", "amount_minor", 4000L));
        assertThat(refundCalls()).hasSize(1);
    }

    @Test
    void repeatedRefundEventPostsOnce() throws Exception {
        var i = lostRefund("pp-whk-r29", "WH-F10-REF-29A");
        long journals = count("journal");
        deliver(refundEvent("WH-F10-REF-29B", R1, i.refundId(), "40.00", "1.40"));
        process();
        assertThat(inboxRow("WH-F10-REF-29B")).containsEntry("status", "DONE");
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED");
        assertThat(control()).containsEntry("refunded_minor", 4000L);
        assertThat(refundBtCount()).isEqualTo(1);
        assertThat(count("journal")).isEqualTo(journals);
        assertThat(count("refund")).isEqualTo(1);
        assertThat(refundCalls()).hasSize(1);
    }

    @Test
    void refundEventBeforeCaptureIsKnownWaits() throws Exception {
        payment = timeout();
        deliver(refundEvent("WH-F10-REF-30", R1, UUID.randomUUID(), "40.00", "1.40"));
        process();
        assertThat(inboxRow("WH-F10-REF-30"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "MISSING_REFUND_PAYMENT_DEPENDENCY");
        assertThat(waitRow("WH-F10-REF-30"))
                .containsEntry("dependency_type", "CHARGE")
                .containsEntry("dependency_id", CAPTURE);
        assertThat(count("refund")).isZero();
        assertThat(count("balance_transaction")).isZero();
        assertThat(count("journal")).isZero();
    }

    @Test
    void refundEventForFailedRefundIsConflict() throws Exception {
        paid();
        var i = reserve("pp-whk-r31", 4000);
        transport.token().reply(422, Files.readString(Path.of("../docs/adr/paypal-samples/10-over-refund.json")));
        refundExecutor.execute(i.operationId());
        assertThat(row(i)).containsEntry("refund_status", "FAILED");
        long journals = count("journal");
        deliver(refundEvent("WH-F10-REF-31", R1, i.refundId(), "40.00", "1.40"));
        process();
        assertThat(inboxRow("WH-F10-REF-31")).containsEntry("status", "DONE");
        assertThat(row(i)).containsEntry("refund_status", "FAILED").containsEntry("resolution_status", "CONFLICT");
        assertThat(control()).containsEntry("refunded_minor", 0L);
        assertThat(refundBtCount()).isZero();
        assertThat(count("journal")).isEqualTo(journals);
        assertThat(refundCalls()).hasSize(1);
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

    private UUID timeout() {
        UUID payment = create();
        approved(payment);
        transport.fail(new HttpTimeoutException("x"));
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "PROCESSING")
                .containsEntry("resolutionStatus", "UNKNOWN");
        onlyCaptureTaskRecovers();
        fake.clock().advance(Duration.ofSeconds(6));
        return payment;
    }

    private String captureTaskStatus() {
        return jdbc.queryForObject(
                "SELECT status FROM platform.recovery_task WHERE operation_id=?",
                String.class,
                captureOperation().get("id"));
    }

    private RefundRepository.Intent lostRefund(String key, String eventId) throws Exception {
        paid();
        var intent = reserve(key, 4000);
        transport.token().fail(new HttpTimeoutException("x"));
        refundExecutor.execute(intent.operationId());
        assertThat(row(intent))
                .containsEntry("refund_status", "SUBMITTED")
                .containsEntry("resolution_status", "UNKNOWN");
        assertThat(control()).containsEntry("reserved_minor", 4000L);
        deliver(refundEvent(eventId, R1, intent.refundId(), "40.00", "1.40"));
        process();
        return intent;
    }

    private Map<String, Object> row(RefundRepository.Intent i) {
        return jdbc.queryForMap("SELECT * FROM platform.refund WHERE id=?", i.refundId());
    }

    private Map<String, Object> control() {
        return jdbc.queryForMap("SELECT * FROM platform.refund_control WHERE payment_id=?", payment);
    }

    private Map<String, Object> bt(String id) {
        return jdbc.queryForMap("SELECT * FROM platform.balance_transaction WHERE bt_id=?", id);
    }

    private List<PayPalTestTransport.Sent> refundCalls() {
        return transport.calls().stream()
                .filter(c -> c.uri().getPath().endsWith("/refund"))
                .toList();
    }

    private Instant later(long n) {
        return fake.clock().instant().truncatedTo(ChronoUnit.SECONDS).plusSeconds(n);
    }

    private ObjectNode captureEvent(String eventId, UUID payment, Instant updated) throws Exception {
        var event = fixture("webhook-capture-completed.json");
        event.put("id", eventId);
        ((ObjectNode) event.path("resource"))
                .put("custom_id", payment.toString())
                .put("update_time", updated.toString());
        return event;
    }

    private ObjectNode refundEvent(String eventId, String refundId, UUID customId, String value, String fee)
            throws Exception {
        var event = fixture("webhook-refund-completed.json");
        event.put("id", eventId);
        var resource = (ObjectNode) event.path("resource");
        resource.put("id", refundId)
                .put("custom_id", customId.toString())
                .put("create_time", "2026-10-22T10:00:00Z")
                .put("update_time", "2026-10-22T10:00:00Z");
        ((ObjectNode) resource.path("amount")).put("value", value);
        var breakdown = resource.path("seller_payable_breakdown");
        ((ObjectNode) breakdown.path("gross_amount")).put("value", value);
        ((ObjectNode) breakdown.path("paypal_fee")).put("value", fee);
        ((ObjectNode) breakdown.path("net_amount"))
                .put(
                        "value",
                        new BigDecimal(value).subtract(new BigDecimal(fee)).toPlainString());
        return event;
    }

    private ObjectNode fixture(String file) throws Exception {
        return (ObjectNode) json.readTree(Files.readAllBytes(Path.of("src/test/resources/paypal/" + file)));
    }

    private WebhookInboxRepository.Receipt deliver(JsonNode event) throws Exception {
        Instant now = fake.clock().instant();
        var ok = new ProviderCallResult<>(
                ProviderCallClassification.SUCCESS,
                new VerifiedWebhook(
                        event.path("id").asText(),
                        event.path("event_type").asText(),
                        event.path("resource").path("id").asText(),
                        Instant.parse(event.path("create_time").asText()),
                        false),
                new ProviderEvidence(null, null, now, now, 200, null, null, "paypal-notifications-v1"));
        return receiver.receive(scope, "client-fixture", json.writeValueAsBytes(event), ok);
    }

    private int process() {
        return processor.processDue(10);
    }

    private Map<String, Object> inboxRow(String eventId) {
        return jdbc.queryForMap("SELECT * FROM platform.webhook_inbox WHERE event_id=?", eventId);
    }

    private Map<String, Object> waitRow(String eventId) {
        return jdbc.queryForMap(
                "SELECT w.* FROM platform.dependency_wait w JOIN platform.webhook_inbox i ON i.id=w.inbox_id WHERE i.event_id=?",
                eventId);
    }

    private Map<String, Object> paymentRow(UUID payment) {
        return jdbc.queryForMap(
                "SELECT payment_status,provider_status,resolution_status,financial_status,captured_amount_minor,latest_charge_id FROM platform.payment WHERE id=?",
                payment);
    }

    private long captureFacts() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM platform.normalized_observation WHERE fact_key=?",
                Long.class,
                "CAPTURE:" + CAPTURE);
    }

    private long refundBtCount() {
        return jdbc.queryForObject("SELECT count(*) FROM platform.balance_transaction WHERE bt_id=?", Long.class, R1);
    }

    private List<Map<String, Object>> entries(String btId) {
        return jdbc.queryForList("""
                SELECT a.account_purpose,e.side,e.amount_minor FROM platform.journal_entry e
                JOIN platform.ledger_account a ON a.id=e.ledger_account_id
                JOIN platform.balance_transaction b ON b.journal_id=e.journal_id
                WHERE b.bt_id=? ORDER BY a.account_purpose
                """, btId);
    }
}
