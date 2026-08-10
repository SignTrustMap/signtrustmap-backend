package com.signtrustmap.backend.signmap.dto;

import com.signtrustmap.backend.catalog.dto.SignTypeResponse;
import com.signtrustmap.backend.signmap.entity.TrafficDirection;
import com.signtrustmap.backend.signmap.entity.VerifiedSignStatus;

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
