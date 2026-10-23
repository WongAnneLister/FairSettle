package com.paymentsledger.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.common.error.*;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import com.paymentsledger.webhook.repository.PayPalWebhookInboxRepository;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Stores a verified PayPal event once; no business processing. */
@Component
public class PayPalWebhookReceiver {
    private final PayPalWebhookInboxRepository inbox;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final Clock clock;

    public PayPalWebhookReceiver(
            PayPalWebhookInboxRepository inbox, PlatformTransactionManager manager, ObjectMapper json, Clock clock) {
        this.inbox = inbox;
        this.json = json;
        this.clock = clock;
        tx = new TransactionTemplate(manager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    public WebhookInboxRepository.Receipt receive(
            ProviderScope scope, String accountRef, byte[] raw, ProviderCallResult<VerifiedWebhook> verified) {
        JsonNode event;
        ObjectNode snapshot;
        try {
            event = json.readTree(raw);
            if (verified == null
                    || verified.classification() != ProviderCallClassification.SUCCESS
                    || verified.payload() == null
                    || scope.livemode()
                    || !PayPalWebhookEvents.matches(event, verified.payload())) throw invalid();
            snapshot = PayPalWebhookEvents.snapshot(event, json);
        } catch (IOException | IllegalArgumentException invalid) {
            throw invalid();
        }
        String digest = WebhookNormalizer.digest(raw);
        Instant now = clock.instant();
        return tx.execute(status -> {
            if (!inbox.bindingActive(scope, accountRef))
                throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "Webhook account binding unavailable");
            UUID id = UUID.randomUUID();
            Instant verifiedAt = verified.evidence().respondedAt() == null
                    ? now
                    : verified.evidence().respondedAt();
            int inserted = inbox.insert(new PayPalWebhookInboxRepository.NewEvent(
                    id,
                    scope,
                    accountRef,
                    verified.payload(),
                    snapshot.path("object").asText(),
                    now,
                    verifiedAt,
                    "paypal-notifications-v1",
                    digest,
                    snapshot.toString()));
            if (inserted == 1) return new WebhookInboxRepository.Receipt(id, false);
            var previous =
                    inbox.stored(scope, verified.payload().eventId()).orElseThrow(PayPalWebhookReceiver::conflict);
            if (!digest.equals(previous.rawDigest())) throw conflict();
            return new WebhookInboxRepository.Receipt(previous.id(), true);
        });
    }

    private static ApiException invalid() {
        return new ApiException(ErrorCode.SIGNATURE_VERIFICATION_FAILED, "Verified webhook does not match event");
    }

    private static ApiException conflict() {
        return new ApiException(ErrorCode.EVIDENCE_CONFLICT, "Webhook event content conflict");
    }
}
