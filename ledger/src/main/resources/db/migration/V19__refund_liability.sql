-- F17: refund liability allocation, three party accounts and their posting guard.
DO $$
DECLARE matches integer; constraint_name text;
BEGIN
    SELECT count(*),min(conname::text) INTO matches,constraint_name
    FROM pg_constraint WHERE conrelid='platform.ledger_account'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%PARTNER_PAYABLE%';
    IF matches<>1 THEN
        RAISE EXCEPTION 'Expected exactly one ledger account purpose CHECK, found %',matches;
    END IF;
    EXECUTE format('ALTER TABLE platform.ledger_account DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE platform.ledger_account ADD CONSTRAINT ledger_account_purpose_shape CHECK (
    (account_purpose IN ('PSP_FUNDS','BANK_PAYOUT_IN_TRANSIT','DISPUTE_RECEIVABLE',
        'PSP_FEE_EXPENSE','DISPUTE_FEE_EXPENSE','SUSPENSE') AND source_domain='PROVIDER'
        AND provider_account_id IS NOT NULL AND balance_domain IS NOT NULL AND balance_domain='PAYMENTS')
    OR (account_purpose IN ('BANK_CASH','BANK_FEE_EXPENSE') AND source_domain='SIMULATED_BANK'
        AND provider_account_id IS NULL AND balance_domain IS NULL)
    OR (account_purpose IN ('SALES_REVENUE','SALES_RETURNS','DISPUTE_LOSS',
        'PARTNER_SHARE_EXPENSE','PARTNER_PAYABLE','OPENING_EQUITY',
        'REFUND_RECEIVABLE_RESTAURANT','REFUND_RECEIVABLE_DRIVER','REFUND_COST_PLATFORM') AND source_domain='INTERNAL'
        AND provider_account_id IS NULL AND balance_domain IS NULL)
);
CREATE TABLE platform.refund_liability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL, environment_id uuid NOT NULL, application_id uuid NOT NULL,
    provider_account_id uuid NOT NULL, currency text NOT NULL, payment_id uuid NOT NULL,
    refund_id uuid NOT NULL UNIQUE, proposal_id uuid NOT NULL UNIQUE,
    amount_minor bigint NOT NULL CHECK(amount_minor>0),
    restaurant_bp integer NOT NULL CHECK(restaurant_bp BETWEEN 0 AND 10000),
    driver_bp integer NOT NULL CHECK(driver_bp BETWEEN 0 AND 10000),
    platform_bp integer NOT NULL CHECK(platform_bp BETWEEN 0 AND 10000),
    restaurant_minor bigint NOT NULL CHECK(restaurant_minor>=0),
    driver_minor bigint NOT NULL CHECK(driver_minor>=0),
    platform_minor bigint NOT NULL CHECK(platform_minor>=0),
    posting_status text NOT NULL DEFAULT 'PENDING' CHECK(posting_status IN ('PENDING','POSTED')),
    journal_id uuid UNIQUE, posted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(restaurant_bp+driver_bp+platform_bp=10000),
    CHECK(restaurant_minor=floor(amount_minor::numeric*restaurant_bp/10000)),
    CHECK(driver_minor=floor(amount_minor::numeric*driver_bp/10000)),
    CHECK(restaurant_minor::numeric+driver_minor+platform_minor=amount_minor),
    CHECK((posting_status='POSTED')=(journal_id IS NOT NULL) AND (journal_id IS NULL)=(posted_at IS NULL)),
    FOREIGN KEY(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,refund_id)
        REFERENCES platform.refund(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,id),
    FOREIGN KEY(organization_id,environment_id,currency,journal_id)
        REFERENCES platform.journal(organization_id,environment_id,currency,id)
);
CREATE INDEX refund_liability_pending ON platform.refund_liability(created_at,id) WHERE posting_status='PENDING';

CREATE FUNCTION platform.f17_liability_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,platform AS $$
DECLARE refund_amount bigint;
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Immutable refund liability' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' THEN
        SELECT amount_minor INTO refund_amount FROM platform.refund WHERE id=NEW.refund_id;
        IF NEW.posting_status IS DISTINCT FROM 'PENDING' OR NEW.journal_id IS NOT NULL
            OR NEW.posted_at IS NOT NULL OR NEW.amount_minor IS DISTINCT FROM refund_amount THEN
            RAISE EXCEPTION 'Invalid initial refund liability' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF (NEW.id,NEW.organization_id,NEW.environment_id,NEW.application_id,NEW.provider_account_id,
        NEW.currency,NEW.payment_id,NEW.refund_id,NEW.proposal_id,NEW.amount_minor,
        NEW.restaurant_bp,NEW.driver_bp,NEW.platform_bp,NEW.restaurant_minor,NEW.driver_minor,NEW.platform_minor,NEW.created_at)
        IS DISTINCT FROM
       (OLD.id,OLD.organization_id,OLD.environment_id,OLD.application_id,OLD.provider_account_id,
        OLD.currency,OLD.payment_id,OLD.refund_id,OLD.proposal_id,OLD.amount_minor,
        OLD.restaurant_bp,OLD.driver_bp,OLD.platform_bp,OLD.restaurant_minor,OLD.driver_minor,OLD.platform_minor,OLD.created_at)
        OR OLD.posting_status IS DISTINCT FROM 'PENDING' OR NEW.posting_status IS DISTINCT FROM 'POSTED' THEN
        RAISE EXCEPTION 'Immutable refund liability' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM platform.journal j JOIN platform.financial_event f ON f.id=j.financial_event_id
        WHERE j.id=NEW.journal_id AND f.event_key='liability.allocate:'||NEW.refund_id::text
          AND f.event_type='L-LIABILITY' AND f.source_domain='INTERNAL' AND f.source_ref=NEW.id::text
    ) THEN
        RAISE EXCEPTION 'Refund liability journal does not match allocation' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER refund_liability_guard BEFORE INSERT OR UPDATE OR DELETE ON platform.refund_liability
    FOR EACH ROW EXECUTE FUNCTION platform.f17_liability_guard();

CREATE FUNCTION platform.ensure_liability_accounts(refund_arg uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,platform AS $$
BEGIN
    INSERT INTO platform.ledger_account(organization_id,environment_id,currency,account_purpose,source_domain)
    SELECT r.organization_id,r.environment_id,r.currency,purpose,'INTERNAL' FROM platform.refund r
    CROSS JOIN (VALUES('REFUND_COST_PLATFORM'),('REFUND_RECEIVABLE_DRIVER'),('REFUND_RECEIVABLE_RESTAURANT'),('SALES_RETURNS')) purposes(purpose)
    WHERE r.id=refund_arg ORDER BY purpose ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION platform.f17_liability_guard(),platform.ensure_liability_accounts(uuid) FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='payments_app') THEN
        REVOKE ALL ON platform.refund_liability FROM payments_app;
        GRANT SELECT,INSERT,UPDATE ON platform.refund_liability TO payments_app;
        GRANT EXECUTE ON FUNCTION platform.ensure_liability_accounts(uuid) TO payments_app;
        REVOKE ALL ON FUNCTION platform.f17_liability_guard() FROM payments_app;
    END IF;
END $$;
