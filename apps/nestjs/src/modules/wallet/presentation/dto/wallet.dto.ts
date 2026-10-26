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
  Max,
  IsDateString,
} from 'class-validator';

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ default: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, description: 'Page size (1-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by transaction type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @ApiPropertyOptional({ description: 'Filter from ISO date (YYYY-MM-DD)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter to ISO date (YYYY-MM-DD)', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TopUpDto {
  @ApiProperty({ description: 'ID of the top-up package', example: 1, minimum: 1, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(2147483647)
  packageId: number;

  @ApiPropertyOptional({ description: 'Payment gateway (e.g. MOCK, MOMO)', example: 'MOCK' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  gateway?: string;

  @ApiPropertyOptional({ description: 'Unique idempotency key', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CustomTopUpDto {
  @ApiProperty({ description: 'Credits to purchase (10-10000)', example: 100, minimum: 10, maximum: 10000 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Min(10)
  @Max(10000)
  amount: number; // credits to purchase (10-10000)

  @ApiPropertyOptional({ description: 'Description or note', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Payment gateway (e.g. MOCK, MOMO)', example: 'MOCK' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  gateway?: string;

  @ApiPropertyOptional({ description: 'Unique idempotency key', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CreatePaymentMethodDto {
  @ApiProperty({ description: 'Cardholder name', example: 'NGUYEN VAN A', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  cardHolderName: string;

  @ApiProperty({ description: 'Last 4 digits of card', example: '4242', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  cardLast4: string;

  @ApiPropertyOptional({ description: 'Card brand (e.g. VISA, MASTERCARD)', example: 'VISA', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cardBrand?: string;

  @ApiProperty({ description: 'Expiry month (2 digits, e.g. 12)', example: '12', maxLength: 2 })
  @IsString()
  @MaxLength(2)
  expiryMonth: string;

  @ApiProperty({ description: 'Expiry year (4 digits, e.g. 2028)', example: '2028', maxLength: 4 })
  @IsString()
  @MaxLength(4)
  expiryYear: string;

  @ApiPropertyOptional({ description: 'Set as default payment method' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ManualAdjustmentDto {
  @ApiProperty({ description: 'Credits amount to adjust (can be positive or negative)', example: 50 })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  amount: number;

  @ApiProperty({ description: 'Reason for adjustment', example: 'System compensation', minLength: 5, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: 'Reference type', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @ApiPropertyOptional({ description: 'Reference ID', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceId?: string;

  @ApiPropertyOptional({ description: 'Idempotency key', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class FreezeWalletDto {
  @ApiProperty({ description: 'Whether to freeze or unfreeze wallet' })
  @IsBoolean()
  freeze: boolean;

  @ApiPropertyOptional({ description: 'Reason for freeze', maxLength: 500 })
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


