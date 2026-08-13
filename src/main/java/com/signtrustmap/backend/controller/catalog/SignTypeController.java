package com.signtrustmap.backend.controller.catalog;

import com.signtrustmap.backend.dto.catalog.CreateSignTypeRequest;
import com.signtrustmap.backend.dto.catalog.SignTypeResponse;
import com.signtrustmap.backend.dto.catalog.UpdateSignTypeRequest;
import com.signtrustmap.backend.service.catalog.SignTypeService;
import com.signtrustmap.backend.api.PageResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
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
@RequestMapping("/api/v1/catalog/sign-types")
public class SignTypeController {

    private final SignTypeService service;

    public SignTypeController(SignTypeService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SignTypeResponse create(@Valid @RequestBody CreateSignTypeRequest request) {
        return service.create(request);
    }

    @GetMapping
    public PageResponse<SignTypeResponse> listActive(
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size
    ) {
        return PageResponse.from(service.listActive(
                categoryId,
                search,
                PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "name"))
        ));
    }

    @GetMapping("/{id}")
    public SignTypeResponse get(@PathVariable UUID id) {
        return service.get(id);
    }

    @PatchMapping("/{id}")
    public SignTypeResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateSignTypeRequest request) {
        return service.update(id, request);
    }
}
