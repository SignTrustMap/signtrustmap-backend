import { Controller, Post, Get, Body, Headers } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiHeader } from '@nestjs/swagger';
import { PaymentsService } from '../application/payments.service';
import { Public } from '../../../common/decorators/public.decorator';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Public()
  @ApiOperation({
    summary: 'List active top-up packages',
    description: 'Retrieve all available credit top-up packages for drivers and surveyors',
  })
  @Get('packages')
  listPackages() {
    return this.svc.listPackages();
  }

  @Public()
  @ApiOperation({
    summary: 'Payment provider webhook',
    description: 'Process asynchronous payment gateway callbacks and credit user wallet with HMAC verification',
  })
  @ApiHeader({
    name: 'x-webhook-signature',
    required: false,
    description: 'HMAC-SHA256 signature of the payload',
  })
  @Post('webhook')
  handleWebhook(
    @Body() dto: PaymentWebhookDto,
    @Headers('x-webhook-signature') signature?: string,
    @Headers('stripe-signature') stripeSignature?: string,
  ) {
    return this.svc.handleWebhook(dto, signature || stripeSignature);
  }
}

