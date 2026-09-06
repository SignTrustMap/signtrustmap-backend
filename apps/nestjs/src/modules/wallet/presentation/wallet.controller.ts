import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from '../application/wallet.service';
import { TopUpDto, CustomTopUpDto, CreatePaymentMethodDto } from './dto/wallet.dto';
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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.walletService.listTransactions(user.id, { page: Number.isNaN(p) ? 1 : p, pageSize: Number.isNaN(ps) ? 20 : ps, type, from, to });
  }

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
  async internalDeduct(@Body() body: { userId: string; amount: number; referenceType?: string; referenceId?: string; description?: string }) {
    if (!body.userId || !body.amount) throw new BadRequestException('userId and amount are required');
    return this.walletService.deductUser(body.userId, Math.abs(Number(body.amount)), TransactionType.NAVIGATION_FEE, body.referenceType ?? 'navigation_session', body.referenceId ?? null, body.description ?? 'Navigation session fee');
  }
}
