package com.signtrustmap.backend.controller.navigation;

import com.signtrustmap.backend.dto.navigation.RouteDirectionsRequest;
import com.signtrustmap.backend.dto.navigation.RouteDirectionsResponse;
import com.signtrustmap.backend.service.navigation.RoutingService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/routing")
public class RoutingController {

    private final RoutingService service;

    public RoutingController(RoutingService service) {
        this.service = service;
    }

    @PostMapping("/directions")
    public RouteDirectionsResponse directions(@Valid @RequestBody RouteDirectionsRequest request) {
        return service.findDirections(request);
    }
}
