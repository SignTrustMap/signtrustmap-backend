import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NavigationRouteDto {
  @ApiProperty({
    description: 'Route geometry encoded using the standard precision-5 polyline format.',
    example: 'a~l~Rjk~{fE_seK_seK',
  })
  geometry: string;

  @ApiProperty({ example: 7300 })
  distanceMeters: number;

  @ApiProperty({ example: 1050 })
  durationSeconds: number;
}

export class NavigationStepDto {
  @ApiProperty({ example: 'turn' })
  type: string;

  @ApiProperty({ example: 'Turn right onto Nguyen Hue' })
  instruction: string;

  @ApiProperty({ example: 120 })
  distanceMeters: number;
}

export class NavigationTrafficSignDto {
  @ApiProperty({ example: '3cbdd8f6-f8f6-4999-bd2e-6b0934e42b0f' })
  id: string;

  @ApiProperty({ example: 'SPEED_LIMIT' })
  type: string;

  @ApiPropertyOptional({ example: 50 })
  value?: number;

  @ApiProperty({ example: 10.77692 })
  lat: number;

  @ApiProperty({ example: 106.70032 })
  lon: number;

  @ApiProperty({ example: 820 })
  routeOffsetMeters: number;
}

export class NavigationResponseDto {
  @ApiProperty({ type: NavigationRouteDto })
  route: NavigationRouteDto;

  @ApiProperty({ type: NavigationStepDto, isArray: true })
  steps: NavigationStepDto[];

  @ApiProperty({ type: NavigationTrafficSignDto, isArray: true })
  trafficSigns: NavigationTrafficSignDto[];
}
