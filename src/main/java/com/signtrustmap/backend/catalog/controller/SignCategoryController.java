package com.signtrustmap.backend.catalog.controller;

import com.signtrustmap.backend.catalog.dto.CategoryResponse;
import com.signtrustmap.backend.catalog.dto.CreateCategoryRequest;
import com.signtrustmap.backend.catalog.dto.UpdateCategoryRequest;
import com.signtrustmap.backend.catalog.service.SignCategoryService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/catalog/categories")
public class SignCategoryController {

    private final SignCategoryService service;

    public SignCategoryController(SignCategoryService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CategoryResponse create(@Valid @RequestBody CreateCategoryRequest request) {
        return service.create(request);
    }

    @GetMapping
    public List<CategoryResponse> listActive() {
        return service.listActive();
    }

    @GetMapping("/{id}")
    public CategoryResponse get(@PathVariable UUID id) {
        return service.get(id);
    }

    @PatchMapping("/{id}")
    public CategoryResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateCategoryRequest request) {
        return service.update(id, request);
    }
}
