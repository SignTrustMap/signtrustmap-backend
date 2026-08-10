package com.signtrustmap.backend.catalog.service;

import com.signtrustmap.backend.catalog.dto.CategoryResponse;
import com.signtrustmap.backend.catalog.dto.CreateCategoryRequest;
import com.signtrustmap.backend.catalog.dto.UpdateCategoryRequest;
import com.signtrustmap.backend.catalog.entity.SignCategory;
import com.signtrustmap.backend.catalog.repository.SignCategoryRepository;
import com.signtrustmap.backend.common.exception.ConflictException;
import com.signtrustmap.backend.common.exception.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class SignCategoryService {

    private final SignCategoryRepository repository;

    public SignCategoryService(SignCategoryRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public CategoryResponse create(CreateCategoryRequest request) {
        String code = request.code().trim().toUpperCase(Locale.ROOT);
        if (repository.existsByCodeIgnoreCase(code)) {
            throw new ConflictException("A sign category with code " + code + " already exists");
        }
        SignCategory category = new SignCategory(
                code,
                request.name().trim(),
                trimToNull(request.description())
        );
        return toResponse(repository.save(category));
    }

    @Transactional(readOnly = true)
    public List<CategoryResponse> listActive() {
        return repository.findAllByActiveTrueOrderByNameAsc().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public CategoryResponse get(UUID id) {
        return toResponse(find(id));
    }

    @Transactional
    public CategoryResponse update(UUID id, UpdateCategoryRequest request) {
        SignCategory category = find(id);
        category.update(trimToNull(request.name()), trimToNull(request.description()), request.active());
        return toResponse(category);
    }

    public SignCategory find(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Sign category " + id + " was not found"));
    }

    public CategoryResponse toResponse(SignCategory category) {
        return new CategoryResponse(
                category.getId(),
                category.getCode(),
                category.getName(),
                category.getDescription(),
                category.isActive()
        );
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
