import { IsInt, IsPositive, IsString, IsOptional, MaxLength, IsNotEmpty, MinLength, NotEquals, IsBoolean } from 'class-validator';

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

