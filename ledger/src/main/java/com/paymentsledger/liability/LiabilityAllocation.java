package com.paymentsledger.liability;

import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;
import java.math.BigInteger;
import java.util.Arrays;
import java.util.List;

public record LiabilityAllocation(
        long amountMinor, LiabilitySplit split, long restaurantMinor, long driverMinor, long platformMinor) {
    public record Line(LiabilityParty party, int basisPoints, long amountMinor) {}

    public LiabilityAllocation {
        if (amountMinor < 1
                || split == null
                || restaurantMinor < 0
                || driverMinor < 0
                || platformMinor < 0
                || restaurantMinor != floorShare(amountMinor, split.restaurantBp())
                || driverMinor != floorShare(amountMinor, split.driverBp())
                || !BigInteger.valueOf(restaurantMinor)
                        .add(BigInteger.valueOf(driverMinor))
                        .add(BigInteger.valueOf(platformMinor))
                        .equals(BigInteger.valueOf(amountMinor)))
            throw new IllegalArgumentException("Allocation does not follow the liability rule");
    }

    public static LiabilityAllocation allocate(long amountMinor, LiabilitySplit split) {
        if (amountMinor < 1) throw new ApiException(ErrorCode.VALIDATION_ERROR, "Refund amount must be positive");
        if (split == null) throw new ApiException(ErrorCode.LIABILITY_SPLIT_INVALID, LiabilitySplit.INVALID);
        long restaurant = floorShare(amountMinor, split.restaurantBp());
        long driver = floorShare(amountMinor, split.driverBp());
        return new LiabilityAllocation(amountMinor, split, restaurant, driver, amountMinor - restaurant - driver);
    }

    private static long floorShare(long amount, int bp) {
        return BigInteger.valueOf(amount)
                .multiply(BigInteger.valueOf(bp))
                .divide(BigInteger.valueOf(LiabilitySplit.TOTAL))
                .longValueExact();
    }

    public long amount(LiabilityParty party) {
        return switch (party) {
            case RESTAURANT -> restaurantMinor;
            case DRIVER -> driverMinor;
            case PLATFORM -> platformMinor;
        };
    }

    public List<Line> lines() {
        return Arrays.stream(LiabilityParty.values())
                .map(p -> new Line(p, split.basisPoints(p), amount(p)))
                .toList();
    }
}
