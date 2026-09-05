import { IsString, IsOptional, IsIn } from 'class-validator';
export class PaymentWebhookDto {
  @IsString() orderCode: string;
  @IsString() @IsOptional() gateway?: string;
  @IsIn(['SUCCESS', 'FAILED', 'EXPIRED']) status: string;
  @IsOptional() amountVnd?: string | number;
  @IsOptional() rawPayload?: Record<string, any>;
}
