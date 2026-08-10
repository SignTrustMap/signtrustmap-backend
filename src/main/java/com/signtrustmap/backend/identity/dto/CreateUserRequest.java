package com.signtrustmap.backend.identity.dto;

import com.signtrustmap.backend.identity.entity.UserRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Set;

public record CreateUserRequest(
        @NotBlank @Email @Size(max = 320) String email,
        @NotBlank @Size(max = 120) String displayName,
        Set<UserRole> roles
) {
}
