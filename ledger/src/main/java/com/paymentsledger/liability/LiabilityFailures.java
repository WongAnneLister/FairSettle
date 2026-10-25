package com.paymentsledger.liability;

import com.paymentsledger.common.error.ApiException;
import java.sql.SQLException;

final class LiabilityFailures {
    private LiabilityFailures() {}

    static String describe(Throwable failure) {
        String description = "error=" + failure.getClass().getSimpleName();
        if (failure instanceof ApiException api) return description + " code=" + api.errorCode();
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql) return description + " sqlState=" + sql.getSQLState();
        }
        return description;
    }

    static boolean milestone(long attempt) {
        if (attempt < 10) return false;
        while (attempt % 10 == 0) attempt /= 10;
        return attempt == 1;
    }
}
