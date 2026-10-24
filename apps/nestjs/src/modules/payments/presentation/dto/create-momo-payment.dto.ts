import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMomoPaymentDto {
  @ApiPropertyOptional({
    description: 'Predefined top-up package ID to purchase',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  packageId?: number;

  @ApiPropertyOptional({
    description: 'Custom amount of credits to purchase (10 - 10000) when not selecting a package',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  customAmount?: number;

  @ApiPropertyOptional({
    description: 'Override URL user is redirected to after completing payment',
    example: 'http://localhost:3979/wallet',
  })
  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @ApiPropertyOptional({
    description: 'Optional metadata to roundtrip with MoMo gateway',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  extraData?: string;

  @ApiPropertyOptional({ description: 'Client retry key for payment creation' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
