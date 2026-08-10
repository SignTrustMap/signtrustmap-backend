package com.signtrustmap.backend.catalog.repository;

import com.signtrustmap.backend.catalog.entity.SignType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface SignTypeRepository extends JpaRepository<SignType, UUID> {

    boolean existsByCodeIgnoreCase(String code);

    @Query("""
            select signType from SignType signType
            join fetch signType.category category
            where signType.active = true
              and (:categoryId is null or category.id = :categoryId)
              and (:search is null
                   or lower(signType.name) like lower(concat('%', :search, '%'))
                   or lower(signType.code) like lower(concat('%', :search, '%')))
            """)
    Page<SignType> findActive(
            @Param("categoryId") UUID categoryId,
            @Param("search") String search,
            Pageable pageable
    );
}
