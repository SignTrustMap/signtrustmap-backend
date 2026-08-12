package com.signtrustmap.backend.dto.signmap;

import com.signtrustmap.backend.dto.catalog.SignTypeResponse;
import com.signtrustmap.backend.entity.signmap.TrafficDirection;
import com.signtrustmap.backend.entity.signmap.VerifiedSignStatus;

import java.time.Instant;
import java.util.UUID;

public record VerifiedSignResponse(
        UUID id,
        SignTypeResponse signType,
        double latitude,
        double longitude,
        Double headingDegrees,
        TrafficDirection trafficDirection,
        String imageObjectKey,
        Instant lastVerifiedAt,
        VerifiedSignStatus status,
        Instant createdAt,
        Instant updatedAt
) {
}
