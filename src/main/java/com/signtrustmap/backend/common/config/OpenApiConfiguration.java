package com.signtrustmap.backend.common.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfiguration {

    @Bean
    OpenAPI signTrustMapOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("SignTrustMap API")
                        .version("v1")
                        .description("Backend API for SignTrustMap traffic sign catalog and verification workflows."));
    }
}
