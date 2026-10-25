package com.paymentsledger.liability;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.liability.repository.LiabilityRepository;
import com.paymentsledger.payment.repository.RefundRecordRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration(proxyBeanMethods = false)
public class LiabilityConfiguration {
    @Bean
    LiabilityService liabilityService(
            JdbcTemplate jdbc, PlatformTransactionManager manager, ObjectMapper mapper, LedgerPostingService ledger) {
        return new LiabilityService(
                new LiabilityRepository(jdbc), manager, mapper, ledger, new RefundRecordRepository(jdbc));
    }

    @Bean
    @Profile("worker")
    @ConditionalOnProperty(name = "platform.liability.enabled", havingValue = "true", matchIfMissing = true)
    LiabilityWorker liabilityWorker(LiabilityService service) {
        return new LiabilityWorker(service);
    }
}
