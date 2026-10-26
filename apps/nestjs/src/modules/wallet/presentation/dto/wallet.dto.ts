import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsPositive,
  IsString,
  IsOptional,
  MaxLength,
  IsNotEmpty,
  MinLength,
  NotEquals,
  IsBoolean,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';

export class TopUpDto {
  @IsInt()
  @IsPositive()
  packageId: number;

  @IsOptional()
  @IsString()
  gateway?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CustomTopUpDto {
  @IsInt()
  @IsPositive()
  amount: number; // credits to purchase (10-10000)

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  gateway?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CreatePaymentMethodDto {
  @IsString()
  @MaxLength(100)
  cardHolderName: string;

  @IsString()
  @MaxLength(20)
  cardLast4: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cardBrand?: string;

  @IsString()
  @MaxLength(2)
  expiryMonth: string;

  @IsString()
  @MaxLength(4)
  expiryYear: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  isDefault?: boolean;
}

export class ManualAdjustmentDto {
  @IsInt()
  @NotEquals(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class FreezeWalletDto {
  @IsBoolean()
  freeze: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class InternalDeductDto {
  @ApiProperty({ description: 'Target user UUID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Credit amount to deduct', minimum: 1, example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Reference type', example: 'navigation_session' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @ApiPropertyOptional({ description: 'Reference ID' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceId?: string;

  @ApiPropertyOptional({ description: 'Transaction description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class InternalCreditDto {
  @ApiProperty({ description: 'Target user UUID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Credit amount to reward/credit', minimum: 1, example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Transaction type code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @ApiPropertyOptional({ description: 'Reference type', example: 'survey_batch' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @ApiPropertyOptional({ description: 'Reference ID' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceId?: string;

  @ApiPropertyOptional({ description: 'Transaction description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}


