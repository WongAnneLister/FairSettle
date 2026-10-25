package com.paymentsledger.liability;

import static org.assertj.core.api.Assertions.*;

import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

class LiabilityFailuresTest {
    @Test
    void apiFailureShowsItsCode() {
        assertThat(LiabilityFailures.describe(new ApiException(ErrorCode.EVIDENCE_CONFLICT, "secret-ish text")))
                .isEqualTo("error=ApiException code=EVIDENCE_CONFLICT");
    }

    @Test
    void databaseFailureShowsSqlState() {
        var failure = new DataIntegrityViolationException("x", new SQLException("detail with refund id", "23514"));
        assertThat(LiabilityFailures.describe(failure))
                .isEqualTo("error=DataIntegrityViolationException sqlState=23514");
    }

    @Test
    void otherFailureShowsOnlyItsClass() {
        assertThat(LiabilityFailures.describe(new IllegalStateException("message must not appear")))
                .isEqualTo("error=IllegalStateException")
                .doesNotContain("message");
    }

    @Test
    void milestonesArePowersOfTen() {
        for (long attempt : new long[] {0, 1, 9, 11, 99, 1001})
            assertThat(LiabilityFailures.milestone(attempt))
                    .as("Attempt %s", attempt)
                    .isFalse();
        for (long attempt : new long[] {10, 100, 1000})
            assertThat(LiabilityFailures.milestone(attempt))
                    .as("Attempt %s", attempt)
                    .isTrue();
    }
}
