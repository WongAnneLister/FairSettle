-- F18: refund proposals, their review, and the two application scopes they need.
DO $$
DECLARE matches integer; constraint_name text;
BEGIN
    SELECT count(*),min(conname::text) INTO matches,constraint_name
    FROM pg_constraint WHERE conrelid='platform.application_credential'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%granted_scopes%';
    IF matches<>1 THEN
        RAISE EXCEPTION 'Expected exactly one application credential scope CHECK, found %',matches;
    END IF;
    EXECUTE format('ALTER TABLE platform.application_credential DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE platform.application_credential ADD CONSTRAINT application_credential_scopes CHECK (
    granted_scopes <@ ARRAY['payments:read','payments:write','refunds:read','refunds:write','refund-proposals:read','refund-proposals:write']::text[]
    AND array_position(granted_scopes,NULL) IS NULL
);
CREATE TABLE platform.refund_proposal (
id uuid PRIMARY KEY,
organization_id uuid NOT NULL, environment_id uuid NOT NULL, application_id uuid NOT NULL,
provider_account_id uuid NOT NULL, currency text NOT NULL, payment_id uuid NOT NULL,
complaint_id text NOT NULL CHECK(complaint_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
order_ref text NOT NULL CHECK(length(order_ref) BETWEEN 1 AND 64),
decision text NOT NULL CHECK(decision IN ('FULL_REFUND','PARTIAL_REFUND')),
amount_minor bigint NOT NULL CHECK(amount_minor>0),
reason_code text NOT NULL CHECK(reason_code IN ('LATE_DELIVERY','MISSING_ITEM','WRONG_ITEM','QUALITY','DELIVERY_FAILED','OTHER')),
restaurant_bp integer NOT NULL CHECK(restaurant_bp BETWEEN 0 AND 10000),
driver_bp integer NOT NULL CHECK(driver_bp BETWEEN 0 AND 10000),
platform_bp integer NOT NULL CHECK(platform_bp BETWEEN 0 AND 10000),
explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='array' AND jsonb_array_length(evidence_refs) BETWEEN 1 AND 50),
agent_thread_id text NOT NULL CHECK(length(agent_thread_id) BETWEEN 1 AND 128),
agent_trace_id text CHECK(agent_trace_id IS NULL OR length(agent_trace_id) BETWEEN 1 AND 128),
idempotency_key text NOT NULL, request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
refund_key uuid NOT NULL UNIQUE,
status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
reviewer_id uuid, reviewer_subject text, reviewer_role text CHECK(reviewer_role IS NULL OR reviewer_role='OPS_REVIEWER'),
reviewed_at timestamptz,
rejection_reason text CHECK(rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 500),
refund_id uuid UNIQUE,
decision_idempotency_key text,
decision_fingerprint text CHECK(decision_fingerprint IS NULL OR decision_fingerprint ~ '^[a-f0-9]{64}$'),
created_at timestamptz NOT NULL DEFAULT now(),
CHECK(restaurant_bp+driver_bp+platform_bp=10000),
CHECK(
  (status='PENDING_REVIEW' AND reviewer_id IS NULL AND reviewer_subject IS NULL AND reviewer_role IS NULL
    AND reviewed_at IS NULL AND rejection_reason IS NULL AND refund_id IS NULL
    AND decision_idempotency_key IS NULL AND decision_fingerprint IS NULL)
  OR (status='APPROVED' AND reviewer_id IS NOT NULL AND reviewer_subject IS NOT NULL AND reviewer_role IS NOT NULL
    AND reviewed_at IS NOT NULL AND rejection_reason IS NULL AND refund_id IS NOT NULL
    AND decision_idempotency_key IS NOT NULL AND decision_fingerprint IS NOT NULL)
  OR (status='REJECTED' AND reviewer_id IS NOT NULL AND reviewer_subject IS NOT NULL AND reviewer_role IS NOT NULL
    AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL AND refund_id IS NULL
    AND decision_idempotency_key IS NOT NULL AND decision_fingerprint IS NOT NULL)),
UNIQUE(organization_id,environment_id,application_id,complaint_id),
UNIQUE(organization_id,environment_id,application_id,idempotency_key),
UNIQUE(organization_id,environment_id,decision_idempotency_key),
FOREIGN KEY(organization_id,environment_id,application_id,provider_account_id,currency,payment_id)
  REFERENCES platform.payment(organization_id,environment_id,application_id,provider_account_id,currency,id),
FOREIGN KEY(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,refund_id)
  REFERENCES platform.refund(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,id),
FOREIGN KEY(organization_id,reviewer_id) REFERENCES platform.ops_identity(organization_id,id));
CREATE INDEX refund_proposal_queue ON platform.refund_proposal(organization_id,environment_id,status,id);

CREATE FUNCTION platform.f18_proposal_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,platform AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Immutable refund proposal' USING ERRCODE='23514';
    END IF;
    IF OLD.status<>'PENDING_REVIEW' OR NEW.status='PENDING_REVIEW'
      OR (to_jsonb(NEW)-ARRAY['status','reviewer_id','reviewer_subject','reviewer_role','reviewed_at','rejection_reason','refund_id','decision_idempotency_key','decision_fingerprint'])
        IS DISTINCT FROM
         (to_jsonb(OLD)-ARRAY['status','reviewer_id','reviewer_subject','reviewer_role','reviewed_at','rejection_reason','refund_id','decision_idempotency_key','decision_fingerprint']) THEN
        RAISE EXCEPTION 'Immutable refund proposal or final review' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER refund_proposal_guard BEFORE UPDATE OR DELETE ON platform.refund_proposal
    FOR EACH ROW EXECUTE FUNCTION platform.f18_proposal_guard();

CREATE FUNCTION platform.f18_approved_liability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,platform AS $$
BEGIN
    IF NEW.status='APPROVED' AND (SELECT count(*) FROM platform.refund_liability
        WHERE refund_id=NEW.refund_id AND proposal_id=NEW.id)<>1 THEN
        RAISE EXCEPTION 'Approved proposal needs its liability allocation' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER refund_proposal_liability AFTER INSERT OR UPDATE ON platform.refund_proposal
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION platform.f18_approved_liability();
REVOKE ALL ON FUNCTION platform.f18_proposal_guard(),platform.f18_approved_liability() FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='payments_app') THEN
        REVOKE ALL ON platform.refund_proposal FROM payments_app;
        GRANT SELECT,INSERT,UPDATE ON platform.refund_proposal TO payments_app;
        REVOKE ALL ON FUNCTION platform.f18_proposal_guard(),platform.f18_approved_liability() FROM payments_app;
    END IF;
END $$;
