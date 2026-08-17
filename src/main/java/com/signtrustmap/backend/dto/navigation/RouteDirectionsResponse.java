package com.signtrustmap.backend.dto.navigation;

import java.util.List;

public record RouteDirectionsResponse(
        RoutePointResponse origin,
        RoutePointResponse destination,
        RouteSnapResponse snappedOrigin,
        RouteSnapResponse snappedDestination,
        RoutePathResponse shortestPath,
        List<RoutePathResponse> alternatives
) {
}
