ALTER TABLE platform.refund_proposal DROP CONSTRAINT refund_proposal_reason_code_check;
ALTER TABLE platform.refund_proposal ADD CONSTRAINT refund_proposal_reason_code_check
    CHECK (reason_code IN ('LATE_DELIVERY','MISSING_ITEM','WRONG_ITEM','QUALITY','FOOD_SAFETY','DELIVERY_FAILED','OTHER'));
