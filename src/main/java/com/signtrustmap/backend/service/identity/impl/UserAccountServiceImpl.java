package com.signtrustmap.backend.service.identity.impl;

import com.signtrustmap.backend.dto.identity.CreateUserRequest;
import com.signtrustmap.backend.dto.identity.UpdateUserRequest;
import com.signtrustmap.backend.dto.identity.UserResponse;
import com.signtrustmap.backend.entity.identity.UserAccount;
import com.signtrustmap.backend.entity.identity.UserRole;
import com.signtrustmap.backend.exception.ConflictException;
import com.signtrustmap.backend.exception.ResourceNotFoundException;
import com.signtrustmap.backend.repository.identity.UserAccountRepository;
import com.signtrustmap.backend.service.identity.UserAccountService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class UserAccountServiceImpl implements UserAccountService {

    private final UserAccountRepository repository;

    public UserAccountServiceImpl(UserAccountRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public UserResponse create(CreateUserRequest request) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (repository.existsByEmailIgnoreCase(email)) {
            throw new ConflictException("A user with this email already exists");
        }

        Set<UserRole> roles = request.roles() == null || request.roles().isEmpty()
                ? Set.of(UserRole.DRIVER)
                : Set.copyOf(request.roles());
        UserAccount user = new UserAccount(email, request.displayName().trim(), roles);
        return toResponse(repository.save(user));
    }

    @Override
    @Transactional(readOnly = true)
    public UserResponse get(UUID id) {
        return toResponse(find(id));
    }

    @Override
    @Transactional(readOnly = true)
    public Page<UserResponse> list(Pageable pageable) {
        return repository.findAll(pageable).map(this::toResponse);
    }

    @Override
    @Transactional
    public UserResponse update(UUID id, UpdateUserRequest request) {
        UserAccount user = find(id);
        String displayName = request.displayName() == null ? null : request.displayName().trim();
        Set<UserRole> roles = request.roles() == null ? null : Set.copyOf(request.roles());
        user.update(displayName, request.status(), roles);
        return toResponse(user);
    }

    private UserAccount find(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User " + id + " was not found"));
    }

    private UserResponse toResponse(UserAccount user) {
        return new UserResponse(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getStatus(),
                user.getRoles(),
                user.getCreatedAt(),
                user.getUpdatedAt()
        );
    }
}
