import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from '../application/payments.service';
import { MomoPaymentService } from '../application/momo-payment.service';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { CreateMomoPaymentDto } from './dto/create-momo-payment.dto';
import { MomoIpnDto } from './dto/momo-ipn.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly svc: PaymentsService,
    @Optional() private readonly momoService?: MomoPaymentService,
  ) {}

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

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create MoMo payment session',
    description: 'Initiate a top-up transaction with MoMo Sandbox gateway and generate payment URL / QR code',
  })
  @Post('momo/create')
  createMomoPayment(
    @CurrentUser() user: any,
    @Body() dto: CreateMomoPaymentDto,
  ) {
    if (!this.momoService) {
      throw new ServiceUnavailableException('MoMo payment service is unavailable');
    }
    return this.momoService.createPayment(user.id, dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'MoMo IPN callback',
    description: 'Instant Payment Notification webhook from MoMo Sandbox to verify and settle payment',
  })
  @Post('momo/ipn')
  handleMomoIpn(@Body() dto: MomoIpnDto) {
    if (!this.momoService) {
      throw new ServiceUnavailableException('MoMo payment service is unavailable');
    }
    return this.momoService.handleIpn(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Query MoMo transaction status',
    description: 'Query MoMo Sandbox gateway to verify real-time status of an order',
  })
  @Get('momo/query/:orderCode')
  queryMomoTransaction(
    @Param('orderCode') orderCode: string,
    @Query('requestId') requestId?: string,
  ) {
    if (!this.momoService) {
      throw new ServiceUnavailableException('MoMo payment service is unavailable');
    }
    return this.momoService.queryTransaction(orderCode, requestId);
  }
}


