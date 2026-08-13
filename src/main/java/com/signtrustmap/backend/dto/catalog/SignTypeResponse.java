package com.signtrustmap.backend.dto.catalog;

import java.util.UUID;

public record SignTypeResponse(
        UUID id,
        String code,
        String name,
        CategoryResponse category,
        String description,
        String labelingGuidelines,
        String aiLabelPrompt,
        String osmMapping,
        String representativeImageKey,
        boolean active
) {
}
