import { VerifiedSign } from './verified-sign';

export const VERIFIED_SIGN_REPOSITORY = Symbol('VERIFIED_SIGN_REPOSITORY');

export interface VerifiedSignRepository {
  findActiveAlongRoute(routeWkt: string, corridorWidthMeters: number): Promise<VerifiedSign[]>;
}
