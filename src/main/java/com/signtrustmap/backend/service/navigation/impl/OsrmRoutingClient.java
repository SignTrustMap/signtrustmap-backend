package com.signtrustmap.backend.service.navigation.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.signtrustmap.backend.config.RoutingProperties;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsRequest;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsResponse;
import com.signtrustmap.backend.dto.navigation.RoutePathResponse;
import com.signtrustmap.backend.dto.navigation.RoutePointResponse;
import com.signtrustmap.backend.dto.navigation.RouteSnapResponse;
import com.signtrustmap.backend.dto.navigation.RouteStepResponse;
import com.signtrustmap.backend.exception.ExternalServiceException;
import com.signtrustmap.backend.exception.ResourceNotFoundException;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@Component
class OsrmRoutingClient {

    private static final double SAME_POINT_TOLERANCE_METERS = 0.01;

    private final RoutingProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    OsrmRoutingClient(RoutingProperties properties) {
        this.properties = properties;
        this.objectMapper = new ObjectMapper();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.getOsrm().getTimeout())
                .build();
    }

    RouteDirectionsResponse findDirections(
            RouteDirectionsRequest request,
            double thresholdPercent,
            int maxAlternatives
    ) {
        URI uri = routeUri(request, maxAlternatives);
        HttpRequest httpRequest = HttpRequest.newBuilder(uri)
                .timeout(properties.getOsrm().getTimeout())
                .GET()
                .build();

        HttpResponse<String> response;
        try {
            response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        } catch (IOException exception) {
            throw new ExternalServiceException("OSRM routing service is unavailable", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ExternalServiceException("OSRM routing request was interrupted", exception);
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new ExternalServiceException(
                    "OSRM routing service returned HTTP " + response.statusCode()
            );
        }

        try {
            return parseResponse(request, thresholdPercent, maxAlternatives, response.body());
        } catch (IOException exception) {
            throw new ExternalServiceException("OSRM routing service returned an invalid response", exception);
        }
    }

    RouteDirectionsResponse parseResponse(
            RouteDirectionsRequest request,
            double thresholdPercent,
            int maxAlternatives,
            String body
    ) throws IOException {
        JsonNode root = objectMapper.readTree(body);
        String code = root.path("code").asText();
        if (!"Ok".equalsIgnoreCase(code)) {
            String message = root.path("message").asText("OSRM could not calculate a route");
            throw new ResourceNotFoundException("OSRM routing failed: " + message);
        }

        JsonNode routesNode = root.path("routes");
        if (!routesNode.isArray() || routesNode.isEmpty()) {
            throw new ResourceNotFoundException("OSRM did not return any route");
        }

        RoutePointResponse origin = new RoutePointResponse(request.originLatitude(), request.originLongitude());
        RoutePointResponse destination = new RoutePointResponse(
                request.destinationLatitude(),
                request.destinationLongitude()
        );
        RouteSnapResponse snappedOrigin = waypoint(root.path("waypoints"), 0, origin);
        RouteSnapResponse snappedDestination = waypoint(root.path("waypoints"), 1, destination);

        List<ParsedRoute> parsedRoutes = new ArrayList<>();
        for (JsonNode routeNode : routesNode) {
            parsedRoutes.add(parseRoute(routeNode));
        }
        parsedRoutes.sort(Comparator.comparingDouble(ParsedRoute::distanceMeters));

        double shortestDistanceMeters = parsedRoutes.getFirst().distanceMeters();
        double maxDistanceMeters = shortestDistanceMeters * (1 + thresholdPercent / 100.0);
        List<RoutePathResponse> acceptedRoutes = new ArrayList<>();
        for (ParsedRoute parsedRoute : parsedRoutes) {
            if (parsedRoute.distanceMeters() > maxDistanceMeters) {
                continue;
            }
            acceptedRoutes.add(toResponse(
                    parsedRoute,
                    acceptedRoutes.size(),
                    shortestDistanceMeters
            ));
            if (acceptedRoutes.size() >= maxAlternatives + 1) {
                break;
            }
        }

        if (acceptedRoutes.isEmpty()) {
            throw new ResourceNotFoundException("OSRM did not return any route within the requested threshold");
        }

        return new RouteDirectionsResponse(
                origin,
                destination,
                snappedOrigin,
                snappedDestination,
                acceptedRoutes.getFirst(),
                List.copyOf(acceptedRoutes.subList(1, acceptedRoutes.size()))
        );
    }

    private URI routeUri(RouteDirectionsRequest request, int maxAlternatives) {
        RoutingProperties.Osrm osrm = properties.getOsrm();
        String baseUrl = trimTrailingSlash(osrm.getBaseUrl());
        String coordinates = String.format(
                Locale.US,
                "%.7f,%.7f;%.7f,%.7f",
                request.originLongitude(),
                request.originLatitude(),
                request.destinationLongitude(),
                request.destinationLatitude()
        );
        String alternatives = maxAlternatives <= 0 ? "false" : Integer.toString(maxAlternatives);
        return URI.create(
                baseUrl
                        + "/route/v1/"
                        + osrm.getProfile()
                        + "/"
                        + coordinates
                        + "?alternatives="
                        + alternatives
                        + "&steps=true&geometries=geojson&overview=full"
        );
    }

    private ParsedRoute parseRoute(JsonNode routeNode) {
        List<RoutePointResponse> geometry = coordinates(routeNode.path("geometry").path("coordinates"));
        List<RouteStepResponse> steps = new ArrayList<>();
        for (JsonNode legNode : routeNode.path("legs")) {
            for (JsonNode stepNode : legNode.path("steps")) {
                steps.add(parseStep(stepNode));
            }
        }
        if (geometry.isEmpty()) {
            for (RouteStepResponse step : steps) {
                step.geometry().forEach(point -> append(geometry, point));
            }
        }

        return new ParsedRoute(
                routeNode.path("distance").asDouble(),
                Math.round(routeNode.path("duration").asDouble()),
                geometry,
                List.copyOf(steps)
        );
    }

    private RouteStepResponse parseStep(JsonNode stepNode) {
        String roadName = stepNode.path("name").asText(null);
        if (roadName != null && roadName.isBlank()) {
            roadName = null;
        }
        return new RouteStepResponse(
                null,
                null,
                null,
                roadName,
                stepNode.path("mode").asText(null),
                stepNode.path("distance").asDouble(),
                Math.round(stepNode.path("duration").asDouble()),
                coordinates(stepNode.path("geometry").path("coordinates"))
        );
    }

    private RoutePathResponse toResponse(
            ParsedRoute route,
            int index,
            double shortestDistanceMeters
    ) {
        double ratio = shortestDistanceMeters == 0 ? 1.0 : route.distanceMeters() / shortestDistanceMeters;
        return new RoutePathResponse(
                index + 1,
                index == 0,
                recommendation(index, ratio),
                route.distanceMeters(),
                route.durationSeconds(),
                ratio,
                List.of(),
                List.of(),
                route.geometry(),
                route.steps()
        );
    }

    private RouteSnapResponse waypoint(JsonNode waypoints, int index, RoutePointResponse fallback) {
        if (!waypoints.isArray() || waypoints.size() <= index) {
            return new RouteSnapResponse(null, fallback.latitude(), fallback.longitude(), 0.0);
        }
        JsonNode waypoint = waypoints.get(index);
        JsonNode location = waypoint.path("location");
        if (!location.isArray() || location.size() < 2) {
            return new RouteSnapResponse(null, fallback.latitude(), fallback.longitude(), 0.0);
        }
        return new RouteSnapResponse(
                null,
                location.get(1).asDouble(),
                location.get(0).asDouble(),
                waypoint.path("distance").asDouble(0.0)
        );
    }

    private List<RoutePointResponse> coordinates(JsonNode coordinatesNode) {
        List<RoutePointResponse> coordinates = new ArrayList<>();
        if (!coordinatesNode.isArray()) {
            return coordinates;
        }
        for (JsonNode coordinateNode : coordinatesNode) {
            if (!coordinateNode.isArray() || coordinateNode.size() < 2) {
                continue;
            }
            append(coordinates, new RoutePointResponse(
                    coordinateNode.get(1).asDouble(),
                    coordinateNode.get(0).asDouble()
            ));
        }
        return coordinates;
    }

    private void append(List<RoutePointResponse> coordinates, RoutePointResponse next) {
        if (coordinates.isEmpty()) {
            coordinates.add(next);
            return;
        }
        RoutePointResponse previous = coordinates.getLast();
        double distanceMeters = GeoMath.distanceMeters(
                previous.latitude(),
                previous.longitude(),
                next.latitude(),
                next.longitude()
        );
        if (distanceMeters > SAME_POINT_TOLERANCE_METERS) {
            coordinates.add(next);
        }
    }

    private String recommendation(int index, double ratio) {
        if (index == 0) {
            return "Shortest route";
        }
        double longerPercent = Math.max(0.0, (ratio - 1.0) * 100.0);
        return "Alternative "
                + String.format(Locale.US, "%.1f", longerPercent)
                + "% longer than shortest route";
    }

    private String trimTrailingSlash(String value) {
        if (value.endsWith("/")) {
            return value.substring(0, value.length() - 1);
        }
        return value;
    }

    private record ParsedRoute(
            double distanceMeters,
            long durationSeconds,
            List<RoutePointResponse> geometry,
            List<RouteStepResponse> steps
    ) {
    }
}
