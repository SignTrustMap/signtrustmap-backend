package com.signtrustmap.backend.signmap.dto;

import com.signtrustmap.backend.signmap.entity.TrafficDirection;
import com.signtrustmap.backend.signmap.entity.VerifiedSignStatus;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.UUID;

public record UpdateVerifiedSignRequest(
        UUID signTypeId,
        @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @DecimalMin("0.0") @DecimalMax(value = "360.0", inclusive = false) Double headingDegrees,
        TrafficDirection trafficDirection,
        @Size(max = 500) String imageObjectKey,
        @PastOrPresent Instant lastVerifiedAt,
        VerifiedSignStatus status
) {
}
