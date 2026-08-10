package com.signtrustmap.backend.identity.dto;

import com.signtrustmap.backend.identity.entity.UserRole;
import com.signtrustmap.backend.identity.entity.UserStatus;
import jakarta.validation.constraints.Size;

import java.util.Set;

public record UpdateUserRequest(
        @Size(min = 1, max = 120) String displayName,
        UserStatus status,
        Set<UserRole> roles
) {
}
