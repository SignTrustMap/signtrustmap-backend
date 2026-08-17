package com.signtrustmap.backend.service.navigation.impl;

import com.signtrustmap.backend.config.RoutingProperties;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsRequest;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsResponse;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OsrmRoutingClientTest {

    private final OsrmRoutingClient client = new OsrmRoutingClient(new RoutingProperties());

    @Test
    void parsesShortestRouteAndAlternativesWithinThreshold() throws IOException {
        RouteDirectionsRequest request = new RouteDirectionsRequest(
                10.762622,
                106.660172,
                10.776889,
                106.700806,
                25.0,
                3,
                1_000.0
        );

        RouteDirectionsResponse response = client.parseResponse(request, 25.0, 3, """
                {
                  "code": "Ok",
                  "waypoints": [
                    {"distance": 7.5, "location": [106.660100, 10.762600]},
                    {"distance": 9.0, "location": [106.700900, 10.776900]}
                  ],
                  "routes": [
                    {
                      "distance": 1200.0,
                      "duration": 180.0,
                      "geometry": {
                        "type": "LineString",
                        "coordinates": [[106.6601,10.7626],[106.6700,10.7700],[106.7009,10.7769]]
                      },
                      "legs": [
                        {
                          "steps": [
                            {
                              "name": "Alternative Road",
                              "mode": "driving",
                              "distance": 1200.0,
                              "duration": 180.0,
                              "geometry": {
                                "type": "LineString",
                                "coordinates": [[106.6601,10.7626],[106.7009,10.7769]]
                              }
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "distance": 1000.0,
                      "duration": 160.0,
                      "geometry": {
                        "type": "LineString",
                        "coordinates": [[106.6601,10.7626],[106.6800,10.7700],[106.7009,10.7769]]
                      },
                      "legs": [
                        {
                          "steps": [
                            {
                              "name": "Shortest Road",
                              "mode": "driving",
                              "distance": 1000.0,
                              "duration": 160.0,
                              "geometry": {
                                "type": "LineString",
                                "coordinates": [[106.6601,10.7626],[106.7009,10.7769]]
                              }
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "distance": 1400.0,
                      "duration": 190.0,
                      "geometry": {
                        "type": "LineString",
                        "coordinates": [[106.6601,10.7626],[106.6900,10.7800],[106.7009,10.7769]]
                      },
                      "legs": [{"steps": []}]
                    }
                  ]
                }
                """);

        assertEquals(1000.0, response.shortestPath().distanceMeters(), 0.001);
        assertEquals("Shortest route", response.shortestPath().recommendation());
        assertEquals(1, response.alternatives().size());
        assertEquals(1200.0, response.alternatives().getFirst().distanceMeters(), 0.001);
        assertTrue(response.alternatives().getFirst().recommendation().contains("20.0%"));
        assertEquals(10.762600, response.snappedOrigin().latitude(), 0.000001);
        assertEquals(106.700900, response.snappedDestination().longitude(), 0.000001);
    }
}
