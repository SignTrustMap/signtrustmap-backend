package com.signtrustmap.backend.identity.dto;

import com.signtrustmap.backend.identity.entity.UserRole;
import com.signtrustmap.backend.identity.entity.UserStatus;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record UserResponse(
        UUID id,
        String email,
        String displayName,
        UserStatus status,
        Set<UserRole> roles,
        Instant createdAt,
        Instant updatedAt
) {
}
