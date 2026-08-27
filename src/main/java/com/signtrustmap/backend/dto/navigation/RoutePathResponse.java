package com.signtrustmap.backend.dto.navigation;

import java.util.List;
import java.util.UUID;

public record RoutePathResponse(
        int rank,
        boolean primary,
        String recommendation,
        double distanceMeters,
        long durationSeconds,
        double distanceRatioToShortest,
        List<UUID> nodeIds,
        List<UUID> edgeIds,
        List<RoutePointResponse> geometry,
        List<RouteStepResponse> steps
) {
}
