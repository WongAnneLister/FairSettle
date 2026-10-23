package com.paymentsledger.webhook.repository;

import com.paymentsledger.provider.ProviderScope;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Lookups that link PayPal webhook events to local payments and refunds; runs in the caller's transaction, if any. */
@Repository
public class PayPalWebhookPaymentRepository {
    private final JdbcTemplate jdbc;

    public PayPalWebhookPaymentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Up to two payment ids, ordered by id, whose checkout_session_id is the PayPal order id, in scope. */
    public List<UUID> paymentsForOrder(ProviderScope scope, String orderId) {
        return jdbc.queryForList(
                """
                SELECT id FROM platform.payment
                WHERE organization_id=? AND environment_id=? AND provider_account_id=? AND checkout_session_id=?
                ORDER BY id LIMIT 2
                """, UUID.class, scope.organizationId(), scope.environmentId(), scope.providerAccountId(), orderId);
    }

    /** The payment of a local refund in scope, or empty. */
    public Optional<UUID> refundPayment(ProviderScope scope, UUID refundId) {
        return jdbc
                .queryForList(
                        """
                SELECT payment_id FROM platform.refund
                WHERE id=? AND organization_id=? AND environment_id=? AND provider_account_id=?
                """,
                        UUID.class,
                        refundId,
                        scope.organizationId(),
                        scope.environmentId(),
                        scope.providerAccountId())
                .stream()
                .findFirst();
    }
}
