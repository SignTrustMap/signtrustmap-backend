import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from '../application/payments.service';
import { Public } from '../../../common/decorators/public.decorator';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Public()
  @ApiOperation({ summary: 'Payment provider webhook', description: 'Process asynchronous payment gateway callbacks and credit user wallet' })
  @Post('webhook')
  handleWebhook(@Body() dto: PaymentWebhookDto) {
    return this.svc.handleWebhook(dto);
  }
}
