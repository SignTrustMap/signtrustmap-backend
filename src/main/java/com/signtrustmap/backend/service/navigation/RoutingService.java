package com.signtrustmap.backend.service.navigation;

import com.signtrustmap.backend.dto.navigation.RouteDirectionsRequest;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsResponse;

public interface RoutingService {

    RouteDirectionsResponse findDirections(RouteDirectionsRequest request);
}
