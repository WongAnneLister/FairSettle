package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import com.paymentsledger.common.error.*;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.identity.*;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.liability.*;
import com.paymentsledger.liability.repository.LiabilityRepository;
import com.paymentsledger.ops.OpsAuditService;
import com.paymentsledger.payment.repository.*;
import com.paymentsledger.proposal.*;
import com.paymentsledger.proposal.repository.RefundProposalRepository;
import com.paymentsledger.provider.adapter.paypal.*;
import com.paymentsledger.refund.RefundFinancialEvidence;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.support.TransactionTemplate;

class RefundProposalApiTest extends PayPalCaptureFixture {
    final TenantContext refundsContext = new TenantContext(
            id(1), id(2), id(3), id(4), Set.of("USD"), false, Set.of("refunds:read", "refunds:write"));
    final TenantContext agent =
            tenant(id(3), Set.of("USD"), Set.of("refund-proposals:write", "refund-proposals:read", "payments:read"));
    RefundRepository refunds;
    RefundExecutor refundExecutor;
    LiabilityService liability;
    RefundProposalService proposals;
    UUID payment;
    boolean refundTokenQueued;

    @BeforeEach
    void configurePosting() {
        refunds = new RefundRepository(new PaymentRepositories(jdbc), tx, json, fake.clock(), repository);
        var settlement = new CaptureSettlementService(
                new CaptureSettlementRepository(jdbc),
                tx,
                json,
                new FinancialReplayService(
                        jdbc, tx, json, new LedgerPostingService(jdbc, json), new RefundFinancialEvidence(refunds)),
                fake.clock());
        var adapter = new PayPalRefundAdapter(transport.client(fake.clock()), scope, fake.clock());
        refundExecutor = new RefundExecutor(repository, refunds, adapter, adapter, settlement, "PAYPAL");
        liability = new LiabilityService(
                new LiabilityRepository(jdbc),
                tx,
                json,
                new LedgerPostingService(jdbc, json),
                new RefundRecordRepository(jdbc));
        proposals = new RefundProposalService(
                new RefundProposalRepository(jdbc),
                tx,
                json,
                refunds,
                liability,
                new OpsAuditService(jdbc, json, tx),
                () -> "PAYPAL");
        for (int i = 1; i <= 4; i++) {
            String[] roles = {"OPS_VIEWER", "OPS_REVIEWER", "OPS_OPERATOR", "OPS_ADMIN"};
            String[] subjects = {"viewer", "reviewer", "operator", "admin"};
            admin.update(
                    "INSERT INTO platform.ops_identity(id,organization_id,subject,role) VALUES (?,?,?,?)",
                    id(50 + i),
                    id(1),
                    subjects[i - 1],
                    roles[i - 1]);
        }
    }

    @Test
    void createStoresAPendingProposalAndReservesNothing() {
        paid();
        var result = createProposal("create", 450, 10000, 0, 0);
        assertThat(result.replay()).isFalse();
        var b = result.body();
        assertThat(b.path("status").asText()).isEqualTo("PENDING_REVIEW");
        assertThat(b.path("id").asText()).startsWith("prop_");
        assertThat(b.path("paymentId").asText()).isEqualTo(PaymentIds.format("pay", payment));
        assertThat(b.path("liability"))
                .isEqualTo(body("create", 450, 10000, 0, 0).path("liability"));
        assertThat(b.path("agentRun").path("threadId").asText()).isEqualTo("refund-thread-001");
        nullFields(b, "reviewedAt", "reviewer", "rejectionReason", "refundId", "allocation");
        assertThat(count("refund_proposal")).isEqualTo(1);
        assertThat(count("refund")).isZero();
        assertThat(count("refund_liability")).isZero();
        assertThat(reserved()).isZero();
    }

    @Test
    void sameKeySameBodyReplays() {
        paid();
        var b = body("replay", 450, 10000, 0, 0);
        var first = proposals.create(agent, key("replay"), b);
        var second = proposals.create(agent, key("replay"), b);
        assertThat(second.replay()).isTrue();
        assertThat(second.body()).isEqualTo(first.body());
        var reversed = b.deepCopy();
        reversed.putArray("liability")
                .add(b.path("liability").get(2))
                .add(b.path("liability").get(1))
                .add(b.path("liability").get(0));
        var third = proposals.create(agent, key("replay"), reversed);
        assertThat(third.replay()).isTrue();
        assertThat(third.body()).isEqualTo(first.body());
        assertThat(count("refund_proposal")).isEqualTo(1);
    }

    @Test
    void sameKeyDifferentBodyConflicts() {
        paid();
        createProposal("conflict", 450, 10000, 0, 0);
        fails(
                () -> proposals.create(agent, key("conflict"), body("conflict", 451, 10000, 0, 0)),
                ErrorCode.IDEMPOTENCY_CONFLICT);
        assertThat(count("refund_proposal")).isEqualTo(1);
    }

    @Test
    void newKeySameComplaintIsProposalExists() {
        paid();
        var first = createProposal("complaint", 450, 10000, 0, 0);
        assertThatThrownBy(() -> proposals.create(agent, "refund-proposal:other", body("complaint", 450, 10000, 0, 0)))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.errorCode()).isEqualTo(ErrorCode.PROPOSAL_EXISTS);
                    assertThat(e.details())
                            .containsExactly(new ApiError.Detail(
                                    "complaintId", first.body().path("id").asText()));
                });
    }

    @Test
    void invalidRequestsAreRejected() {
        paid();
        invalid("unknown", b -> b.put("unexpected", true), ErrorCode.VALIDATION_ERROR);
        invalid("agent", b -> ((ObjectNode) b.path("agentRun")).put("unexpected", true), ErrorCode.VALIDATION_ERROR);
        invalid("long", b -> b.put("explanation", "x".repeat(2001)), ErrorCode.VALIDATION_ERROR);
        invalid("evidence", b -> b.putArray("evidenceRefs"), ErrorCode.VALIDATION_ERROR);
        invalid("short", b -> ((ArrayNode) b.path("liability")).remove(2), ErrorCode.VALIDATION_ERROR);
        invalid(
                "bps",
                b -> ((ObjectNode) b.path("liability").get(0)).put("basisPoints", 10001),
                ErrorCode.VALIDATION_ERROR);
        invalid(
                "fraction",
                b -> b.set("amountMinor", DecimalNode.valueOf(new java.math.BigDecimal("1.5"))),
                ErrorCode.VALIDATION_ERROR);
        invalid(
                "party",
                b -> ((ObjectNode) b.path("liability").get(0)).put("party", "COURIER"),
                ErrorCode.VALIDATION_ERROR);
        invalid("decision", b -> b.put("decision", "REJECT"), ErrorCode.VALIDATION_ERROR);
        fails(() -> createProposal("sum", 450, 3333, 3333, 3333), ErrorCode.LIABILITY_SPLIT_INVALID);
        invalid(
                "duplicate",
                b -> ((ObjectNode) b.path("liability").get(1)).put("party", "RESTAURANT"),
                ErrorCode.LIABILITY_SPLIT_INVALID);
        assertThatThrownBy(() -> proposals.create(
                        agent,
                        key("currency"),
                        body("currency", 450, 10000, 0, 0).put("currency", "JPY")))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.errorCode()).isEqualTo(ErrorCode.VALIDATION_ERROR);
                    assertThat(e.details())
                            .containsExactly(new ApiError.Detail("currency", "must equal the payment currency"));
                });
        fails(() -> proposals.create(agent, null, body("key", 450, 10000, 0, 0)), ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
        invalid("missing", b -> b.put("paymentId", PaymentIds.format("pay", UUID.randomUUID())), ErrorCode.NOT_FOUND);
        fails(() -> createProposal("limit", 10001, 10000, 0, 0), ErrorCode.REFUND_LIMIT_EXCEEDED);
        fails(
                () -> proposals.create(
                        tenant(id(3), Set.of("USD"), Set.of()), key("scope"), body("scope", 450, 10000, 0, 0)),
                ErrorCode.FORBIDDEN);
        assertThat(count("refund_proposal")).isZero();
    }

    @Test
    void blockedControlRejectsCreation() {
        paid();
        block();
        fails(() -> createProposal("blocked", 450, 10000, 0, 0), ErrorCode.REFUND_BLOCKED);
        assertThat(count("refund_proposal")).isZero();
    }

    @Test
    void getIsScoped() {
        paid();
        var b = createProposal("get", 450, 10000, 0, 0).body();
        UUID id = proposalId(b);
        assertThat(proposals.get(agent, id)).isEqualTo(b);
        fails(() -> proposals.get(tenant(id(9), Set.of("USD"), agent.grantedScopes()), id), ErrorCode.NOT_FOUND);
        fails(() -> proposals.get(tenant(id(3), Set.of("EUR"), agent.grantedScopes()), id), ErrorCode.NOT_FOUND);
        fails(() -> proposals.get(tenant(id(3), Set.of("USD"), Set.of()), id), ErrorCode.FORBIDDEN);
    }

    @Test
    void refundableAmountFollowsReservations() {
        paid();
        var first = proposals.refundable(agent, payment);
        assertThat(first.properties().stream().map(Map.Entry::getKey).toList())
                .containsExactly(
                        "paymentId",
                        "currency",
                        "capturedMinor",
                        "refundedMinor",
                        "reservedMinor",
                        "refundableMinor",
                        "controlState");
        assertThat(first.path("capturedMinor").asLong()).isEqualTo(10000);
        assertThat(first.path("refundedMinor").asLong()).isZero();
        assertThat(first.path("reservedMinor").asLong()).isZero();
        assertThat(first.path("refundableMinor").asLong()).isEqualTo(10000);
        assertThat(first.path("controlState").asText()).isEqualTo("NORMAL");
        approve(createProposal("available", 450, 10000, 0, 0).body());
        var second = proposals.refundable(agent, payment);
        assertThat(second.path("reservedMinor").asLong()).isEqualTo(450);
        assertThat(second.path("refundableMinor").asLong()).isEqualTo(9550);
        block();
        var third = proposals.refundable(agent, payment);
        assertThat(third.path("refundableMinor").asLong()).isZero();
        assertThat(third.path("controlState").asText()).isEqualTo("DISPUTE_BLOCKED");
    }

    @Test
    void approveReservesTheRefundAndRecordsTheSplitAtomically() {
        paid();
        var pending = createProposal("approve", 1250, 3333, 3333, 3334).body();
        var result = approve(pending);
        assertThat(result.replay()).isFalse();
        var b = result.body();
        assertThat(b.path("status").asText()).isEqualTo("APPROVED");
        assertThat(b.path("reviewer"))
                .isEqualTo(json.createObjectNode().put("subject", "reviewer").put("role", "OPS_REVIEWER"));
        assertThat(b.path("reviewedAt").asText()).isNotBlank();
        nullFields(b, "rejectionReason");
        assertThat(b.path("refundId").asText()).startsWith("ref_");
        assertThat(b.path("allocation").path("lines").findValues("amountMinor"))
                .containsExactly(LongNode.valueOf(416), LongNode.valueOf(416), LongNode.valueOf(418));
        assertThat(b.path("allocation").path("postingStatus").asText()).isEqualTo("PENDING");
        nullFields(b.path("allocation"), "journalId");
        assertThat(count("refund")).isEqualTo(1);
        var row = jdbc.queryForMap("SELECT * FROM platform.refund");
        UUID refundKey = jdbc.queryForObject(
                "SELECT refund_key FROM platform.refund_proposal WHERE id=?", UUID.class, proposalId(pending));
        assertThat(refundKey).isNotEqualTo(proposalId(pending));
        assertThat(row)
                .containsEntry("refund_status", "RESERVED")
                .containsEntry("amount_minor", 1250L)
                .containsEntry("client_refund_key", "proposal:" + refundKey);
        assertThat(reserved()).isEqualTo(1250);
        assertThat(count("refund_liability")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT proposal_id FROM platform.refund_liability", UUID.class))
                .isEqualTo(proposalId(pending));
        assertThat(count("audit_log")).isEqualTo(1);
        audit("APPROVED");
    }

    @Test
    void approvedRefundExecutesAndItsLiabilityPosts() {
        paid();
        var approved = approve(createProposal("execute", 1250, 3333, 3333, 3334).body())
                .body();
        UUID refund = PaymentIds.parse("ref", approved.path("refundId").asText());
        UUID operation = jdbc.queryForObject(
                "SELECT id FROM platform.provider_operation WHERE refund_id=? AND operation_type='CREATE_REFUND'",
                UUID.class,
                refund);
        complete(new RefundRepository.Intent(refund, operation, false), "12.50", "0.44");
        assertThat(liability.postReady(10)).isEqualTo(1);
        var b = proposals.get(agent, proposalId(approved));
        assertThat(b.path("allocation").path("postingStatus").asText()).isEqualTo("POSTED");
        assertThatCode(() ->
                        UUID.fromString(b.path("allocation").path("journalId").asText()))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectChangesNothingElse() {
        paid();
        var b = createProposal("reject", 450, 10000, 0, 0).body();
        var before = control();
        var result = proposals.decide(ops(2), proposalId(b), "reject-key-1", reject("Photo shows the drink"));
        assertThat(result.body().path("status").asText()).isEqualTo("REJECTED");
        assertThat(result.body().path("rejectionReason").asText()).isEqualTo("Photo shows the drink");
        assertThat(result.body().path("reviewer").path("subject").asText()).isEqualTo("reviewer");
        nullFields(result.body(), "refundId", "allocation");
        assertThat(count("refund")).isZero();
        assertThat(count("refund_liability")).isZero();
        assertThat(control()).isEqualTo(before);
        audit("REJECTED");
    }

    @Test
    void decisionsReplayAndConflict() {
        paid();
        var b = approve(createProposal("replay-decision", 1250, 3333, 3333, 3334)
                        .body())
                .body();
        var replay = proposals.decide(ops(2), proposalId(b), "approve-key-2", action());
        assertThat(replay.replay()).isTrue();
        assertThat(replay.body()).isEqualTo(b);
        assertThat(count("refund")).isEqualTo(1);
        assertThat(count("refund_liability")).isEqualTo(1);
        audit("REPLAYED");
        fails(
                () -> proposals.decide(ops(2), proposalId(b), "reject-key", reject("No")),
                ErrorCode.PROPOSAL_NOT_PENDING);
        fails(
                () -> proposals.decide(ops(2), proposalId(b), "approve-key-1", reject("No")),
                ErrorCode.IDEMPOTENCY_CONFLICT);
    }

    @Test
    void rejectedProposalReplaysReject() {
        paid();
        var b = createProposal("reject-replay", 450, 10000, 0, 0).body();
        proposals.decide(ops(2), proposalId(b), "reject-key-1", reject("Original reason"));
        var replay = proposals.decide(ops(2), proposalId(b), "reject-key-2", reject("Another reason"));
        assertThat(replay.replay()).isTrue();
        assertThat(replay.body().path("rejectionReason").asText()).isEqualTo("Original reason");
        fails(() -> proposals.decide(ops(2), proposalId(b), "approve-key-2", action()), ErrorCode.PROPOSAL_NOT_PENDING);
    }

    @Test
    void failedRecheckLeavesTheProposalPending() {
        paid();
        var b = createProposal("recheck", 6000, 10000, 0, 0).body();
        reserve("direct-5000", 5000);
        fails(
                () -> proposals.decide(ops(2), proposalId(b), "approve-key-1", action()),
                ErrorCode.REFUND_LIMIT_EXCEEDED);
        pendingAfterFailure(b);
        block();
        fails(() -> proposals.decide(ops(2), proposalId(b), "approve-key-1", action()), ErrorCode.REFUND_BLOCKED);
        pendingAfterFailure(b);
        assertThat(proposals
                        .decide(ops(2), proposalId(b), "reject-key-1", reject("Not refundable"))
                        .body()
                        .path("status")
                        .asText())
                .isEqualTo("REJECTED");
    }

    @Test
    void failureAfterTheReservationRollsEverythingBack() {
        paid();
        var b = createProposal("rollback", 1250, 3333, 3333, 3334).body();
        var failing = new RefundProposalService(
                new RefundProposalRepository(jdbc),
                tx,
                json,
                refunds,
                liability,
                new OpsAuditService(jdbc, json, tx) {
                    @Override
                    public UUID recordInTransaction(
                            OpsContext c,
                            String action,
                            String target,
                            JsonNode body,
                            String result,
                            JsonNode before,
                            JsonNode after) {
                        super.recordInTransaction(c, action, target, body, result, before, after);
                        throw new IllegalStateException("audit failed after the decision");
                    }
                },
                () -> "PAYPAL");
        assertThatThrownBy(() -> failing.decide(ops(2), proposalId(b), "approve-key-1", action()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("audit failed after the decision");
        assertThat(proposals.get(agent, proposalId(b)).path("status").asText()).isEqualTo("PENDING_REVIEW");
        assertThat(count("refund")).isZero();
        assertThat(count("refund_liability")).isZero();
        assertThat(count("audit_log")).isZero();
        assertThat(reserved()).isZero();
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.api_idempotency_record WHERE idempotency_key=?",
                        Long.class,
                        "proposal-refund:"
                                + jdbc.queryForObject(
                                        "SELECT refund_key FROM platform.refund_proposal WHERE id=?",
                                        UUID.class,
                                        proposalId(b))))
                .isZero();
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.provider_operation WHERE operation_type='CREATE_REFUND'",
                        Long.class))
                .isZero();
        assertThat(approve(b).body().path("status").asText()).isEqualTo("APPROVED");
        assertThat(count("refund")).isEqualTo(1);
        assertThat(count("refund_liability")).isEqualTo(1);
    }

    @Test
    void onlyReviewersDecide() {
        paid();
        var b = createProposal("roles", 450, 10000, 0, 0).body();
        for (int n : List.of(1, 3, 4))
            fails(() -> proposals.decide(ops(n), proposalId(b), "approve-key-1", action()), ErrorCode.FORBIDDEN);
        assertThat(proposals.list(ops(1), Map.of()).path("items").size()).isEqualTo(1);
        fails(
                () -> proposals.list(new OpsContext(id(55), id(1), id(2), "PARTNER_VIEWER", id(99)), Map.of()),
                ErrorCode.FORBIDDEN);
        fails(() -> proposals.decide(null, proposalId(b), "approve-key-1", action()), ErrorCode.UNAUTHORIZED);
    }

    @Test
    void listPagesTheQueueOldestFirst() {
        paid();
        var created = new ArrayList<String>();
        for (int i = 0; i < 3; i++)
            created.add(createProposal("page-" + i, 100, 10000, 0, 0)
                    .body()
                    .path("id")
                    .asText());
        created.sort(String::compareTo);
        var rejected = createProposal("page-rejected", 100, 10000, 0, 0).body();
        proposals.decide(ops(2), proposalId(rejected), "reject-page", reject("No"));
        var first = proposals.list(ops(1), Map.of("limit", "2"));
        assertThat(first.path("items").findValuesAsText("id")).containsExactlyElementsOf(created.subList(0, 2));
        String cursor = first.path("nextCursor").asText();
        assertThat(cursor).isNotBlank();
        var second = proposals.list(ops(1), Map.of("limit", "2", "cursor", cursor));
        assertThat(second.path("items").findValuesAsText("id")).containsExactly(created.get(2));
        nullFields(second, "nextCursor");
        assertThat(proposals
                        .list(ops(1), Map.of("status", "REJECTED"))
                        .path("items")
                        .size())
                .isEqualTo(1);
        for (var query : List.of(
                Map.of("status", "BOGUS"),
                Map.of("limit", "0"),
                Map.of("limit", "201"),
                Map.of(
                        "cursor",
                        Base64.getUrlEncoder()
                                .withoutPadding()
                                .encodeToString(
                                        new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                                                .replace("PENDING_REVIEW", "REJECTED")
                                                .getBytes(StandardCharsets.UTF_8)))))
            fails(() -> proposals.list(ops(1), query), ErrorCode.VALIDATION_ERROR);
        assertThat(proposals
                        .list(new OpsContext(id(51), id(9), id(2), "OPS_VIEWER", null), Map.of())
                        .path("items"))
                .isEmpty();
    }

    @Test
    void databaseGuardsTheProposal() {
        paid();
        var rejected = createProposal("guard-rejected", 450, 10000, 0, 0).body();
        proposals.decide(ops(2), proposalId(rejected), "reject-guard", reject("No"));
        var pending = createProposal("guard-pending", 450, 10000, 0, 0).body();
        var direct = reserve("guard-direct", 450);
        var before = jdbc.queryForList("SELECT * FROM platform.refund_proposal ORDER BY id");
        assertThat(jdbc.queryForObject("SELECT current_user", String.class)).isEqualTo("payments_app");
        rejected(() ->
                jdbc.update("UPDATE platform.refund_proposal SET amount_minor=451 WHERE id=?", proposalId(pending)));
        rejected(() -> jdbc.update("DELETE FROM platform.refund_proposal WHERE id=?", proposalId(pending)));
        rejected(() -> jdbc.update(
                "UPDATE platform.refund_proposal SET status='PENDING_REVIEW' WHERE id=?", proposalId(rejected)));
        assertThatThrownBy(() -> new TransactionTemplate(tx)
                        .executeWithoutResult(status -> jdbc.update(
                                "UPDATE platform.refund_proposal SET status='APPROVED',reviewer_id=?,reviewer_subject='reviewer',reviewer_role='OPS_REVIEWER',reviewed_at=now(),refund_id=?,decision_idempotency_key='guard-key',decision_fingerprint=? WHERE id=?",
                                id(52),
                                direct.refundId(),
                                "a".repeat(64),
                                proposalId(pending))))
                .isInstanceOf(org.springframework.transaction.TransactionSystemException.class)
                .rootCause()
                .isInstanceOfSatisfying(
                        org.postgresql.util.PSQLException.class,
                        e -> assertThat(e.getSQLState()).isEqualTo("23514"));
        assertThat(jdbc.queryForList("SELECT * FROM platform.refund_proposal ORDER BY id"))
                .isEqualTo(before);
    }

    @Test
    void newScopesAreAllowedOnCredentials() {
        String hash = new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(10).encode("b".repeat(43));
        admin.update(
                "INSERT INTO platform.application_credential(id,key_id,organization_id,environment_id,application_id,provider_account_id,secret_hash,not_before,expires_at,granted_scopes) VALUES (?,'proposal',?,?,?,?,?,now()-interval '1 day',now()+interval '1 day',ARRAY['refund-proposals:read','refund-proposals:write'])",
                id(61),
                id(1),
                id(2),
                id(3),
                id(4),
                hash);
        assertThatThrownBy(() -> admin.update(
                        "INSERT INTO platform.application_credential(id,key_id,organization_id,environment_id,application_id,provider_account_id,secret_hash,not_before,expires_at,granted_scopes) VALUES (?,'bogus',?,?,?,?,?,now()-interval '1 day',now()+interval '1 day',ARRAY['bogus:scope'])",
                        id(62),
                        id(1),
                        id(2),
                        id(3),
                        id(4),
                        hash))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("application_credential_scopes");
    }

    @Test
    void approvalKeyCannotBePreemptedFromTheProposalId() throws Exception {
        paid();
        var pending = createProposal("preempted-key", 1250, 3333, 3333, 3334).body();
        UUID proposal = proposalId(pending);
        var applicationRefund = refunds.prepare(
                refundsContext,
                "proposal-refund:" + proposal,
                new RefundRequests.Create(payment, 1000, "USD", "REQUESTED_BY_CUSTOMER", null, "proposal:" + proposal),
                "PAYPAL");

        var approved = approve(pending).body();
        assertThat(approved.path("status").asText()).isEqualTo("APPROVED");
        assertThat(count("refund")).isEqualTo(2);
        assertThat(row(applicationRefund)).containsEntry("amount_minor", 1000L);
        UUID refund = PaymentIds.parse("ref", approved.path("refundId").asText());
        assertThat(jdbc.queryForObject("SELECT amount_minor FROM platform.refund WHERE id=?", Long.class, refund))
                .isEqualTo(1250L);
        UUID refundKey =
                jdbc.queryForObject("SELECT refund_key FROM platform.refund_proposal WHERE id=?", UUID.class, proposal);
        String clientKey =
                jdbc.queryForObject("SELECT client_refund_key FROM platform.refund WHERE id=?", String.class, refund);
        assertThat(clientKey.equals("proposal:" + refundKey))
                .as("Approval uses the secret client refund key")
                .isTrue();
        assertThat(clientKey.equals("proposal:" + proposal))
                .as("Approval does not reuse the public proposal key")
                .isFalse();
        assertThat(jdbc.queryForObject(
                                "SELECT idempotency_key FROM platform.api_idempotency_record WHERE refund_id=?",
                                String.class,
                                refund)
                        .equals("proposal-refund:" + refundKey))
                .as("Approval uses the secret reservation key")
                .isTrue();
        assertThat(json.writeValueAsString(approved).contains(refundKey.toString()))
                .as("The serialized proposal does not disclose the secret refund key")
                .isFalse();
    }

    private UUID paid() {
        payment = create();
        approved(payment);
        captureAndComplete(payment);
        assertThat(service.get(context, payment))
                .containsEntry("paymentStatus", "SUCCEEDED")
                .containsEntry("financialStatus", "POSTED");
        assertThat(jdbc.queryForObject(
                        "SELECT latest_charge_id FROM platform.payment WHERE id=?", String.class, payment))
                .isEqualTo(CAPTURE);
        return payment;
    }

    private RefundRepository.Intent reserve(String key, long amount) {
        return refunds.prepare(
                refundsContext, key, new RefundRequests.Create(payment, amount, "USD", null, null, null), "PAYPAL");
    }

    private Map<String, Object> row(RefundRepository.Intent i) {
        return jdbc.queryForMap("SELECT * FROM platform.refund WHERE id=?", i.refundId());
    }

    private List<PayPalTestTransport.Sent> refundCalls() {
        return transport.calls().stream()
                .filter(c -> c.uri().getPath().endsWith("/refund"))
                .toList();
    }

    private RefundRepository.Intent refunded(String key, long amount, String value, String fee) {
        var i = reserve(key, amount);
        complete(i, value, fee);
        return i;
    }

    private void complete(RefundRepository.Intent i, String value, String fee) {
        String providerId = "F17"
                + i.refundId().toString().replace("-", "").substring(0, 14).toUpperCase(Locale.ROOT);
        int calls = refundCalls().size();
        if (!refundTokenQueued) {
            transport.token();
            refundTokenQueued = true;
        }
        transport.reply(
                201,
                refund(
                        providerId,
                        CAPTURE,
                        "COMPLETED",
                        value,
                        fee,
                        i.refundId().toString()));
        refundExecutor.execute(i.operationId());
        assertThat(row(i)).containsEntry("refund_status", "SUCCEEDED");
        assertThat(refundCalls()).hasSize(calls + 1);
    }

    private TenantContext tenant(UUID application, Set<String> currencies, Set<String> scopes) {
        return new TenantContext(id(1), id(2), application, id(4), currencies, false, scopes);
    }

    private OpsContext ops(int n) {
        return new OpsContext(
                id(50 + n),
                id(1),
                id(2),
                switch (n) {
                    case 1 -> "OPS_VIEWER";
                    case 2 -> "OPS_REVIEWER";
                    case 3 -> "OPS_OPERATOR";
                    default -> "OPS_ADMIN";
                },
                null);
    }

    private String key(String complaint) {
        return "refund-proposal:" + complaint;
    }

    private UUID proposalId(JsonNode b) {
        return PaymentIds.parse("prop", b.path("id").asText());
    }

    private RefundProposalService.Result createProposal(String complaint, long amount, int r, int d, int p) {
        return proposals.create(agent, key(complaint), body(complaint, amount, r, d, p));
    }

    private ObjectNode body(String complaint, long amount, int r, int d, int p) {
        var b = json.createObjectNode()
                .put("complaintId", complaint)
                .put("orderRef", "order-001")
                .put("paymentId", PaymentIds.format("pay", payment))
                .put("decision", "PARTIAL_REFUND")
                .put("amountMinor", amount)
                .put("currency", "USD")
                .put("reasonCode", "MISSING_ITEM")
                .put("explanation", "The ordered drink was missing.");
        var lines = b.putArray("liability");
        lines.addObject().put("party", "RESTAURANT").put("basisPoints", r);
        lines.addObject().put("party", "DRIVER").put("basisPoints", d);
        lines.addObject().put("party", "PLATFORM").put("basisPoints", p);
        b.putArray("evidenceRefs").add("evidence-order-receipt-001").add("evidence-delivery-photo-001");
        b.putObject("agentRun").put("threadId", "refund-thread-001").put("traceId", "refund-trace-001");
        return b;
    }

    private ObjectNode action() {
        return json.createObjectNode().put("action", "APPROVE");
    }

    private ObjectNode reject(String reason) {
        return json.createObjectNode().put("action", "REJECT").put("reason", reason);
    }

    private RefundProposalService.Result approve(JsonNode b) {
        return proposals.decide(ops(2), proposalId(b), "approve-key-1", action());
    }

    private void nullFields(JsonNode b, String... fields) {
        for (String f : fields) {
            assertThat(b.has(f)).as(f + " is required").isTrue();
            assertThat(b.get(f).isNull()).as(f + " is null").isTrue();
        }
    }

    private void invalid(String complaint, Consumer<ObjectNode> change, ErrorCode code) {
        var b = body(complaint, 450, 10000, 0, 0);
        change.accept(b);
        fails(() -> proposals.create(agent, key(complaint), b), code);
    }

    private void fails(Runnable action, ErrorCode code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }

    private void rejected(Runnable action) {
        assertThatThrownBy(() -> new TransactionTemplate(tx).executeWithoutResult(s -> action.run()))
                .isInstanceOf(DataAccessException.class);
    }

    private long reserved() {
        return jdbc.queryForObject(
                "SELECT coalesce(sum(reserved_minor),0) FROM platform.refund_control WHERE payment_id=?",
                Long.class,
                payment);
    }

    private List<Map<String, Object>> control() {
        return jdbc.queryForList("SELECT * FROM platform.refund_control WHERE payment_id=?", payment);
    }

    private void block() {
        admin.update(
                "INSERT INTO platform.refund_control(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,captured_minor,control_state) VALUES (?,?,?,?,'USD',?,10000,'DISPUTE_BLOCKED') ON CONFLICT(payment_id) DO UPDATE SET control_state='DISPUTE_BLOCKED'",
                id(1),
                id(2),
                id(3),
                id(4),
                payment);
    }

    private void audit(String result) {
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.audit_log WHERE action='DECIDE_REFUND_PROPOSAL' AND result=?",
                        Long.class,
                        result))
                .isEqualTo(1);
    }

    private void pendingAfterFailure(JsonNode b) {
        assertThat(proposals.get(agent, proposalId(b)).path("status").asText()).isEqualTo("PENDING_REVIEW");
        assertThat(count("refund")).isEqualTo(1);
        assertThat(count("refund_liability")).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.audit_log WHERE result='APPROVED'", Long.class))
                .isZero();
    }
}
