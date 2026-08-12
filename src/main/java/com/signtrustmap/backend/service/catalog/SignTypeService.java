package com.signtrustmap.backend.service.catalog;

import com.signtrustmap.backend.dto.catalog.CreateSignTypeRequest;
import com.signtrustmap.backend.dto.catalog.SignTypeResponse;
import com.signtrustmap.backend.dto.catalog.UpdateSignTypeRequest;
import com.signtrustmap.backend.entity.catalog.SignType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface SignTypeService {

    SignTypeResponse create(CreateSignTypeRequest request);

    SignTypeResponse get(UUID id);

    Page<SignTypeResponse> listActive(UUID categoryId, String search, Pageable pageable);

    SignTypeResponse update(UUID id, UpdateSignTypeRequest request);

    SignType find(UUID id);

    SignTypeResponse toResponse(SignType signType);
}
