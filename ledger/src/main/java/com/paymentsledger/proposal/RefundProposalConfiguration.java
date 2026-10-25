package com.paymentsledger.proposal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.liability.LiabilityService;
import com.paymentsledger.ops.OpsAuditService;
import com.paymentsledger.payment.RefundExecutor;
import com.paymentsledger.payment.RefundRepository;
import com.paymentsledger.proposal.repository.RefundProposalRepository;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration(proxyBeanMethods = false)
public class RefundProposalConfiguration {
    @Bean
    RefundProposalService refundProposalService(
            JdbcTemplate jdbc,
            PlatformTransactionManager manager,
            ObjectMapper mapper,
            RefundRepository refunds,
            LiabilityService liability,
            OpsAuditService audit,
            ObjectProvider<RefundExecutor> executor) {
        return new RefundProposalService(
                new RefundProposalRepository(jdbc),
                manager,
                mapper,
                refunds,
                liability,
                audit,
                () -> executor.getObject().providerName());
    }
}
