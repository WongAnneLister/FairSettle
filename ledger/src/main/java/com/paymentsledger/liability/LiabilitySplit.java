package com.paymentsledger.liability;

import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;
import java.util.Map;

public record LiabilitySplit(int restaurantBp, int driverBp, int platformBp) {
    public static final int TOTAL = 10000;
    static final String INVALID = "Liability shares must be three parties summing to 10000 basis points";

    public LiabilitySplit {
        if (restaurantBp < 0
                || restaurantBp > TOTAL
                || driverBp < 0
                || driverBp > TOTAL
                || platformBp < 0
                || platformBp > TOTAL
                || (long) restaurantBp + driverBp + platformBp != TOTAL)
            throw new ApiException(ErrorCode.LIABILITY_SPLIT_INVALID, INVALID);
    }

    public static LiabilitySplit of(Map<LiabilityParty, Integer> shares) {
        if (shares == null || shares.size() != 3) throw new ApiException(ErrorCode.LIABILITY_SPLIT_INVALID, INVALID);
        for (var party : LiabilityParty.values())
            if (shares.get(party) == null) throw new ApiException(ErrorCode.LIABILITY_SPLIT_INVALID, INVALID);
        return new LiabilitySplit(
                shares.get(LiabilityParty.RESTAURANT),
                shares.get(LiabilityParty.DRIVER),
                shares.get(LiabilityParty.PLATFORM));
    }

    public int basisPoints(LiabilityParty party) {
        return switch (party) {
            case RESTAURANT -> restaurantBp;
            case DRIVER -> driverBp;
            case PLATFORM -> platformBp;
        };
    }
}
