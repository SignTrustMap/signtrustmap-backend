package com.signtrustmap.backend.service.navigation.impl;

import com.signtrustmap.backend.dto.navigation.RouteDirectionsRequest;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsResponse;
import com.signtrustmap.backend.service.navigation.RoutingService;
import org.springframework.stereotype.Service;

@Service
public class RoutingServiceImpl implements RoutingService {

    private static final double DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT = 15.0;
    private static final int DEFAULT_MAX_ALTERNATIVES = 3;

    private final OsrmRoutingClient osrmRoutingClient;

    public RoutingServiceImpl(OsrmRoutingClient osrmRoutingClient) {
        this.osrmRoutingClient = osrmRoutingClient;
    }

    @Override
    public RouteDirectionsResponse findDirections(RouteDirectionsRequest request) {
        double thresholdPercent = request.alternativeThresholdPercent() == null
                ? DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT
                : request.alternativeThresholdPercent();
        int maxAlternatives = request.maxAlternatives() == null
                ? DEFAULT_MAX_ALTERNATIVES
                : request.maxAlternatives();

        return osrmRoutingClient.findDirections(request, thresholdPercent, maxAlternatives);
    }
}
