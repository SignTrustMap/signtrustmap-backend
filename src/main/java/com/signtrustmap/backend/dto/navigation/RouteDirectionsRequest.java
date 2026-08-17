package com.signtrustmap.backend.dto.navigation;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record RouteDirectionsRequest(
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double originLatitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double originLongitude,
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double destinationLatitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double destinationLongitude,
        @DecimalMin("0.0") @DecimalMax("100.0") Double alternativeThresholdPercent,
        @Min(0) @Max(10) Integer maxAlternatives,
        @DecimalMin("1.0") @DecimalMax("10000.0") Double snapRadiusMeters
) {
}
