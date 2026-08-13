package com.signtrustmap.backend.dto.signmap;

import com.signtrustmap.backend.entity.signmap.TrafficDirection;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.UUID;

public record CreateVerifiedSignRequest(
        @NotNull UUID signTypeId,
        @DecimalMin("-90.0") @DecimalMax("90.0") double latitude,
        @DecimalMin("-180.0") @DecimalMax("180.0") double longitude,
        @DecimalMin("0.0") @DecimalMax(value = "360.0", inclusive = false) Double headingDegrees,
        @NotNull TrafficDirection trafficDirection,
        @Size(max = 500) String imageObjectKey,
        @PastOrPresent Instant lastVerifiedAt
) {
}
