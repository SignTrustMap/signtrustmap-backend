package com.signtrustmap.backend.identity.entity;

import com.signtrustmap.backend.common.entity.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "app_user")
public class UserAccount extends BaseEntity {

    @Column(nullable = false, length = 320)
    private String email;

    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserStatus status;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_role", joinColumns = @JoinColumn(name = "user_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 30)
    private Set<UserRole> roles = new HashSet<>();

    protected UserAccount() {
    }

    public UserAccount(String email, String displayName, Set<UserRole> roles) {
        this.email = email;
        this.displayName = displayName;
        this.status = UserStatus.ACTIVE;
        this.roles.addAll(roles);
    }

    public void update(String displayName, UserStatus status, Set<UserRole> roles) {
        if (displayName != null) {
            this.displayName = displayName;
        }
        if (status != null) {
            this.status = status;
        }
        if (roles != null && !roles.isEmpty()) {
            this.roles.clear();
            this.roles.addAll(roles);
        }
    }

    public String getEmail() {
        return email;
    }

    public String getDisplayName() {
        return displayName;
    }

    public UserStatus getStatus() {
        return status;
    }

    public Set<UserRole> getRoles() {
        return Collections.unmodifiableSet(roles);
    }
}
