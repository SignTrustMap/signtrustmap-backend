package com.signtrustmap.backend.catalog.entity;

import com.signtrustmap.backend.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "sign_type")
public class SignType extends BaseEntity {

    @Column(nullable = false, unique = true, length = 50)
    private String code;

    @Column(nullable = false, length = 160)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "category_id", nullable = false)
    private SignCategory category;

    @Column(length = 2000)
    private String description;

    @Column(name = "labeling_guidelines", length = 4000)
    private String labelingGuidelines;

    @Column(name = "ai_label_prompt", length = 1000)
    private String aiLabelPrompt;

    @Column(name = "osm_mapping", length = 1000)
    private String osmMapping;

    @Column(name = "representative_image_key", length = 500)
    private String representativeImageKey;

    @Column(nullable = false)
    private boolean active;

    protected SignType() {
    }

    public SignType(
            String code,
            String name,
            SignCategory category,
            String description,
            String labelingGuidelines,
            String aiLabelPrompt,
            String osmMapping,
            String representativeImageKey
    ) {
        this.code = code;
        this.name = name;
        this.category = category;
        this.description = description;
        this.labelingGuidelines = labelingGuidelines;
        this.aiLabelPrompt = aiLabelPrompt;
        this.osmMapping = osmMapping;
        this.representativeImageKey = representativeImageKey;
        this.active = true;
    }

    public void update(
            String name,
            SignCategory category,
            String description,
            String labelingGuidelines,
            String aiLabelPrompt,
            String osmMapping,
            String representativeImageKey,
            Boolean active
    ) {
        if (name != null) {
            this.name = name;
        }
        if (category != null) {
            this.category = category;
        }
        if (description != null) {
            this.description = description;
        }
        if (labelingGuidelines != null) {
            this.labelingGuidelines = labelingGuidelines;
        }
        if (aiLabelPrompt != null) {
            this.aiLabelPrompt = aiLabelPrompt;
        }
        if (osmMapping != null) {
            this.osmMapping = osmMapping;
        }
        if (representativeImageKey != null) {
            this.representativeImageKey = representativeImageKey;
        }
        if (active != null) {
            this.active = active;
        }
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public SignCategory getCategory() {
        return category;
    }

    public String getDescription() {
        return description;
    }

    public String getLabelingGuidelines() {
        return labelingGuidelines;
    }

    public String getAiLabelPrompt() {
        return aiLabelPrompt;
    }

    public String getOsmMapping() {
        return osmMapping;
    }

    public String getRepresentativeImageKey() {
        return representativeImageKey;
    }

    public boolean isActive() {
        return active;
    }
}
