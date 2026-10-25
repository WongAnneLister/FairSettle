package com.paymentsledger.liability;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;
import com.paymentsledger.ledger.PostingLine;
import com.paymentsledger.ledger.Side;
import java.math.BigInteger;
import java.util.*;
import org.junit.jupiter.api.Test;

class LiabilityAllocationTest {
    private final LiabilitySplit split = new LiabilitySplit(3333, 3333, 3334);
    private final ObjectMapper mapper = new ObjectMapper();
    private final UUID liability = id(1), refund = id(2), payment = id(3), proposal = id(4);

    @Test
    void contractExampleGivesRemainderToPlatform() {
        parts(1250, split, 416, 416, 418);
    }

    @Test
    void missingDrinkGoesToRestaurant() {
        parts(450, new LiabilitySplit(10000, 0, 0), 450, 0, 0);
    }

    @Test
    void oneCentGoesToPlatform() {
        parts(1, split, 0, 0, 1);
    }

    @Test
    void exactSplitHasNoRemainder() {
        parts(10000, new LiabilitySplit(5000, 2500, 2500), 5000, 2500, 2500);
    }

    @Test
    void driverOnlyAndPlatformOnly() {
        parts(2500, new LiabilitySplit(0, 10000, 0), 0, 2500, 0);
        parts(999, new LiabilitySplit(0, 0, 10000), 0, 0, 999);
    }

    @Test
    void largestAmountDoesNotOverflow() {
        rule(Long.MAX_VALUE, split);
    }

    @Test
    void partsAlwaysSumToRefund() {
        var splits = new ArrayList<LiabilitySplit>();
        for (int r = 0; r <= 10000; r += 1111)
            for (int d = 0; r + d <= 10000; d += 1111) splits.add(new LiabilitySplit(r, d, 10000 - r - d));
        splits.addAll(List.of(
                new LiabilitySplit(1, 1, 9998), new LiabilitySplit(9998, 1, 1), new LiabilitySplit(1, 9998, 1)));
        for (var s : splits) {
            for (long a = 1; a <= 2000; a++) rule(a, s);
            for (long a : new long[] {9999, 10001, 123457, 1000000000000L}) rule(a, s);
        }
    }

    @Test
    void invalidSplitsAreRejected() {
        invalid(() -> new LiabilitySplit(3333, 3333, 3333), ErrorCode.LIABILITY_SPLIT_INVALID);
        invalid(() -> new LiabilitySplit(5000, 5000, 1), ErrorCode.LIABILITY_SPLIT_INVALID);
        invalid(() -> new LiabilitySplit(-1, 5001, 5000), ErrorCode.LIABILITY_SPLIT_INVALID);
        invalid(() -> new LiabilitySplit(10001, 0, -1), ErrorCode.LIABILITY_SPLIT_INVALID);
        invalid(() -> LiabilitySplit.of(Map.of(LiabilityParty.RESTAURANT, 10000)), ErrorCode.LIABILITY_SPLIT_INVALID);
        var values = new HashMap<LiabilityParty, Integer>();
        values.put(LiabilityParty.RESTAURANT, 10000);
        values.put(LiabilityParty.DRIVER, 0);
        values.put(LiabilityParty.PLATFORM, null);
        invalid(() -> LiabilitySplit.of(values), ErrorCode.LIABILITY_SPLIT_INVALID);
        invalid(() -> LiabilitySplit.of(null), ErrorCode.LIABILITY_SPLIT_INVALID);
    }

    @Test
    void nonPositiveAmountsAreRejected() {
        invalid(() -> LiabilityAllocation.allocate(0, split), ErrorCode.VALIDATION_ERROR);
        invalid(() -> LiabilityAllocation.allocate(-1, split), ErrorCode.VALIDATION_ERROR);
        invalid(() -> LiabilityAllocation.allocate(1250, null), ErrorCode.LIABILITY_SPLIT_INVALID);
    }

    @Test
    void storedAllocationMustFollowTheRule() {
        assertThatThrownBy(() -> new LiabilityAllocation(1250, split, 417, 416, 417))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new LiabilityAllocation(1250, split, 416, 416, 419))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void linesAreInPartyOrder() {
        var s = LiabilitySplit.of(
                Map.of(LiabilityParty.RESTAURANT, 3333, LiabilityParty.DRIVER, 3333, LiabilityParty.PLATFORM, 3334));
        var a = LiabilityAllocation.allocate(1250, s);
        assertThat(a.lines())
                .containsExactly(
                        new LiabilityAllocation.Line(LiabilityParty.RESTAURANT, 3333, 416),
                        new LiabilityAllocation.Line(LiabilityParty.DRIVER, 3333, 416),
                        new LiabilityAllocation.Line(LiabilityParty.PLATFORM, 3334, 418));
        assertThat(a.amount(LiabilityParty.PLATFORM)).isEqualTo(418);
    }

    @Test
    void postingMovesSalesReturnsToParties() {
        var command = LiabilityPosting.command(
                liability, refund, payment, proposal, LiabilityAllocation.allocate(1250, split), accounts(), mapper);
        assertThat(command.eventKey()).isEqualTo("liability.allocate:" + refund);
        assertThat(command.eventType()).isEqualTo("L-LIABILITY");
        assertThat(command.sourceDomain()).isEqualTo("INTERNAL");
        assertThat(command.sourceRef()).isEqualTo(liability.toString());
        assertThat(command.reversalOf()).isNull();
        assertThat(command.entries())
                .containsExactly(
                        new PostingLine(id(10), Side.DEBIT, 416),
                        new PostingLine(id(11), Side.DEBIT, 416),
                        new PostingLine(id(12), Side.DEBIT, 418),
                        new PostingLine(id(13), Side.CREDIT, 1250));
        var facts = mapper.createObjectNode()
                .put("liability_id", liability.toString())
                .put("refund_id", refund.toString())
                .put("payment_id", payment.toString())
                .put("proposal_id", proposal.toString())
                .put("amount_minor", 1250L)
                .put("restaurant_bp", 3333)
                .put("driver_bp", 3333)
                .put("platform_bp", 3334)
                .put("restaurant_minor", 416L)
                .put("driver_minor", 416L)
                .put("platform_minor", 418L);
        assertThat(command.facts()).isEqualTo(facts);
    }

    @Test
    void zeroSharesHaveNoLine() {
        var command = LiabilityPosting.command(
                liability,
                refund,
                payment,
                proposal,
                LiabilityAllocation.allocate(450, new LiabilitySplit(10000, 0, 0)),
                accounts(),
                mapper);
        assertThat(command.entries())
                .containsExactly(new PostingLine(id(10), Side.DEBIT, 450), new PostingLine(id(13), Side.CREDIT, 450));
    }

    @Test
    void missingAccountIsAnError() {
        var accounts = new HashMap<>(accounts());
        accounts.remove("REFUND_COST_PLATFORM");
        assertThatThrownBy(() -> LiabilityPosting.command(
                        liability,
                        refund,
                        payment,
                        proposal,
                        LiabilityAllocation.allocate(1250, split),
                        accounts,
                        mapper))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("REFUND_COST_PLATFORM");
    }

    @Test
    void partyAccountsAreTheNewPurposes() {
        assertThat(LiabilityParty.values())
                .extracting(LiabilityParty::accountPurpose)
                .containsExactly("REFUND_RECEIVABLE_RESTAURANT", "REFUND_RECEIVABLE_DRIVER", "REFUND_COST_PLATFORM");
        assertThat(ErrorCode.LIABILITY_SPLIT_INVALID.httpStatus().value()).isEqualTo(422);
        assertThat(ErrorCode.LIABILITY_SPLIT_INVALID.retryable()).isFalse();
    }

    private void parts(long amount, LiabilitySplit s, long r, long d, long p) {
        assertThat(LiabilityAllocation.allocate(amount, s)).isEqualTo(new LiabilityAllocation(amount, s, r, d, p));
    }

    private void rule(long amount, LiabilitySplit s) {
        var a = LiabilityAllocation.allocate(amount, s);
        assertThat(BigInteger.valueOf(a.restaurantMinor())
                        .add(BigInteger.valueOf(a.driverMinor()))
                        .add(BigInteger.valueOf(a.platformMinor())))
                .isEqualTo(BigInteger.valueOf(amount));
        assertThat(a.restaurantMinor()).isNotNegative().isEqualTo(floor(amount, s.restaurantBp()));
        assertThat(a.driverMinor()).isNotNegative().isEqualTo(floor(amount, s.driverBp()));
        assertThat(a.platformMinor()).isNotNegative();
        assertThat(a.platformMinor() - floor(amount, s.platformBp())).isIn(0L, 1L, 2L);
    }

    private long floor(long a, int bp) {
        return BigInteger.valueOf(a)
                .multiply(BigInteger.valueOf(bp))
                .divide(BigInteger.valueOf(10000))
                .longValueExact();
    }

    private void invalid(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }

    private Map<String, UUID> accounts() {
        return Map.of(
                "REFUND_RECEIVABLE_RESTAURANT",
                id(10),
                "REFUND_RECEIVABLE_DRIVER",
                id(11),
                "REFUND_COST_PLATFORM",
                id(12),
                "SALES_RETURNS",
                id(13));
    }

    private static UUID id(long n) {
        return new UUID(0, n);
    }
}
