package com.paymentsledger.payment;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.common.error.*;
import com.paymentsledger.payment.repository.PaymentRepositories;
import com.paymentsledger.provider.adapter.paypal.*;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class PayPalCreateOrderIT extends PaymentCoreFixture {
    static final String ORDER = "7CV2269518094610C";
    final PayPalTestTransport transport = new PayPalTestTransport();

    @BeforeEach
    void configurePayPal() {
        admin.update(
                "UPDATE platform.provider_account SET provider='PAYPAL', provider_account_ref='client-fixture' WHERE id=?",
                id(4));
        var env = new MockEnvironment()
                .withProperty("platform.paypal.enabled", "true")
                .withProperty("platform.paypal.client-id", "client-fixture")
                .withProperty("platform.paypal.organization-id", id(1).toString())
                .withProperty("platform.paypal.environment-id", id(2).toString())
                .withProperty("platform.paypal.provider-account-id", id(4).toString());
        repository = new PaymentRepository(
                new PaymentRepositories(jdbc), tx, new ObjectMapper().findAndRegisterModules(), fake.clock(), env);
        var adapter = new PayPalCheckoutAdapter(transport.client(fake.clock()), scope, fake.clock());
        executor = new PaymentExecutor(repository, adapter, null, null, "PAYPAL");
        service = new PaymentService(repository, executor);
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

    @Test
    void createReturnsApprovalLinkAndReplaySendsNothing() {
        transport.token().reply(201, order());
        var first = service.create(context, "pp-key-0001", command("order-1"));
        assertThat(first.replay()).isFalse();
        assertThat(first.resource())
                .containsEntry("paymentStatus", "AWAITING_CUSTOMER")
                .containsEntry("resolutionStatus", "KNOWN");
        assertThat(session(first.resource())).isEqualTo(ORDER);
        assertThat(((Map<?, ?>) first.resource().get("nextAction")).get("type"))
                .isEqualTo("REDIRECT_TO_HOSTED_CHECKOUT");
        assertThat(((Map<?, ?>) first.resource().get("nextAction")).get("hostedUrl"))
                .isEqualTo("https://www.sandbox.paypal.com/checkoutnow?token=" + ORDER);
        assertThat(jdbc.queryForObject("SELECT provider_status FROM platform.payment", String.class))
                .isEqualTo("PAYER_ACTION_REQUIRED");
        assertThat(transport.orderCalls().getFirst().headers()).containsEntry("PayPal-Request-Id", operationKey());
        var replay = service.create(context, "pp-key-0001", command("order-1"));
        assertThat(replay.replay()).isTrue();
        assertThat(replay.resource().get("id")).isEqualTo(first.resource().get("id"));
        assertThat(transport.orderCalls()).hasSize(1);
    }

    @Test
    void sameKeyDifferentRequestIsConflict() {
        transport.token().reply(201, order());
        service.create(context, "pp-key-0001", command("order-1"));
        assertThatThrownBy(() -> service.create(context, "pp-key-0001", command("order-2")))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.IDEMPOTENCY_CONFLICT));
        assertThat(transport.orderCalls()).hasSize(1);
    }

    @Test
    void lostResponseIsResentWithOriginalRequestIdOnly() {
        transport.token().fail(new HttpTimeoutException("fixture timeout")).reply(200, order());
        assertThatThrownBy(() -> service.create(context, "pp-key-0001", command("order-1")))
                .isInstanceOf(ApiException.class);
        UUID payment = jdbc.queryForObject("SELECT id FROM platform.payment", UUID.class);
        assertThat(repository.read(context, payment)).containsEntry("resolutionStatus", "UNKNOWN");
        fake.clock().advance(Duration.ofSeconds(6));
        recovery().recoverDue(10);
        var result = repository.read(context, payment);
        assertThat(result).containsEntry("resolutionStatus", "KNOWN");
        assertThat(session(result)).isEqualTo(ORDER);
        assertThat(transport.orderCalls()).hasSize(2);
        assertThat(transport.orderCalls().getFirst())
                .isEqualTo(transport.orderCalls().get(1));
        assertThat(transport.orderCalls().getFirst().headers()).containsEntry("PayPal-Request-Id", operationKey());
    }

    @Test
    void noResendOutsideWindow() {
        transport.token().fail(new HttpTimeoutException("fixture timeout"));
        assertThatThrownBy(() -> service.create(context, "pp-key-0001", command("order-1")))
                .isInstanceOf(ApiException.class);
        fake.clock().advance(Duration.ofHours(6));
        recovery().recoverDue(10);
        assertThat(transport.orderCalls()).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT resolution_status FROM platform.payment", String.class))
                .isEqualTo("UNKNOWN");
        assertThat(jdbc.queryForObject("SELECT status FROM platform.recovery_task", String.class))
                .isEqualTo("ESCALATED");
    }

    @Test
    void otherClientBindingIsRefusedBeforeSending() {
        admin.update("UPDATE platform.provider_account SET provider_account_ref='other-client' WHERE id=?", id(4));
        assertThatThrownBy(() -> service.create(context, "pp-key-0001", command("order-1")))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
        assertThat(transport.calls()).isEmpty();
        assertThat(count("payment")).isZero();
    }

    private String operationKey() {
        return jdbc.queryForObject("SELECT operation_key FROM platform.provider_operation", String.class);
    }

    private String order() {
        return PayPalTestTransport.order(ORDER, "PAYER_ACTION_REQUIRED", "$CUSTOM_ID", true);
    }
}
