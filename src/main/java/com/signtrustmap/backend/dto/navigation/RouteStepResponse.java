package com.signtrustmap.backend.dto.navigation;

import java.util.List;
import java.util.UUID;

public record RouteStepResponse(
        UUID edgeId,
        UUID fromNodeId,
        UUID toNodeId,
        String roadName,
        String roadClass,
        double distanceMeters,
        long durationSeconds,
        List<RoutePointResponse> geometry
) {
}
