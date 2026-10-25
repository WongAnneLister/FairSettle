package com.paymentsledger.liability;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

public final class LiabilityWorker {
    private static final Logger LOG = LoggerFactory.getLogger(LiabilityWorker.class);
    private final LiabilityService service;

    public LiabilityWorker(LiabilityService service) {
        this.service = service;
    }

    @Scheduled(
            fixedDelayString = "${platform.liability.poll-ms:30000}",
            initialDelayString = "${platform.liability.poll-ms:30000}")
    public void tick() {
        try {
            service.postReady(25);
        } catch (RuntimeException e) {
            LOG.warn("liability_post reason=RETRY_REQUIRED");
        }
    }
}
