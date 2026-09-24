import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SignGeolocationMethod,
  SignGeolocationRequest,
  SignGeolocationResponse,
  SignObservation,
} from '../domain/sign-geolocation';

interface ObservationRay {
  cameraX: number;
  cameraY: number;
  eastComponent: number;
  northComponent: number;
  boxHeightPixels: number;
}

@Injectable()
export class SignGeolocationService {
  private static readonly METERS_PER_DEGREE = 111_320;
  private static readonly DEFAULT_FIELD_OF_VIEW_DEGREES = 90;
  private static readonly DEFAULT_IMAGE_WIDTH_PIXELS = 640;
  private static readonly ASSUMED_SIGN_HEIGHT_METERS = 0.6;
  private static readonly MINIMUM_SIGN_HEIGHT_METERS = 0.3;
  private static readonly MAXIMUM_SIGN_HEIGHT_METERS = 1.2;
  private static readonly SINGULARITY_TOLERANCE = 1e-10;

  geolocate(request: SignGeolocationRequest): SignGeolocationResponse {
    if (!request?.observations?.length) {
      throw new BadRequestException('At least one camera observation is required');
    }

    const fieldOfViewDegrees =
      request.horizontalFieldOfViewDegrees ??
      SignGeolocationService.DEFAULT_FIELD_OF_VIEW_DEGREES;
    const imageWidthPixels =
      request.imageWidthPixels ?? SignGeolocationService.DEFAULT_IMAGE_WIDTH_PIXELS;
    this.validateCamera(fieldOfViewDegrees, imageWidthPixels);

    const reference = request.observations[0];
    if (reference?.cameraLatitude == null || reference.cameraLongitude == null) {
      throw new BadRequestException(
        'Every observation must include camera data and a detection box',
      );
    }

    const referenceLatitude = reference.cameraLatitude;
    const referenceLongitude = reference.cameraLongitude;
    const metersPerDegreeLongitude =
      SignGeolocationService.METERS_PER_DEGREE *
      Math.cos(this.toRadians(referenceLatitude));
    if (
      Math.abs(metersPerDegreeLongitude) <
      SignGeolocationService.SINGULARITY_TOLERANCE
    ) {
      throw new BadRequestException(
        'Geolocation is not supported at the geographic poles',
      );
    }

    const focalLengthPixels =
      imageWidthPixels / (2 * Math.tan(this.toRadians(fieldOfViewDegrees / 2)));
    const rays = request.observations.map((observation) =>
      this.toRay(
        observation,
        referenceLatitude,
        referenceLongitude,
        metersPerDegreeLongitude,
        focalLengthPixels,
        imageWidthPixels,
      ),
    );

    if (rays.length >= 2) {
      const triangulated = this.triangulate(
        rays,
        referenceLatitude,
        referenceLongitude,
        metersPerDegreeLongitude,
        focalLengthPixels,
      );
      if (triangulated) return triangulated;
    }

    return this.estimateUsingAssumedHeight(
      rays,
      referenceLatitude,
      referenceLongitude,
      metersPerDegreeLongitude,
      focalLengthPixels,
    );
  }

  private toRay(
    observation: SignObservation,
    referenceLatitude: number,
    referenceLongitude: number,
    metersPerDegreeLongitude: number,
    focalLengthPixels: number,
    imageWidthPixels: number,
  ): ObservationRay {
    if (
      observation?.cameraLatitude == null ||
      observation.cameraLongitude == null ||
      observation.cameraBearingDegrees == null ||
      !observation.detectionBox
    ) {
      throw new BadRequestException(
        'Every observation must include camera data and a detection box',
      );
    }

    const box = observation.detectionBox;
    if (box.xMin == null || box.yMin == null || box.xMax == null || box.yMax == null) {
      throw new BadRequestException('Every detection box coordinate is required');
    }
    if (box.xMax <= box.xMin || box.yMax <= box.yMin) {
      throw new BadRequestException('Detection boxes must have positive width and height');
    }
    if (box.xMin < 0 || box.xMax > imageWidthPixels) {
      throw new BadRequestException(
        'Detection box horizontal coordinates must be inside the image',
      );
    }

    const xCenter = (box.xMin + box.xMax) / 2;
    const bearingOffsetDegrees = this.toDegrees(
      Math.atan((xCenter - imageWidthPixels / 2) / focalLengthPixels),
    );
    const signBearingDegrees = this.normalizeHeading(
      observation.cameraBearingDegrees + bearingOffsetDegrees,
    );
    const cameraX =
      (observation.cameraLongitude - referenceLongitude) * metersPerDegreeLongitude;
    const cameraY =
      (observation.cameraLatitude - referenceLatitude) *
      SignGeolocationService.METERS_PER_DEGREE;

    return {
      cameraX,
      cameraY,
      eastComponent: Math.sin(this.toRadians(signBearingDegrees)),
      northComponent: Math.cos(this.toRadians(signBearingDegrees)),
      boxHeightPixels: box.yMax - box.yMin,
    };
  }

  private triangulate(
    rays: ObservationRay[],
    referenceLatitude: number,
    referenceLongitude: number,
    metersPerDegreeLongitude: number,
    focalLengthPixels: number,
  ): SignGeolocationResponse | null {
    let normalXX = 0;
    let normalXY = 0;
    let normalYY = 0;
    let rightX = 0;
    let rightY = 0;

    for (const ray of rays) {
      const coefficientX = ray.northComponent;
      const coefficientY = -ray.eastComponent;
      const constant = coefficientX * ray.cameraX + coefficientY * ray.cameraY;
      normalXX += coefficientX * coefficientX;
      normalXY += coefficientX * coefficientY;
      normalYY += coefficientY * coefficientY;
      rightX += coefficientX * constant;
      rightY += coefficientY * constant;
    }

    const determinant = normalXX * normalYY - normalXY * normalXY;
    const determinantScale = normalXX * normalYY;
    if (
      determinantScale <= 0 ||
      Math.abs(determinant) <=
        SignGeolocationService.SINGULARITY_TOLERANCE * determinantScale
    ) {
      return null;
    }

    const signX = (rightX * normalYY - normalXY * rightY) / determinant;
    const signY = (normalXX * rightY - normalXY * rightX) / determinant;
    let distanceSum = 0;
    let heightSum = 0;
    for (const ray of rays) {
      const distanceMeters = Math.hypot(signX - ray.cameraX, signY - ray.cameraY);
      distanceSum += distanceMeters;
      heightSum += (distanceMeters * ray.boxHeightPixels) / focalLengthPixels;
    }

    const averageDistanceMeters = distanceSum / rays.length;
    const averageHeightMeters = heightSum / rays.length;
    if (
      !Number.isFinite(averageHeightMeters) ||
      averageHeightMeters < SignGeolocationService.MINIMUM_SIGN_HEIGHT_METERS ||
      averageHeightMeters > SignGeolocationService.MAXIMUM_SIGN_HEIGHT_METERS
    ) {
      return null;
    }

    return this.response(
      referenceLatitude + signY / SignGeolocationService.METERS_PER_DEGREE,
      referenceLongitude + signX / metersPerDegreeLongitude,
      averageDistanceMeters,
      averageHeightMeters,
      SignGeolocationMethod.TRIANGULATION,
      rays.length,
    );
  }

  private estimateUsingAssumedHeight(
    rays: ObservationRay[],
    referenceLatitude: number,
    referenceLongitude: number,
    metersPerDegreeLongitude: number,
    focalLengthPixels: number,
  ): SignGeolocationResponse {
    let latitudeSum = 0;
    let longitudeSum = 0;
    let distanceSum = 0;
    for (const ray of rays) {
      const distanceMeters =
        (focalLengthPixels * SignGeolocationService.ASSUMED_SIGN_HEIGHT_METERS) /
        ray.boxHeightPixels;
      const signX = ray.cameraX + distanceMeters * ray.eastComponent;
      const signY = ray.cameraY + distanceMeters * ray.northComponent;
      longitudeSum += referenceLongitude + signX / metersPerDegreeLongitude;
      latitudeSum +=
        referenceLatitude + signY / SignGeolocationService.METERS_PER_DEGREE;
      distanceSum += distanceMeters;
    }

    return this.response(
      latitudeSum / rays.length,
      longitudeSum / rays.length,
      distanceSum / rays.length,
      SignGeolocationService.ASSUMED_SIGN_HEIGHT_METERS,
      SignGeolocationMethod.ASSUMED_HEIGHT,
      rays.length,
    );
  }

  private response(
    latitude: number,
    longitude: number,
    averageDistanceMeters: number,
    estimatedSignHeightMeters: number,
    method: SignGeolocationMethod,
    observationCount: number,
  ): SignGeolocationResponse {
    return {
      latitude: this.round(latitude, 8),
      longitude: this.round(longitude, 8),
      averageDistanceMeters: this.round(averageDistanceMeters, 2),
      estimatedSignHeightMeters: this.round(estimatedSignHeightMeters, 3),
      method,
      observationCount,
    };
  }

  private validateCamera(fieldOfViewDegrees: number, imageWidthPixels: number): void {
    if (
      !Number.isFinite(fieldOfViewDegrees) ||
      fieldOfViewDegrees < 1 ||
      fieldOfViewDegrees > 179
    ) {
      throw new BadRequestException(
        'Horizontal field of view must be between 1 and 179 degrees',
      );
    }
    if (imageWidthPixels < 2 || imageWidthPixels > 100_000) {
      throw new BadRequestException('Image width must be between 2 and 100000 pixels');
    }
  }

  private normalizeHeading(headingDegrees: number): number {
    return ((headingDegrees % 360) + 360) % 360;
  }

  private round(value: number, decimalPlaces: number): number {
    const factor = 10 ** decimalPlaces;
    return Math.round(value * factor) / factor;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }
}
