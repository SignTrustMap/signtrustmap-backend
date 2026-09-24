export const VEHICLE_TYPES = [
  'CAR',
  'MOTORCYCLE',
  'TRUCK',
  'BUS',
  'BICYCLE',
  'PEDESTRIAN',
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];