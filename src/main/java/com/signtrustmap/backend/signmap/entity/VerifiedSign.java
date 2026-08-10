package com.signtrustmap.backend.signmap.entity;

import com.signtrustmap.backend.catalog.entity.SignType;
import com.signtrustmap.backend.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.locationtech.jts.geom.Point;

import java.time.Instant;

@Entity
@Table(name = "verified_sign")
public class VerifiedSign extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sign_type_id", nullable = false)
    private SignType signType;

    @Column(nullable = false, columnDefinition = "geometry(Point,4326)")
    private Point location;

    @Column(name = "heading_degrees")
    private Double headingDegrees;

    @Enumerated(EnumType.STRING)
    @Column(name = "traffic_direction", nullable = false, length = 20)
    private TrafficDirection trafficDirection;

    @Column(name = "image_object_key", length = 500)
    private String imageObjectKey;

    @Column(name = "last_verified_at", nullable = false)
    private Instant lastVerifiedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private VerifiedSignStatus status;

    protected VerifiedSign() {
    }

    public VerifiedSign(
            SignType signType,
            Point location,
            Double headingDegrees,
            TrafficDirection trafficDirection,
            String imageObjectKey,
            Instant lastVerifiedAt
    ) {
        this.signType = signType;
        this.location = location;
        this.headingDegrees = headingDegrees;
        this.trafficDirection = trafficDirection;
        this.imageObjectKey = imageObjectKey;
        this.lastVerifiedAt = lastVerifiedAt;
        this.status = VerifiedSignStatus.ACTIVE;
    }

    public void update(
            SignType signType,
            Point location,
            Double headingDegrees,
            TrafficDirection trafficDirection,
            String imageObjectKey,
            Instant lastVerifiedAt,
            VerifiedSignStatus status
    ) {
        if (signType != null) {
            this.signType = signType;
        }
        if (location != null) {
            this.location = location;
        }
        if (headingDegrees != null) {
            this.headingDegrees = headingDegrees;
        }
        if (trafficDirection != null) {
            this.trafficDirection = trafficDirection;
        }
        if (imageObjectKey != null) {
            this.imageObjectKey = imageObjectKey;
        }
        if (lastVerifiedAt != null) {
            this.lastVerifiedAt = lastVerifiedAt;
        }
        if (status != null) {
            this.status = status;
        }
    }

    public SignType getSignType() {
        return signType;
    }

    public Point getLocation() {
        return location;
    }

    public Double getHeadingDegrees() {
        return headingDegrees;
    }

    public TrafficDirection getTrafficDirection() {
        return trafficDirection;
    }

    public String getImageObjectKey() {
        return imageObjectKey;
    }

    public Instant getLastVerifiedAt() {
        return lastVerifiedAt;
    }

    public VerifiedSignStatus getStatus() {
        return status;
    }
}
