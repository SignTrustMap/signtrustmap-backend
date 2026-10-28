import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('candidate_geo_estimations')
export class CandidateGeoEstimation {
  @PrimaryColumn({ name: 'candidate_id', type: 'uuid' })
  candidateId: string;

  @Column({ name: 'vehicle_location', type: 'geometry', spatialFeatureType: 'Point', srid: 4326 })
  vehicleLocation: string;

  @Index('candidate_geo_estimations_sign_location_idx', { spatial: true })
  @Column({ name: 'sign_location', type: 'geometry', spatialFeatureType: 'Point', srid: 4326 })
  signLocation: string;

  @Column({ name: 'estimated_distance', type: 'float' })
  estimatedDistance: number;

  @Column({ name: 'bearing_angle', type: 'float' })
  bearingAngle: number;

  @Column({ name: 'traffic_direction', type: 'float', nullable: true })
  trafficDirection?: number | null;

  @Column({ name: 'projection_method', type: 'varchar', length: 50, default: 'spherical_trig' })
  projectionMethod: string;
}
