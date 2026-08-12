package com.signtrustmap.backend.service.signmap;

import com.signtrustmap.backend.dto.signmap.CreateVerifiedSignRequest;
import com.signtrustmap.backend.dto.signmap.UpdateVerifiedSignRequest;
import com.signtrustmap.backend.dto.signmap.VerifiedSignResponse;
import com.signtrustmap.backend.entity.catalog.SignType;
import com.signtrustmap.backend.entity.signmap.VerifiedSign;
import com.signtrustmap.backend.exception.ConflictException;
import com.signtrustmap.backend.exception.InvalidRequestException;
import com.signtrustmap.backend.exception.ResourceNotFoundException;
import com.signtrustmap.backend.repository.signmap.VerifiedSignRepository;
import com.signtrustmap.backend.service.catalog.SignTypeService;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
public class VerifiedSignService {

    private static final GeometryFactory GEOMETRY_FACTORY =
            new GeometryFactory(new PrecisionModel(), 4326);

    private final VerifiedSignRepository repository;
    private final SignTypeService signTypeService;

    public VerifiedSignService(VerifiedSignRepository repository, SignTypeService signTypeService) {
        this.repository = repository;
        this.signTypeService = signTypeService;
    }

    @Transactional
    public VerifiedSignResponse create(CreateVerifiedSignRequest request) {
        SignType signType = requireActiveSignType(request.signTypeId());
        VerifiedSign sign = new VerifiedSign(
                signType,
                point(request.longitude(), request.latitude()),
                request.headingDegrees(),
                request.trafficDirection(),
                trimToNull(request.imageObjectKey()),
                request.lastVerifiedAt() == null ? Instant.now() : request.lastVerifiedAt()
        );
        return toResponse(repository.save(sign));
    }

    @Transactional(readOnly = true)
    public VerifiedSignResponse get(UUID id) {
        return toResponse(find(id));
    }

    @Transactional(readOnly = true)
    public Page<VerifiedSignResponse> findInViewport(
            double minLatitude,
            double minLongitude,
            double maxLatitude,
            double maxLongitude,
            UUID signTypeId,
            Pageable pageable
    ) {
        validateViewport(minLatitude, minLongitude, maxLatitude, maxLongitude);
        Page<VerifiedSign> signs = signTypeId == null
                ? repository.findActiveInViewport(
                        minLongitude, minLatitude, maxLongitude, maxLatitude, pageable)
                : repository.findActiveInViewportBySignType(
                        signTypeId, minLongitude, minLatitude, maxLongitude, maxLatitude, pageable);
        return signs.map(this::toResponse);
    }

    @Transactional
    public VerifiedSignResponse update(UUID id, UpdateVerifiedSignRequest request) {
        if ((request.latitude() == null) != (request.longitude() == null)) {
            throw new InvalidRequestException("Latitude and longitude must be updated together");
        }
        SignType signType = request.signTypeId() == null
                ? null
                : requireActiveSignType(request.signTypeId());
        Point location = request.latitude() == null
                ? null
                : point(request.longitude(), request.latitude());

        VerifiedSign sign = find(id);
        sign.update(
                signType,
                location,
                request.headingDegrees(),
                request.trafficDirection(),
                trimToNull(request.imageObjectKey()),
                request.lastVerifiedAt(),
                request.status()
        );
        return toResponse(sign);
    }

    private SignType requireActiveSignType(UUID id) {
        SignType signType = signTypeService.find(id);
        if (!signType.isActive()) {
            throw new ConflictException("Verified signs cannot use an inactive sign type");
        }
        return signType;
    }

    private VerifiedSign find(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Verified sign " + id + " was not found"));
    }

    private Point point(double longitude, double latitude) {
        Point point = GEOMETRY_FACTORY.createPoint(new Coordinate(longitude, latitude));
        point.setSRID(4326);
        return point;
    }

    private void validateViewport(
            double minLatitude,
            double minLongitude,
            double maxLatitude,
            double maxLongitude
    ) {
        if (minLatitude >= maxLatitude || minLongitude >= maxLongitude) {
            throw new InvalidRequestException("Viewport minimum values must be less than maximum values");
        }
    }

    private VerifiedSignResponse toResponse(VerifiedSign sign) {
        return new VerifiedSignResponse(
                sign.getId(),
                signTypeService.toResponse(sign.getSignType()),
                sign.getLocation().getY(),
                sign.getLocation().getX(),
                sign.getHeadingDegrees(),
                sign.getTrafficDirection(),
                sign.getImageObjectKey(),
                sign.getLastVerifiedAt(),
                sign.getStatus(),
                sign.getCreatedAt(),
                sign.getUpdatedAt()
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
