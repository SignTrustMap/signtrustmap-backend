package com.signtrustmap.backend.dto.catalog;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateSignTypeRequest(
        @NotBlank @Size(max = 50) @Pattern(regexp = "[A-Za-z0-9._-]+") String code,
        @NotBlank @Size(max = 160) String name,
        @NotNull UUID categoryId,
        @Size(max = 2000) String description,
        @Size(max = 4000) String labelingGuidelines,
        @Size(max = 1000) String aiLabelPrompt,
        @Size(max = 1000) String osmMapping,
        @Size(max = 500) String representativeImageKey
) {
}
