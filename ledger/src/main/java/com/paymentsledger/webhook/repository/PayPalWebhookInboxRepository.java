package com.paymentsledger.webhook.repository;

import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import com.paymentsledger.provider.ProviderScope;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** SQL for receiving PayPal webhooks into platform.webhook_inbox; runs inside the caller's transaction. */
@Repository
public class PayPalWebhookInboxRepository {
    public record NewEvent(
            UUID id,
            ProviderScope scope,
            String accountRef,
            VerifiedWebhook verified,
            String objectType,
            Instant receivedAt,
            Instant verifiedAt,
            String apiVersion,
            String rawDigest,
            String snapshotJson) {}

    public record Stored(UUID id, String rawDigest) {}

    private final JdbcTemplate jdbc;

    public PayPalWebhookInboxRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The binding query of WebhookInboxRepository#receive with provider='PAYPAL'. */
    public boolean bindingActive(ProviderScope scope, String accountRef) {
        return !jdbc.queryForList(
                        """
                SELECT p.id
                FROM platform.provider_account p
                JOIN platform.organization o ON o.id=p.organization_id
                JOIN platform.environment_config e ON e.id=p.environment_id AND e.organization_id=p.organization_id
                WHERE p.organization_id=?
                    AND p.environment_id=?
                    AND p.id=?
                    AND p.provider='PAYPAL'
                    AND p.provider_account_ref=?
                    AND p.status='ACTIVE'
                    AND o.status='ACTIVE'
                    AND e.status='ACTIVE'
                    AND NOT p.livemode
                    AND NOT e.livemode
                """, scope.organizationId(), scope.environmentId(), scope.providerAccountId(), accountRef)
                .isEmpty();
    }

    /** The INSERT of WebhookInboxRepository#receive with livemode false and available_at = receivedAt; 1 or 0. */
    public int insert(NewEvent event) {
        var scope = event.scope();
        var verified = event.verified();
        return jdbc.update(
                """
                INSERT INTO platform.webhook_inbox(id,organization_id,environment_id,provider_account_id,livemode,
                    provider_account_ref,event_id,event_type,object_id,object_type,event_created_at,received_at,
                    verified_at,api_version,raw_digest,object_snapshot,available_at)
                VALUES (?,?,?,?,false,?,?,?,?,?,?,?,?,?,?,?::jsonb,?)
                ON CONFLICT(organization_id,environment_id,provider_account_id,livemode,event_id)
                DO NOTHING
                """,
                event.id(),
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId(),
                event.accountRef(),
                verified.eventId(),
                verified.eventType(),
                verified.objectId(),
                event.objectType(),
                Timestamp.from(verified.createdAt()),
                Timestamp.from(event.receivedAt()),
                Timestamp.from(event.verifiedAt()),
                event.apiVersion(),
                event.rawDigest(),
                event.snapshotJson(),
                Timestamp.from(event.receivedAt()));
    }

    public Optional<Stored> stored(ProviderScope scope, String eventId) {
        return jdbc
                .query(
                        """
                SELECT id,raw_digest FROM platform.webhook_inbox
                WHERE organization_id=? AND environment_id=? AND provider_account_id=? AND NOT livemode AND event_id=?
                """,
                        (rs, row) -> new Stored(rs.getObject("id", UUID.class), rs.getString("raw_digest")),
                        scope.organizationId(),
                        scope.environmentId(),
                        scope.providerAccountId(),
                        eventId)
                .stream()
                .findFirst();
    }
}
