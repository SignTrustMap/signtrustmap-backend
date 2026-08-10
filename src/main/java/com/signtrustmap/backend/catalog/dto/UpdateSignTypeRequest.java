package com.signtrustmap.backend.catalog.dto;

import jakarta.validation.constraints.Size;

import java.util.UUID;

public record UpdateSignTypeRequest(
        @Size(min = 1, max = 160) String name,
        UUID categoryId,
        @Size(max = 2000) String description,
        @Size(max = 4000) String labelingGuidelines,
        @Size(max = 1000) String aiLabelPrompt,
        @Size(max = 1000) String osmMapping,
        @Size(max = 500) String representativeImageKey,
        Boolean active
) {
}
