package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.payment.repository.PaymentRepositories;
import com.paymentsledger.provider.adapter.paypal.*;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class PayPalCaptureIT extends PaymentCoreFixture {
    static final String ORDER = "7CV2269518094610C", CAPTURE = "41995584GM234064G";
    final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    final PayPalTestTransport transport = new PayPalTestTransport();

    @BeforeEach
    void configurePayPalCapture() {
        admin.update(
                "UPDATE platform.provider_account SET provider='PAYPAL',provider_account_ref='client-fixture' WHERE id=?",
                id(4));
        var env = new MockEnvironment()
                .withProperty("platform.paypal.enabled", "true")
                .withProperty("platform.paypal.client-id", "client-fixture")
                .withProperty("platform.paypal.organization-id", id(1).toString())
                .withProperty("platform.paypal.environment-id", id(2).toString())
                .withProperty("platform.paypal.provider-account-id", id(4).toString());
        repository = new PaymentRepository(new PaymentRepositories(jdbc), tx, json, fake.clock(), env);
        var adapter = new PayPalCheckoutAdapter(transport.client(fake.clock()), scope, fake.clock());
        var starts = Timestamp.from(fake.clock().instant().minus(Duration.ofDays(1)));
        admin.update("UPDATE platform.price_fixture SET valid_from=?", starts);
        admin.update("UPDATE platform.share_policy_fixture SET valid_from=?", starts);
        policy();
        for (String purpose : List.of("PSP_FUNDS", "PSP_FEE_EXPENSE", "SALES_REVENUE", "SALES_RETURNS", "SUSPENSE")) {
            boolean provider = !purpose.startsWith("SALES_");
            admin.update(
                    """
                    INSERT INTO platform.ledger_account
                    (organization_id,environment_id,currency,account_purpose,source_domain,provider_account_id,balance_domain)
                    VALUES (?,?,'USD',?,?,?,?)
                    """,
                    scope.organizationId(),
                    scope.environmentId(),
                    purpose,
                    provider ? "PROVIDER" : "INTERNAL",
                    provider ? scope.providerAccountId() : null,
                    provider ? "PAYMENTS" : null);
        }
        var settlement = new CaptureSettlementService(
                new CaptureSettlementRepository(jdbc),
                tx,
                json,
                new FinancialReplayService(
                        jdbc, tx, json, new LedgerPostingService(jdbc, json), RefundEvidencePort.unavailable()),
                fake.clock());
        executor = new PaymentExecutor(repository, adapter, null, null, adapter, settlement, "PAYPAL");
        service = new PaymentService(repository, executor);
    }

    @Test
    void approvalThenGetCapturesOnceAndPostsBalancedEntries() {
        UUID payment = create();
        approved(payment);
        captureAndComplete(payment);
        var result = service.get(context, payment);
        assertThat(result)
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("resolutionStatus", "KNOWN")
                .containsEntry("financialStatus", "POSTED");
        assertThat(transport.orderCalls().subList(1, 4))
                .extracting(PayPalTestTransport.Sent::method)
                .containsExactly("GET", "POST", "GET");
        assertThat(captureCalls()).hasSize(1);
        var operation = captureOperation();
        assertThat(operation)
                .containsEntry("status", "RESOLVED")
                .containsEntry("resolution", "KNOWN")
                .containsEntry("external_object_id", ORDER);
        assertThat(operation.get("operation_key").toString()).startsWith("pay_capture_");
        assertThat(captureCalls().getFirst().headers())
                .containsEntry(
                        "PayPal-Request-Id", operation.get("operation_key").toString());
        assertThat(jdbc.queryForObject(
                        "SELECT status FROM platform.recovery_task WHERE operation_id=?",
                        String.class,
                        operation.get("id")))
                .isEqualTo("DONE");
        assertThat(jdbc.queryForMap(
                        "SELECT provider_status,captured_amount_minor FROM platform.payment WHERE id=?", payment))
                .containsEntry("provider_status", "COMPLETED")
                .containsEntry("captured_amount_minor", 10000L);
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT * FROM platform.payment_attempt"))
                .containsEntry("provider_object_id", CAPTURE)
                .containsEntry("provider_status", "succeeded")
                .containsEntry("captured", true)
                .containsEntry("amount_captured_minor", 10000L)
                .containsEntry("balance_transaction_id", CAPTURE)
                .containsEntry("payment_intent_id", ORDER);
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT * FROM platform.balance_transaction"))
                .containsEntry("bt_id", CAPTURE)
                .containsEntry("state", "POSTED")
                .containsEntry("amount_minor", 10000L)
                .containsEntry("fee_minor", 349L)
                .containsEntry("net_minor", 9651L);
        assertThat(count("journal")).isEqualTo(1);
        var entries = jdbc.queryForList("""
                SELECT a.account_purpose,e.side,e.amount_minor FROM platform.journal_entry e
                JOIN platform.ledger_account a ON a.id=e.ledger_account_id ORDER BY a.account_purpose
                """);
        assertThat(entries)
                .containsExactly(
                        Map.of("account_purpose", "PSP_FEE_EXPENSE", "side", "DEBIT", "amount_minor", 349L),
                        Map.of("account_purpose", "PSP_FUNDS", "side", "DEBIT", "amount_minor", 9651L),
                        Map.of("account_purpose", "SALES_REVENUE", "side", "CREDIT", "amount_minor", 10000L));
        long debits = entries.stream()
                .filter(e -> e.get("side").equals("DEBIT"))
                .mapToLong(e -> ((Number) e.get("amount_minor")).longValue())
                .sum();
        long credits = entries.stream()
                .filter(e -> e.get("side").equals("CREDIT"))
                .mapToLong(e -> ((Number) e.get("amount_minor")).longValue())
                .sum();
        assertThat(debits).isEqualTo(credits);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.normalized_observation WHERE fact_key=?",
                        Long.class,
                        "CAPTURE:" + CAPTURE))
                .isEqualTo(1);
        assertThat(successNotifications()).isEqualTo(1);
        assertThat(captureOperationCount()).isEqualTo(1);
    }

    @Test
    void workerPathShowsApprovedNotCapturedThenCaptures() {
        UUID payment = create();
        approved(payment);
        fake.clock().advance(Duration.ofSeconds(6));
        recovery().recoverDue(10);
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "PROCESSING")
                .containsEntry("providerStatus", "APPROVED")
                .containsEntry("capturedAmountMinor", 0L)
                .containsEntry("resolutionStatus", "KNOWN")
                .containsEntry("financialStatus", "NOT_APPLICABLE");
        assertThat(captureOperationCount()).isEqualTo(1);
        assertThat(captureOperation().get("status")).isEqualTo("PREPARED");
        assertThat(captureCalls()).isEmpty();
        captureAndComplete(payment);
        recovery().recoverDue(10);
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "POSTED");
        assertThat(captureCalls()).hasSize(1);
        assertThat(captureCalls().getFirst().headers())
                .containsEntry(
                        "PayPal-Request-Id",
                        captureOperation().get("operation_key").toString());
    }

    @Test
    void repeatedQueriesAfterCaptureNeverCaptureOrPostAgain() {
        UUID payment = create();
        approved(payment);
        captureAndComplete(payment);
        completed(payment);
        completed(payment);
        service.get(context, payment);
        service.get(context, payment);
        var result = service.get(context, payment);
        assertThat(captureCalls()).hasSize(1);
        assertThat(captureOperationCount()).isEqualTo(1);
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(count("journal")).isEqualTo(1);
        assertThat(successNotifications()).isEqualTo(1);
        assertThat(result).containsEntry("financialStatus", "POSTED");
    }

    @Test
    void captureTimeoutIsUnknownAndNotResent() {
        UUID payment = create();
        approved(payment);
        transport.fail(new HttpTimeoutException("x"));
        approved(payment);
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "PROCESSING")
                .containsEntry("resolutionStatus", "UNKNOWN");
        assertThat(jdbc.queryForMap("SELECT provider_status,captured_amount_minor FROM platform.payment"))
                .containsEntry("provider_status", "APPROVED")
                .containsEntry("captured_amount_minor", 0L);
        assertThat(captureOperation().get("status")).isEqualTo("UNKNOWN");
        assertThat(count("balance_transaction")).isZero();
        service.get(context, payment);
        assertThat(captureCalls()).hasSize(1);
        assertThat(captureOperation().get("status")).isEqualTo("UNKNOWN");
    }

    @Test
    void missingIngestionPolicyDefersPostingUntilConfigured() {
        admin.update("DELETE FROM platform.ingestion_policy");
        UUID payment = create();
        approved(payment);
        captureAndComplete(payment);
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "PENDING_EVIDENCE");
        assertThat(count("balance_transaction")).isZero();
        assertThat(count("journal")).isZero();
        policy();
        completed(payment);
        assertThat(service.get(context, payment)).containsEntry("financialStatus", "POSTED");
        assertThat(count("journal")).isEqualTo(1);
        assertThat(captureCalls()).hasSize(1);
    }

    @Test
    void foreignCustomIdIsConflictAndNeverCaptures() {
        UUID payment = create();
        transport.reply(200, order(ORDER, "APPROVED", "00000000-0000-0000-0000-0000000000ee", false));
        assertThat(service.get(context, payment)).containsEntry("resolutionStatus", "CONFLICT");
        assertThat(captureOperationCount()).isZero();
        assertThat(captureCalls()).isEmpty();
    }

    @Test
    void orderNotApprovedRejectFollowsTheOrder() throws Exception {
        UUID payment = create();
        approved(payment);
        transport
                .reply(422, Files.readString(Path.of("../docs/adr/paypal-samples/03-capture-before-approval.json")))
                .reply(200, order(ORDER, "PAYER_ACTION_REQUIRED", payment.toString(), true));
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "AWAITING_CUSTOMER")
                .containsEntry("resolutionStatus", "KNOWN");
        var op = captureOperation();
        assertThat(op).containsEntry("status", "ACKNOWLEDGED").containsEntry("resolution", "KNOWN");
        assertThat(jdbc.queryForObject(
                        "SELECT status FROM platform.recovery_task WHERE operation_id=?", String.class, op.get("id")))
                .isEqualTo("DONE");
        assertThat(captureCalls()).hasSize(1);
        assertThat(count("balance_transaction")).isZero();
    }

    private UUID create() {
        transport.token().reply(201, order(ORDER, "PAYER_ACTION_REQUIRED", "$CUSTOM_ID", true));
        return payment(
                service.create(context, "pp-cap-0001", command("order-1")).resource());
    }

    private void approved(UUID payment) {
        transport.reply(200, order(ORDER, "APPROVED", payment.toString(), false));
    }

    private void completed(UUID payment) {
        transport.reply(200, capturedOrder(ORDER, payment.toString(), CAPTURE, "COMPLETED", true));
    }

    private void captureAndComplete(UUID payment) {
        transport.reply(201, captureResponse(ORDER, CAPTURE));
        completed(payment);
    }

    private List<PayPalTestTransport.Sent> captureCalls() {
        return transport.orderCalls().stream()
                .filter(c -> c.uri().getPath().endsWith("/capture"))
                .toList();
    }

    private Map<String, Object> captureOperation() {
        return jdbc.queryForMap("SELECT * FROM platform.provider_operation WHERE operation_type='CAPTURE_ORDER'");
    }

    private long captureOperationCount() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM platform.provider_operation WHERE operation_type='CAPTURE_ORDER'", Long.class);
    }

    private long successNotifications() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM platform.outbox_event WHERE event_type='payment.succeeded'", Long.class);
    }

    private void policy() {
        admin.update(
                "INSERT INTO platform.ingestion_policy(organization_id,environment_id,provider_account_id,livemode,opening_mode,business_zone) VALUES (?,?,?,false,'ZERO','UTC')",
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId());
    }

    private OperationRecoveryCoordinator recovery() {
        return new OperationRecoveryCoordinator(
                repository,
                executor,
                new RecoveryPolicy(
                        Duration.ofSeconds(30),
                        Duration.ofDays(1),
                        Duration.ofDays(1),
                        0,
                        Duration.ofHours(1),
                        Duration.ZERO));
    }
}
