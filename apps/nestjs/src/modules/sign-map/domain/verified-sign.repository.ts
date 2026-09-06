import { CreateVerifiedSign, UpdateVerifiedSign, VerifiedSign } from './verified-sign';

export const VERIFIED_SIGN_REPOSITORY = Symbol('VERIFIED_SIGN_REPOSITORY');

export interface VerifiedSignRepository {
  findById(id: string): Promise<VerifiedSign | null>;
  create(sign: CreateVerifiedSign): Promise<VerifiedSign>;
  update(id: string, sign: UpdateVerifiedSign): Promise<VerifiedSign | null>;
  findActiveInBounds(
    minLatitude: number,
    minLongitude: number,
    maxLatitude: number,
    maxLongitude: number,
    limit: number,
  ): Promise<VerifiedSign[]>;
  findActiveAlongRoute(routeWkt: string, corridorWidthMeters: number): Promise<VerifiedSign[]>;
}
