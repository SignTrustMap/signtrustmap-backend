package com.signtrustmap.backend.dto.catalog;

import java.util.UUID;

public record CategoryResponse(
        UUID id,
        String code,
        String name,
        String description,
        boolean active
) {
}
