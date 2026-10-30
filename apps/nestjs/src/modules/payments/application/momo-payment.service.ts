import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { getMomoConfig, MomoConfig } from '../../../config/momo.config';
import { PaymentOrder, PaymentStatus } from '../infrastructure/persistence/payment-order.entity';
import { PaymentCallback } from '../infrastructure/persistence/payment-callback.entity';
import { TopupPackage } from '../infrastructure/persistence/topup-package.entity';
import { Wallet } from '../../wallet/infrastructure/persistence/wallet.entity';
import {
  CreditTransaction,
  TransactionType,
} from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { CreditRule } from '../../rewards/infrastructure/persistence/credit-rule.entity';
import { CreateMomoPaymentDto } from '../presentation/dto/create-momo-payment.dto';
import { MomoIpnDto } from '../presentation/dto/momo-ipn.dto';

@Injectable()
export class MomoPaymentService {
  private readonly logger = new Logger(MomoPaymentService.name);
  private readonly config: MomoConfig;

  constructor(
    @InjectRepository(PaymentOrder) private readonly orderRepo: Repository<PaymentOrder>,
    @InjectRepository(PaymentCallback) private readonly callbackRepo: Repository<PaymentCallback>,
    @InjectRepository(TopupPackage) private readonly packageRepo: Repository<TopupPackage>,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(CreditTransaction) private readonly txRepo: Repository<CreditTransaction>,
    private readonly dataSource: DataSource,
    @Optional()
    @InjectRepository(CreditRule)
    private readonly creditRuleRepo?: Repository<CreditRule>,
  ) {
    this.config = getMomoConfig();
  }

  /**
   * Builds HMAC-SHA256 hex signature using MoMo secret key
   */
  sign(rawSignature: string): string {
    return crypto
      .createHmac('sha256', this.config.secretKey)
      .update(rawSignature)
      .digest('hex');
  }

  /**
   * Initiates a payment request with MoMo Sandbox API
   */
  async createPayment(userId: string, dto: CreateMomoPaymentDto): Promise<any> {
    const idempotencyKey = dto.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = await this.orderRepo.findOne({ where: { userId, idempotencyKey } });
      if (existing) return { paymentOrder: existing, idempotentReplay: true };
    }
    let pkg: TopupPackage | null = null;
    let amountVnd = 0;
    let creditAmount = 0;
    let packageName = 'Custom credits';
    let packageId = 1;

    if (dto.packageId) {
      pkg = await this.packageRepo.findOne({ where: { id: dto.packageId } });
      if (!pkg) {
        throw new NotFoundException(`Top-up package #${dto.packageId} not found`);
      }
      if (!pkg.isActive) {
        throw new BadRequestException(`Top-up package #${dto.packageId} is inactive`);
      }
      amountVnd = Math.round(Number(pkg.priceVnd));
      creditAmount = pkg.creditAmount;
      packageName = pkg.packageName;
      packageId = pkg.id;
    } else if (dto.customAmount) {
      const amount = Number(dto.customAmount);
      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 10 || amount > 10000) {
        throw new BadRequestException('customAmount must be an integer between 10 and 10000');
      }
      creditAmount = amount;
      let pricePerCredit = 1000;
      try {
        if (this.creditRuleRepo && typeof this.creditRuleRepo.findOne === 'function') {
          const cRule = await this.creditRuleRepo.findOne({
            where: { transactionType: 'TOP_UP' as any, isActive: true },
          });
          if (cRule && Number(cRule.rewardAmount)) {
            pricePerCredit = cRule.rewardAmount;
          }
        } else {
          const rows: any[] = await this.dataSource.query(
            `SELECT reward_amount::int AS price FROM credit_rules WHERE transaction_type='TOP_UP' AND is_active=true LIMIT 1`,
          );
          if (rows.length && Number(rows[0].price)) {
            pricePerCredit = rows[0].price;
          }
        }
      } catch {}
      amountVnd = amount * pricePerCredit;
      packageName = `Custom ${creditAmount} credits`;

      // Try to find a package with matching credit amount or fallback
      try {
        const existing = await this.packageRepo.findOne({ where: { creditAmount: amount } as any });
        if (existing) {
          packageId = existing.id;
        }
      } catch {}
    } else {
      throw new BadRequestException('Either packageId or customAmount must be provided');
    }

    // Ensure wallet exists for user
    let wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) {
      wallet = this.walletRepo.create({ userId, balance: '0', isFrozen: false });
      await this.walletRepo.save(wallet);
    }

    const orderCode = `STM-MOMO-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // Create pending payment order
    const order = this.orderRepo.create({
      userId,
      packageId,
      orderCode,
      amountVnd: String(amountVnd),
      gateway: 'MOMO',
      status: PaymentStatus.PENDING,
      idempotencyKey: idempotencyKey || null,
    });
    let savedOrder: PaymentOrder;
    try {
      savedOrder = await this.orderRepo.save(order);
    } catch (error: any) {
      if (error?.code !== '23505' || !idempotencyKey) throw error;
      const existing = await this.orderRepo.findOne({
        where: { userId, idempotencyKey },
      });
      if (!existing) throw error;
      return {
        paymentOrder: {
          id: existing.id,
          orderCode: existing.orderCode,
          packageId: existing.packageId,
          packageName,
          amountVnd: existing.amountVnd,
          creditAmount,
          gateway: existing.gateway,
          status: existing.status,
          createdAt: existing.createdAt,
        },
        idempotentReplay: true,
      };
    }

    const requestId = `${orderCode}-${Date.now()}`;
    const orderId = orderCode;
    const orderInfo = `SignTrustMap: Nạp ${creditAmount} credits (${orderCode})`;
    const redirectUrl = dto.redirectUrl || this.config.redirectUrl;
    const ipnUrl = this.config.ipnUrl;
    const extraData =
      dto.extraData ??
      Buffer.from(
        JSON.stringify({ userId, packageId, creditAmount, orderCode }),
      ).toString('base64');
    const requestType = this.config.requestType;

    const rawSignature = `accessKey=${this.config.accessKey}&amount=${amountVnd}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${this.config.partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    const signature = this.sign(rawSignature);

    const requestBody = {
      partnerCode: this.config.partnerCode,
      accessKey: this.config.accessKey,
      requestId,
      amount: amountVnd,
      orderId,
      orderInfo,
      redirectUrl,
      ipnUrl,
      extraData,
      requestType,
      signature,
      lang: 'vi',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let data: any;
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      data = await response.json();
    } catch (err: any) {
      if (controller.signal.aborted) {
        throw new BadGatewayException('MoMo payment gateway request timed out');
      }
      this.logger.error(`Failed to connect to MoMo gateway: ${err.message}`, err.stack);
      throw new BadGatewayException(`MoMo payment gateway is unavailable: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (data.resultCode !== 0) {
      this.logger.warn(`MoMo create payment failed: ${data.message} (code ${data.resultCode})`);
      throw new BadGatewayException(
        `MoMo error: ${data.message || 'Payment initiation failed'} (code ${data.resultCode})`,
      );
    }

    return {
      paymentOrder: {
        id: savedOrder.id,
        orderCode: savedOrder.orderCode,
        packageId: savedOrder.packageId,
        packageName,
        amountVnd: savedOrder.amountVnd,
        creditAmount,
        gateway: savedOrder.gateway,
        status: savedOrder.status,
        createdAt: savedOrder.createdAt,
      },
      payUrl: data.payUrl,
      deeplink: data.deeplink,
      qrCodeUrl: data.qrCodeUrl,
      deeplinkMiniApp: data.deeplinkMiniApp,
      orderId: data.orderId,
      requestId: data.requestId,
      amount: data.amount,
      resultCode: data.resultCode,
      message: data.message,
    };
  }

  /**
   * Verifies MoMo IPN signature
   */
  verifyIpnSignature(dto: MomoIpnDto): boolean {
    const rawSignature = `accessKey=${this.config.accessKey}&amount=${dto.amount}&extraData=${dto.extraData ?? ''}&message=${dto.message}&orderId=${dto.orderId}&orderInfo=${dto.orderInfo}&orderType=${dto.orderType}&partnerCode=${dto.partnerCode}&payType=${dto.payType}&requestId=${dto.requestId}&responseTime=${dto.responseTime}&resultCode=${dto.resultCode}&transId=${dto.transId}`;
    const expected = this.sign(rawSignature);

    if (!dto.signature || expected.length !== dto.signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf-8'),
      Buffer.from(dto.signature, 'utf-8'),
    );
  }

  /**
   * Processes MoMo IPN callback
   */
  async handleIpn(dto: MomoIpnDto) {
    const isValid = this.verifyIpnSignature(dto);

    const order = await this.orderRepo.findOne({ where: { orderCode: dto.orderId } });
    if (!order) {
      this.logger.warn(`MoMo IPN callback received for non-existent order ${dto.orderId}`);
      throw new NotFoundException(`PaymentOrder with orderCode "${dto.orderId}" not found`);
    }

    // Always log callback for audit
    const cb = this.callbackRepo.create({
      paymentOrderId: order.id,
      rawPayload: dto as any,
      isValid,
    });
    const savedCb = await this.callbackRepo.save(cb);
    if (this.callbackRepo?.update) {
      try {
        await this.callbackRepo.update(savedCb.id, { isValid, processedAt: new Date() });
      } catch {
        await this.dataSource.query(
          `UPDATE payment_callbacks SET is_valid=$1, processed_at=now() WHERE id=$2`,
          [isValid, savedCb.id],
        );
      }
    } else {
      await this.dataSource.query(
        `UPDATE payment_callbacks SET is_valid=$1, processed_at=now() WHERE id=$2`,
        [isValid, savedCb.id],
      );
    }

    if (!isValid) {
      this.logger.warn(`Invalid signature in MoMo IPN callback for order ${dto.orderId}`);
      throw new BadRequestException('Invalid MoMo IPN signature');
    }

    // Handle failure / cancellation
    if (dto.resultCode !== 0) {
      order.status = PaymentStatus.FAILED;
      await this.orderRepo.save(order);
      return {
        resultCode: 0,
        message: `Order marked as FAILED (MoMo resultCode: ${dto.resultCode})`,
      };
    }

    // Idempotency check: if order is already SUCCESS, skip crediting
    if (order.status === PaymentStatus.SUCCESS) {
      return {
        resultCode: 0,
        message: 'Order already settled (idempotency guard)',
      };
    }

    // Determine credits to add
    const pkg = await this.packageRepo.findOne({ where: { id: order.packageId } });
    let creditToAdd = pkg?.creditAmount;
    if (!creditToAdd) {
      creditToAdd = Math.floor(Number(order.amountVnd) / 1000);
    }

    // Transactional settlement
    return this.dataSource.transaction(async (manager) => {
      const freshOrder = await manager.findOne(PaymentOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!freshOrder) {
        throw new NotFoundException('PaymentOrder disappeared');
      }
      if (freshOrder.status === PaymentStatus.SUCCESS) {
        return {
          resultCode: 0,
          message: 'Already settled inside transaction (idempotency guard)',
        };
      }

      freshOrder.status = PaymentStatus.SUCCESS;
      await manager.save(freshOrder);

      let wallet = await manager.findOne(Wallet, { where: { userId: freshOrder.userId } });
      if (!wallet) {
        wallet = manager.create(Wallet, { userId: freshOrder.userId, balance: '0' });
        wallet = await manager.save(wallet);
      }

      const newBal = BigInt(wallet.balance) + BigInt(creditToAdd);
      await manager.update(Wallet, { id: wallet.id }, { balance: newBal.toString() });

      const tx = manager.create(CreditTransaction, {
        walletId: wallet.id,
        amount: creditToAdd,
        transactionType: TransactionType.TOP_UP,
        referenceType: 'payment_order',
        referenceId: freshOrder.id,
        idempotencyKey: `payment:${freshOrder.id}`,
        description: `Top-up via MoMo (${freshOrder.orderCode}, transId: ${dto.transId})`,
      });
      await manager.save(tx);

      return {
        resultCode: 0,
        message: 'Payment settled and wallet credited successfully',
        orderId: freshOrder.orderCode,
        credited: true,
        creditAmount: creditToAdd,
      };
    });
  }

  /**
   * Queries real-time transaction status from MoMo Sandbox API
   */
  async queryTransaction(orderCode: string, requestId?: string) {
    const reqId = requestId || `${orderCode}-query-${Date.now()}`;
    const rawSignature = `accessKey=${this.config.accessKey}&orderId=${orderCode}&partnerCode=${this.config.partnerCode}&requestId=${reqId}`;
    const signature = this.sign(rawSignature);

    const requestBody = {
      partnerCode: this.config.partnerCode,
      requestId: reqId,
      orderId: orderCode,
      signature,
      lang: 'vi',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.queryEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      return await response.json();
    } catch (err: any) {
      if (controller.signal.aborted) {
        throw new BadGatewayException('MoMo query request timed out');
      }
      throw new BadGatewayException(`MoMo query service is unavailable: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
