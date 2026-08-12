package com.signtrustmap.backend.repository.catalog;

import com.signtrustmap.backend.entity.catalog.SignCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SignCategoryRepository extends JpaRepository<SignCategory, UUID> {

    boolean existsByCodeIgnoreCase(String code);

    Optional<SignCategory> findByCodeIgnoreCase(String code);

    List<SignCategory> findAllByActiveTrueOrderByNameAsc();
}
