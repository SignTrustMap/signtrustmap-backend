package com.signtrustmap.backend.controller.signmap;

import com.signtrustmap.backend.api.PageResponse;
import com.signtrustmap.backend.dto.signmap.CreateVerifiedSignRequest;
import com.signtrustmap.backend.dto.signmap.UpdateVerifiedSignRequest;
import com.signtrustmap.backend.dto.signmap.VerifiedSignResponse;
import com.signtrustmap.backend.service.signmap.VerifiedSignService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1/signs")
public class VerifiedSignController {

    private final VerifiedSignService service;

    public VerifiedSignController(VerifiedSignService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public VerifiedSignResponse create(@Valid @RequestBody CreateVerifiedSignRequest request) {
        return service.create(request);
    }

    @GetMapping("/{id}")
    public VerifiedSignResponse get(@PathVariable UUID id) {
        return service.get(id);
    }

    @GetMapping
    public PageResponse<VerifiedSignResponse> findInViewport(
            @RequestParam @DecimalMin("-90.0") @DecimalMax("90.0") double minLat,
            @RequestParam @DecimalMin("-180.0") @DecimalMax("180.0") double minLon,
            @RequestParam @DecimalMin("-90.0") @DecimalMax("90.0") double maxLat,
            @RequestParam @DecimalMin("-180.0") @DecimalMax("180.0") double maxLon,
            @RequestParam(required = false) UUID signTypeId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "100") @Min(1) @Max(500) int size
    ) {
        return PageResponse.from(service.findInViewport(
                minLat,
                minLon,
                maxLat,
                maxLon,
                signTypeId,
                PageRequest.of(page, size)
        ));
    }

    @PatchMapping("/{id}")
    public VerifiedSignResponse update(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateVerifiedSignRequest request
    ) {
        return service.update(id, request);
    }
}
