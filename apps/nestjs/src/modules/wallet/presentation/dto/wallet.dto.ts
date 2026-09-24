import { IsInt, IsPositive, IsString, IsOptional, MaxLength } from 'class-validator';

export class TopUpDto {
  @IsInt()
  @IsPositive()
  packageId: number;
}

export class CustomTopUpDto {
  @IsInt()
  @IsPositive()
  amount: number; // credits to purchase (10-10000)

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
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

