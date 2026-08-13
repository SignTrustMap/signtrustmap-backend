package com.signtrustmap.backend.dto.catalog;

import jakarta.validation.constraints.Size;

public record UpdateCategoryRequest(
        @Size(min = 1, max = 120) String name,
        @Size(max = 1000) String description,
        Boolean active
) {
}
