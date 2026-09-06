import { Controller, Post, Body } from '@nestjs/common';
import { PaymentsService } from '../application/payments.service';
import { Public } from '../../../common/decorators/public.decorator';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Public()
  @Post('webhook')
  handleWebhook(@Body() dto: PaymentWebhookDto) {
    return this.svc.handleWebhook(dto);
  }
}
