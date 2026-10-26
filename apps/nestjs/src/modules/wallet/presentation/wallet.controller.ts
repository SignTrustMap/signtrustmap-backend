import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from '../application/wallet.service';
import {
  TopUpDto,
  CustomTopUpDto,
  CreatePaymentMethodDto,
  InternalCreditDto,
  InternalDeductDto,
  ListTransactionsQueryDto,
} from './dto/wallet.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../../../common/guards/internal-token.guard';
import { TransactionType } from '../infrastructure/persistence/credit-transaction.entity';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get wallet balance', description: 'Retrieve current credit balance and wallet status for the authenticated user' })
  @Get()
  async getWallet(@CurrentUser() user: any) { return this.walletService.getWallet(user.id); }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'List transactions', description: 'Paginated list of credit transactions, top-ups, and navigation deductions' })
  @Get('transactions')
  async listTransactions(
    @CurrentUser() user: any,
    @Query() query?: ListTransactionsQueryDto | any,
    @Query('pageSize') legacyPageSize?: string,
    @Query('type') legacyType?: string,
    @Query('from') legacyFrom?: string,
    @Query('to') legacyTo?: string,
  ) {
    let p = 1;
    let ps = 20;
    let type: string | undefined;
    let from: string | undefined;
    let to: string | undefined;

    if (typeof query === 'string' || typeof query === 'number') {
      p = parseInt(String(query), 10);
      ps = legacyPageSize ? parseInt(legacyPageSize, 10) : 20;
      type = legacyType;
      from = legacyFrom;
      to = legacyTo;
    } else if (query && typeof query === 'object') {
      p = query.page ? Number(query.page) : (legacyPageSize ? parseInt(legacyPageSize, 10) : 1);
      ps = query.pageSize ? Number(query.pageSize) : 20;
      type = query.type ?? legacyType;
      from = query.from ?? legacyFrom;
      to = query.to ?? legacyTo;
    }

    return this.walletService.listTransactions(user.id, {
      page: Number.isNaN(Number(p)) ? 1 : Number(p),
      pageSize: Number.isNaN(Number(ps)) ? 20 : Number(ps),
      type,
      from,
      to,
    });
  }

  @Public()
  @ApiOperation({ summary: 'List top-up packages', description: 'Available credit top-up packages with bonuses and pricing' })
  @Get('top-up/packages')
  async listPackages() { return this.walletService.listPackages(); }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Purchase top-up package', description: 'Initiate a credit purchase for a predefined top-up package' })
  @Post('top-up')
  async topUp(@CurrentUser() user: any, @Body() dto: TopUpDto) { return this.walletService.topUp(user.id, dto); }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Custom amount top-up', description: 'Top up credits with an arbitrary custom currency amount' })
  @Post('top-up/custom')
  async topUpCustom(@CurrentUser() user: any, @Body() dto: CustomTopUpDto) {
    return this.walletService.topUpCustom(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payment methods', description: 'List saved payment cards and accounts for the user' })
  @Get('payment-methods')
  async listPaymentMethods(@CurrentUser() user: any) {
    return this.walletService.listPaymentMethods(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add payment method', description: 'Save a new payment method (e.g. credit card or e-wallet token)' })
  @Post('payment-methods')
  async addPaymentMethod(@CurrentUser() user: any, @Body() dto: CreatePaymentMethodDto) {
    return this.walletService.addPaymentMethod(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete payment method', description: 'Remove a saved payment method by ID' })
  @Delete('payment-methods/:id')
  async deletePaymentMethod(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.walletService.removePaymentMethod(user.id, id);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal deduct credits', description: 'Service-to-service endpoint to deduct credits (e.g. navigation fee)' })
  @Post('internal/deduct')
  async internalDeduct(@Body() body: InternalDeductDto) {
    if (!body.userId || !body.amount) throw new BadRequestException('userId and amount are required');
    return this.walletService.deductUser(
      body.userId,
      Math.abs(Number(body.amount)),
      TransactionType.NAVIGATION_FEE,
      body.referenceType ?? 'navigation_session',
      body.referenceId ?? null,
      body.description ?? 'Navigation session fee',
      { idempotencyKey: body.idempotencyKey },
    );
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal credit rewards', description: 'Service-to-service endpoint to credit user rewards' })
  @Post('internal/credit')
  async internalCredit(@Body() body: InternalCreditDto) {
    if (!body.userId || !body.amount) throw new BadRequestException('userId and amount are required');
    return this.walletService.creditUser(
      body.userId,
      Math.abs(Number(body.amount)),
      (body.type as TransactionType) ?? TransactionType.SURVEY_REWARD,
      body.referenceType ?? null,
      body.referenceId ?? null,
      body.description ?? 'Reward credit',
      { idempotencyKey: body.idempotencyKey },
    );
  }
}

