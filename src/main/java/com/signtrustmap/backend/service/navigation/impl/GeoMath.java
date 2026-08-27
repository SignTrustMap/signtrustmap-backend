package com.signtrustmap.backend.service.navigation.impl;

final class GeoMath {

    private static final double EARTH_RADIUS_METERS = 6_371_000.0;

    private GeoMath() {
    }

    static double distanceMeters(double latitudeA, double longitudeA, double latitudeB, double longitudeB) {
        double lat1 = Math.toRadians(latitudeA);
        double lat2 = Math.toRadians(latitudeB);
        double deltaLat = Math.toRadians(latitudeB - latitudeA);
        double deltaLon = Math.toRadians(longitudeB - longitudeA);

        double a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
                + Math.cos(lat1) * Math.cos(lat2)
                * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS_METERS * c;
    }
}
