package com.signtrustmap.backend.service.catalog;

import com.signtrustmap.backend.dto.catalog.CategoryResponse;
import com.signtrustmap.backend.dto.catalog.CreateCategoryRequest;
import com.signtrustmap.backend.dto.catalog.UpdateCategoryRequest;
import com.signtrustmap.backend.entity.catalog.SignCategory;

import java.util.List;
import java.util.UUID;

public interface SignCategoryService {

    CategoryResponse create(CreateCategoryRequest request);

    List<CategoryResponse> listActive();

    CategoryResponse get(UUID id);

    CategoryResponse update(UUID id, UpdateCategoryRequest request);

    SignCategory find(UUID id);

    CategoryResponse toResponse(SignCategory category);
}
