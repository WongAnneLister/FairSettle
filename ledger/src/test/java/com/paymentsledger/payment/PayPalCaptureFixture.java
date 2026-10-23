package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.payment.repository.PaymentRepositories;
import com.paymentsledger.provider.adapter.paypal.*;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.mock.env.MockEnvironment;

abstract class PayPalCaptureFixture extends PaymentCoreFixture {
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

    UUID create() {
        transport.token().reply(201, order(ORDER, "PAYER_ACTION_REQUIRED", "$CUSTOM_ID", true));
        return payment(
                service.create(context, "pp-cap-0001", command("order-1")).resource());
    }

    void approved(UUID payment) {
        transport.reply(200, order(ORDER, "APPROVED", payment.toString(), false));
    }

    void completed(UUID payment) {
        transport.reply(200, capturedOrder(ORDER, payment.toString(), CAPTURE, "COMPLETED", true));
    }

    void captureAndComplete(UUID payment) {
        transport.reply(201, captureResponse(ORDER, CAPTURE));
        completed(payment);
    }

    List<PayPalTestTransport.Sent> captureCalls() {
        return transport.orderCalls().stream()
                .filter(c -> c.uri().getPath().endsWith("/capture"))
                .toList();
    }

    Map<String, Object> captureOperation() {
        return jdbc.queryForMap("SELECT * FROM platform.provider_operation WHERE operation_type='CAPTURE_ORDER'");
    }

    long captureOperationCount() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM platform.provider_operation WHERE operation_type='CAPTURE_ORDER'", Long.class);
    }

    long successNotifications() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM platform.outbox_event WHERE event_type='payment.succeeded'", Long.class);
    }

    void policy() {
        admin.update(
                "INSERT INTO platform.ingestion_policy(organization_id,environment_id,provider_account_id,livemode,opening_mode,business_zone) VALUES (?,?,?,false,'ZERO','UTC')",
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId());
    }

    OperationRecoveryCoordinator recovery() {
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

    void onlyCaptureTaskRecovers() {
        admin.update(
                "UPDATE platform.recovery_task SET status='DONE' WHERE operation_id=(SELECT id FROM platform.provider_operation WHERE operation_type='CREATE_CHECKOUT')");
    }

    Set<String> captureRequestIds() {
        return captureCalls().stream()
                .map(call -> call.headers().get("PayPal-Request-Id"))
                .collect(java.util.stream.Collectors.toSet());
    }
}
