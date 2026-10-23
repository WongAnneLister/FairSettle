package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.provider.adapter.paypal.PayPalTestTransport;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;

class PayPalCaptureUnknownIT extends PayPalCaptureFixture {
    @Test
    void recoveryAdoptsCaptureThatLanded() {
        UUID payment = timeout();
        completed(payment);
        recovery().recoverDue(10);
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("resolutionStatus", "KNOWN")
                .containsEntry("financialStatus", "POSTED");
        assertThat(captureCalls()).hasSize(1);
        assertThat(captureOperation()).containsEntry("status", "RESOLVED");
        assertThat(captureTaskStatus()).isEqualTo("DONE");
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT state FROM platform.balance_transaction", String.class))
                .isEqualTo("POSTED");
        assertThat(count("journal")).isEqualTo(1);
        assertThat(successNotifications()).isEqualTo(1);
        assertOriginalRequestId();
    }

    @Test
    void approvedWithinWindowResendsWithOriginalRequestId() {
        UUID payment = timeout();
        int callsBeforeRecovery = transport.orderCalls().size();
        approved(payment);
        captureAndComplete(payment);
        recovery().recoverDue(10);
        var captures = captureCalls();
        assertThat(captures).hasSize(2);
        assertThat(captures.get(1).uri()).isEqualTo(captures.getFirst().uri());
        assertThat(captures.get(1).body()).isEqualTo(captures.getFirst().body());
        assertOriginalRequestId();
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "POSTED");
        assertThat(captureOperation()).containsEntry("status", "RESOLVED");
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(count("balance_transaction")).isEqualTo(1);
        assertThat(count("journal")).isEqualTo(1);
        assertThat(transport
                        .orderCalls()
                        .subList(callsBeforeRecovery, transport.orderCalls().size()))
                .extracting(PayPalTestTransport.Sent::method)
                .containsExactly("GET", "POST", "GET");
    }

    @Test
    void alreadyCapturedOnResendIsAdoptedInSameAttempt() throws Exception {
        UUID payment = timeout();
        approved(payment);
        transport.reply(
                422, Files.readString(Path.of("../docs/adr/paypal-samples/07-capture-again-new-request-id.json")));
        completed(payment);
        recovery().recoverDue(10);
        assertThat(captureCalls()).hasSize(2);
        assertThat(captureRequestIds()).hasSize(1);
        assertOriginalRequestId();
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "POSTED");
        assertThat(captureOperation()).containsEntry("status", "RESOLVED");
    }

    @Test
    void approvedAfterWindowEscalatesWithoutResend() {
        UUID payment = timeout();
        approved(payment);
        fake.clock().advance(Duration.ofHours(5));
        recovery().recoverDue(10);
        assertThat(captureCalls()).hasSize(1);
        assertOriginalRequestId();
        assertThat(captureOperation())
                .containsEntry("status", "ESCALATED")
                .containsEntry("escalation_reason", "CAPTURE_WINDOW_EXPIRED");
        assertThat(captureTaskStatus()).isEqualTo("ESCALATED");
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "PROCESSING")
                .containsEntry("providerStatus", "APPROVED")
                .containsEntry("resolutionStatus", "UNKNOWN")
                .containsEntry("capturedAmountMinor", 0L);
        assertThat(count("balance_transaction")).isZero();
    }

    @Test
    void failedQueryStaysUnknownThenEscalatesAtAgeLimit() {
        UUID payment = timeout();
        transport.reply(503, "{}");
        recovery().recoverDue(10);
        assertThat(captureCalls()).hasSize(1);
        assertThat(captureOperation()).containsEntry("status", "UNKNOWN");
        assertThat(repository.read(context, payment)).containsEntry("resolutionStatus", "UNKNOWN");
        transport.reply(503, "{}");
        fake.clock().advance(Duration.ofHours(1));
        recovery().recoverDue(10);
        assertThat(captureOperation())
                .containsEntry("status", "ESCALATED")
                .containsEntry("escalation_reason", "UNRESOLVED_AGE_LIMIT");
        assertThat(captureCalls()).hasSize(1);
        assertOriginalRequestId();
    }

    @Test
    void voidedOrderCancelsWithoutCapture() {
        UUID payment = timeout();
        transport.reply(200, order(ORDER, "VOIDED", payment.toString(), false));
        recovery().recoverDue(10);
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "CANCELED")
                .containsEntry("resolutionStatus", "KNOWN");
        assertThat(captureOperation()).containsEntry("status", "RESOLVED");
        assertThat(captureTaskStatus()).isEqualTo("DONE");
        assertThat(captureCalls()).hasSize(1);
        assertOriginalRequestId();
        assertThat(count("balance_transaction")).isZero();
    }

    @Test
    void declinedCaptureCancels() {
        UUID payment = timeout();
        transport.reply(200, capturedOrder(ORDER, payment.toString(), CAPTURE, "DECLINED", false));
        recovery().recoverDue(10);
        assertThat(repository.read(context, payment))
                .containsEntry("paymentStatus", "CANCELED")
                .containsEntry("resolutionStatus", "KNOWN");
        assertThat(count("payment_attempt")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT provider_status,captured FROM platform.payment_attempt"))
                .containsEntry("provider_status", "failed")
                .containsEntry("captured", false);
        assertThat(captureOperation()).containsEntry("status", "RESOLVED");
        assertThat(captureCalls()).hasSize(1);
        assertOriginalRequestId();
        assertThat(count("balance_transaction")).isZero();
    }

    @Test
    void voidedOrderWithCaptureIsConflict() throws Exception {
        UUID payment = timeout();
        var order = (ObjectNode) json.readTree(capturedOrder(ORDER, payment.toString(), CAPTURE, "COMPLETED", true));
        order.put("status", "VOIDED");
        transport.reply(200, order.toString());
        recovery().recoverDue(10);
        assertThat(repository.read(context, payment)).containsEntry("resolutionStatus", "CONFLICT");
        assertThat(captureCalls()).hasSize(1);
        assertOriginalRequestId();
        assertThat(count("balance_transaction")).isZero();
        assertThat(captureOperation().get("status")).isNotEqualTo("RESOLVED");
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

    private void assertOriginalRequestId() {
        assertThat(captureRequestIds())
                .containsExactly(captureOperation().get("operation_key").toString());
    }
}
