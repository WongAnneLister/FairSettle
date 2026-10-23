package com.paymentsledger.payment;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.revenueshare.RevenueShareService;
import java.time.Clock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "platform.paypal.enabled", havingValue = "true")
public class CaptureSettlementConfiguration {
    @Bean
    CaptureSettlementService captureSettlementService(
            JdbcTemplate jdbc,
            PlatformTransactionManager tx,
            ObjectMapper mapper,
            LedgerPostingService posting,
            Clock clock,
            ObjectProvider<RefundEvidencePort> refunds,
            ObjectProvider<RevenueShareService> shares) {
        var replay = new FinancialReplayService(
                jdbc,
                tx,
                mapper,
                posting,
                refunds.getIfAvailable(RefundEvidencePort::unavailable),
                shares.getIfAvailable(RevenueShareService::disabled));
        return new CaptureSettlementService(new CaptureSettlementRepository(jdbc), tx, mapper, replay, clock);
    }
}
