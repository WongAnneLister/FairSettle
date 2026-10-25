package com.paymentsledger.liability;

public enum LiabilityParty {
    RESTAURANT("REFUND_RECEIVABLE_RESTAURANT"),
    DRIVER("REFUND_RECEIVABLE_DRIVER"),
    PLATFORM("REFUND_COST_PLATFORM");

    private final String accountPurpose;

    LiabilityParty(String accountPurpose) {
        this.accountPurpose = accountPurpose;
    }

    public String accountPurpose() {
        return accountPurpose;
    }
}
