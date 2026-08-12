package com.signtrustmap.backend.service.identity;

import com.signtrustmap.backend.dto.identity.CreateUserRequest;
import com.signtrustmap.backend.dto.identity.UpdateUserRequest;
import com.signtrustmap.backend.dto.identity.UserResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface UserAccountService {

    UserResponse create(CreateUserRequest request);

    UserResponse get(UUID id);

    Page<UserResponse> list(Pageable pageable);

    UserResponse update(UUID id, UpdateUserRequest request);
}
