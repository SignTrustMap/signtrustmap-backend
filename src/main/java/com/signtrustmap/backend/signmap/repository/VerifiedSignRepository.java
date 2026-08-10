package com.signtrustmap.backend.signmap.repository;

import com.signtrustmap.backend.signmap.entity.VerifiedSign;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface VerifiedSignRepository extends JpaRepository<VerifiedSign, UUID> {

    @Query(
            value = """
                    select sign.*
                    from verified_sign sign
                    where sign.status = 'ACTIVE'
                      and ST_Intersects(
                            sign.location,
                            ST_MakeEnvelope(:minLongitude, :minLatitude, :maxLongitude, :maxLatitude, 4326)
                          )
                    """,
            countQuery = """
                    select count(*)
                    from verified_sign sign
                    where sign.status = 'ACTIVE'
                      and ST_Intersects(
                            sign.location,
                            ST_MakeEnvelope(:minLongitude, :minLatitude, :maxLongitude, :maxLatitude, 4326)
                          )
                    """,
            nativeQuery = true
    )
    Page<VerifiedSign> findActiveInViewport(
            @Param("minLongitude") double minLongitude,
            @Param("minLatitude") double minLatitude,
            @Param("maxLongitude") double maxLongitude,
            @Param("maxLatitude") double maxLatitude,
            Pageable pageable
    );

    @Query(
            value = """
                    select sign.*
                    from verified_sign sign
                    where sign.status = 'ACTIVE'
                      and sign.sign_type_id = :signTypeId
                      and ST_Intersects(
                            sign.location,
                            ST_MakeEnvelope(:minLongitude, :minLatitude, :maxLongitude, :maxLatitude, 4326)
                          )
                    """,
            countQuery = """
                    select count(*)
                    from verified_sign sign
                    where sign.status = 'ACTIVE'
                      and sign.sign_type_id = :signTypeId
                      and ST_Intersects(
                            sign.location,
                            ST_MakeEnvelope(:minLongitude, :minLatitude, :maxLongitude, :maxLatitude, 4326)
                          )
                    """,
            nativeQuery = true
    )
    Page<VerifiedSign> findActiveInViewportBySignType(
            @Param("signTypeId") UUID signTypeId,
            @Param("minLongitude") double minLongitude,
            @Param("minLatitude") double minLatitude,
            @Param("maxLongitude") double maxLongitude,
            @Param("maxLatitude") double maxLatitude,
            Pageable pageable
    );
}
