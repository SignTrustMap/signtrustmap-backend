package com.signtrustmap.backend.service.catalog.impl;

import com.signtrustmap.backend.dto.catalog.CategoryResponse;
import com.signtrustmap.backend.dto.catalog.CreateCategoryRequest;
import com.signtrustmap.backend.dto.catalog.UpdateCategoryRequest;
import com.signtrustmap.backend.entity.catalog.SignCategory;
import com.signtrustmap.backend.exception.ConflictException;
import com.signtrustmap.backend.exception.ResourceNotFoundException;
import com.signtrustmap.backend.repository.catalog.SignCategoryRepository;
import com.signtrustmap.backend.service.catalog.SignCategoryService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class SignCategoryServiceImpl implements SignCategoryService {

    private final SignCategoryRepository repository;

    public SignCategoryServiceImpl(SignCategoryRepository repository) {
        this.repository = repository;
    }

    @Override
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

    @Override
    @Transactional(readOnly = true)
    public List<CategoryResponse> listActive() {
        return repository.findAllByActiveTrueOrderByNameAsc().stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public CategoryResponse get(UUID id) {
        return toResponse(find(id));
    }

    @Override
    @Transactional
    public CategoryResponse update(UUID id, UpdateCategoryRequest request) {
        SignCategory category = find(id);
        category.update(trimToNull(request.name()), trimToNull(request.description()), request.active());
        return toResponse(category);
    }

    @Override
    public SignCategory find(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Sign category " + id + " was not found"));
    }

    @Override
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
