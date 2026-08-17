package com.signtrustmap.backend.dto.navigation;

import java.util.UUID;

public record RouteSnapResponse(
        UUID nodeId,
        double latitude,
        double longitude,
        double distanceMeters
) {
}
