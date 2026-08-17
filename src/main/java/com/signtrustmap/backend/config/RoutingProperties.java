package com.signtrustmap.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@ConfigurationProperties(prefix = "routing")
public class RoutingProperties {

    private Provider provider = Provider.OSRM;
    private Osrm osrm = new Osrm();

    public Provider getProvider() {
        return provider;
    }

    public void setProvider(Provider provider) {
        this.provider = provider;
    }

    public Osrm getOsrm() {
        return osrm;
    }

    public void setOsrm(Osrm osrm) {
        this.osrm = osrm;
    }

    public enum Provider {
        LOCAL_GRAPH,
        OSRM
    }

    public static class Osrm {

        private String baseUrl = "https://router.project-osrm.org";
        private String profile = "driving";
        private Duration timeout = Duration.ofSeconds(5);

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public String getProfile() {
            return profile;
        }

        public void setProfile(String profile) {
            this.profile = profile;
        }

        public Duration getTimeout() {
            return timeout;
        }

        public void setTimeout(Duration timeout) {
            this.timeout = timeout;
        }
    }
}
