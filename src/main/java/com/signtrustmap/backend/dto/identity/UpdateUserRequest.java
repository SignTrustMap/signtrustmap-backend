package com.signtrustmap.backend.dto.identity;

import com.signtrustmap.backend.entity.identity.UserRole;
import com.signtrustmap.backend.entity.identity.UserStatus;
import jakarta.validation.constraints.Size;

import java.util.Set;

public record UpdateUserRequest(
        @Size(min = 1, max = 120) String displayName,
        UserStatus status,
        Set<UserRole> roles
) {
}
