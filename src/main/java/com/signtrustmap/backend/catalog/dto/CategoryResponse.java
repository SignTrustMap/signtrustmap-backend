package com.signtrustmap.backend.catalog.dto;

import java.util.UUID;

public record CategoryResponse(
        UUID id,
        String code,
        String name,
        String description,
        boolean active
) {
}
