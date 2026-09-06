import { CreateVerifiedSign, UpdateVerifiedSign, VerifiedSign } from './verified-sign';

export const VERIFIED_SIGN_REPOSITORY = Symbol('VERIFIED_SIGN_REPOSITORY');

export interface VerifiedSignRepository {
  findById(id: string): Promise<VerifiedSign | null>;
  create(sign: CreateVerifiedSign): Promise<VerifiedSign>;
  update(id: string, sign: UpdateVerifiedSign): Promise<VerifiedSign | null>;
  findActiveAlongRoute(routeWkt: string, corridorWidthMeters: number): Promise<VerifiedSign[]>;
}
