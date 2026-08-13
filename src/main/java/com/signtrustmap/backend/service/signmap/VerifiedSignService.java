package com.signtrustmap.backend.service.signmap;

import com.signtrustmap.backend.dto.signmap.CreateVerifiedSignRequest;
import com.signtrustmap.backend.dto.signmap.UpdateVerifiedSignRequest;
import com.signtrustmap.backend.dto.signmap.VerifiedSignResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface VerifiedSignService {

    VerifiedSignResponse create(CreateVerifiedSignRequest request);

    VerifiedSignResponse get(UUID id);

    Page<VerifiedSignResponse> findInViewport(
            double minLatitude,
            double minLongitude,
            double maxLatitude,
            double maxLongitude,
            UUID signTypeId,
            Pageable pageable
    );

    VerifiedSignResponse update(UUID id, UpdateVerifiedSignRequest request);
}
