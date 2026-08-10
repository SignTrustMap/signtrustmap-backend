package com.signtrustmap.backend.catalog.service;

import com.signtrustmap.backend.catalog.dto.CreateSignTypeRequest;
import com.signtrustmap.backend.catalog.dto.SignTypeResponse;
import com.signtrustmap.backend.catalog.dto.UpdateSignTypeRequest;
import com.signtrustmap.backend.catalog.entity.SignCategory;
import com.signtrustmap.backend.catalog.entity.SignType;
import com.signtrustmap.backend.catalog.repository.SignTypeRepository;
import com.signtrustmap.backend.common.exception.ConflictException;
import com.signtrustmap.backend.common.exception.ResourceNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.UUID;

@Service
public class SignTypeService {

    private final SignTypeRepository repository;
    private final SignCategoryService categoryService;

    public SignTypeService(SignTypeRepository repository, SignCategoryService categoryService) {
        this.repository = repository;
        this.categoryService = categoryService;
    }

    @Transactional
    public SignTypeResponse create(CreateSignTypeRequest request) {
        String code = request.code().trim().toUpperCase(Locale.ROOT);
        if (repository.existsByCodeIgnoreCase(code)) {
            throw new ConflictException("A sign type with code " + code + " already exists");
        }
        SignCategory category = categoryService.find(request.categoryId());
        if (!category.isActive()) {
            throw new ConflictException("A sign type cannot be assigned to an inactive category");
        }
        SignType signType = new SignType(
                code,
                request.name().trim(),
                category,
                trimToNull(request.description()),
                trimToNull(request.labelingGuidelines()),
                trimToNull(request.aiLabelPrompt()),
                trimToNull(request.osmMapping()),
                trimToNull(request.representativeImageKey())
        );
        return toResponse(repository.save(signType));
    }

    @Transactional(readOnly = true)
    public SignTypeResponse get(UUID id) {
        return toResponse(find(id));
    }

    @Transactional(readOnly = true)
    public Page<SignTypeResponse> listActive(UUID categoryId, String search, Pageable pageable) {
        return repository.findActive(categoryId, trimToNull(search), pageable).map(this::toResponse);
    }

    @Transactional
    public SignTypeResponse update(UUID id, UpdateSignTypeRequest request) {
        SignType signType = find(id);
        SignCategory category = request.categoryId() == null ? null : categoryService.find(request.categoryId());
        if (category != null && !category.isActive()) {
            throw new ConflictException("A sign type cannot be assigned to an inactive category");
        }
        signType.update(
                trimToNull(request.name()),
                category,
                trimToNull(request.description()),
                trimToNull(request.labelingGuidelines()),
                trimToNull(request.aiLabelPrompt()),
                trimToNull(request.osmMapping()),
                trimToNull(request.representativeImageKey()),
                request.active()
        );
        return toResponse(signType);
    }

    public SignType find(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Sign type " + id + " was not found"));
    }

    public SignTypeResponse toResponse(SignType signType) {
        return new SignTypeResponse(
                signType.getId(),
                signType.getCode(),
                signType.getName(),
                categoryService.toResponse(signType.getCategory()),
                signType.getDescription(),
                signType.getLabelingGuidelines(),
                signType.getAiLabelPrompt(),
                signType.getOsmMapping(),
                signType.getRepresentativeImageKey(),
                signType.isActive()
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
