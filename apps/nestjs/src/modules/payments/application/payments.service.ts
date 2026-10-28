import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { PaymentOrder, PaymentStatus } from '../infrastructure/persistence/payment-order.entity';
import { PaymentCallback } from '../infrastructure/persistence/payment-callback.entity';
import { TopupPackage } from '../infrastructure/persistence/topup-package.entity';
import { Wallet } from '../../wallet/infrastructure/persistence/wallet.entity';
import {
  CreditTransaction,
  TransactionType,
} from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { PaymentWebhookDto } from '../presentation/dto/payment-webhook.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentOrder) private orders: Repository<PaymentOrder>,
    @InjectRepository(PaymentCallback) private callbacks: Repository<PaymentCallback>,
    @InjectRepository(TopupPackage) private packages: Repository<TopupPackage>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(CreditTransaction) private txRepo: Repository<CreditTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves active credit top-up packages
   */
  async listPackages() {
    return this.packages.find({
      where: { isActive: true },
      order: { id: 'ASC' },
    });
  }

  /**
   * Validates HMAC-SHA256 webhook signature against configured secret
   */
  verifyWebhookSignature(dto: PaymentWebhookDto, signature?: string): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!secret && !signature) {
      return true;
    }

    if (!signature) {
      if (secret) {
        throw new UnauthorizedException('Missing webhook signature');
      }
      return true;
    }

    const secretKey = secret || 'signtrustmap-webhook-secret';
    const cleanSig = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    const payloadStr = JSON.stringify(dto);
    const expectedPayloadSig = crypto
      .createHmac('sha256', secretKey)
      .update(payloadStr)
      .digest('hex');

    const expectedOrderCodeSig = crypto
      .createHmac('sha256', secretKey)
      .update(dto.orderCode)
      .digest('hex');

    const matchesPayload = this.safeCompare(cleanSig, expectedPayloadSig);
    const matchesOrderCode = this.safeCompare(cleanSig, expectedOrderCodeSig);

    if (!matchesPayload && !matchesOrderCode) {
      this.logger.warn(`Invalid webhook signature for order ${dto.orderCode}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
  }

  // POST /api/v1/payments/webhook — simulated gateway callback (FR 4.8 / Flow 11)
  // Idempotency: second SUCCESS callback on same orderCode is ignored (no double credit).
  async handleWebhook(dto: PaymentWebhookDto, signature?: string) {
    this.verifyWebhookSignature(dto, signature);

    const order = await this.orders.findOne({ where: { orderCode: dto.orderCode } });
    if (!order) throw new NotFoundException(`PaymentOrder with orderCode "${dto.orderCode}" not found`);

    const rawPayload: any = dto.rawPayload ?? {
      orderCode: dto.orderCode,
      gateway: dto.gateway ?? order.gateway,
      status: dto.status,
      amountVnd: dto.amountVnd ?? order.amountVnd,
    };

    const pkg = await this.packages.findOne({ where: { id: order.packageId } });
    if (!pkg) throw new NotFoundException(`Top-up package #${order.packageId} not found`);

    // Always record the callback row first (audit)
    const normalizedStatus = dto.status.toUpperCase();
    const isValid = true; // simulated gateway — treat as valid if order exists; optional signature check can be added later

    // Write callback row (outside tx so it is never rolled back even if later logic fails)
    const cb = this.callbacks.create({ paymentOrderId: order.id, rawPayload, isValid });
    const savedCb = await this.callbacks.save(cb);
    if (this.callbacks?.update) {
      try {
        await this.callbacks.update(savedCb.id, { isValid, processedAt: new Date() });
      } catch {
        await this.dataSource.query(`UPDATE payment_callbacks SET is_valid=$1, processed_at=now() WHERE id=$2`, [isValid, savedCb.id]);
      }
    } else {
      await this.dataSource.query(`UPDATE payment_callbacks SET is_valid=$1, processed_at=now() WHERE id=$2`, [isValid, savedCb.id]);
    }

    if (!isValid) throw new BadRequestException('Invalid payment callback');

    if (normalizedStatus === 'FAILED' || normalizedStatus === 'EXPIRED') {
      const map: Record<string, PaymentStatus> = { FAILED: PaymentStatus.FAILED, EXPIRED: PaymentStatus.EXPIRED };
      order.status = map[normalizedStatus];
      await this.orders.save(order);
      return { callbackId: savedCb.id, orderId: order.id, orderCode: order.orderCode, status: order.status, message: `Order marked ${order.status}` };
    }

    if (normalizedStatus !== 'SUCCESS')
      throw new BadRequestException(`Unsupported status "${dto.status}"; expected SUCCESS|FAILED|EXPIRED`);

    // SUCCESS — if already SUCCESS, idempotency guard: do not double-credit
    if (order.status === PaymentStatus.SUCCESS) {
      return { callbackId: savedCb.id, orderId: order.id, orderCode: order.orderCode, status: PaymentStatus.SUCCESS, credited: false, message: 'Order already settled — callback ignored (idempotency)' };
    }

    // Atomic: set order SUCCESS, credit wallet, insert credit transaction
    return this.dataSource.transaction(async (manager) => {
      const fresh = await manager.findOne(PaymentOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!fresh) throw new NotFoundException('PaymentOrder disappeared');
      if (fresh.status === PaymentStatus.SUCCESS) {
        return { callbackId: savedCb.id, orderId: fresh.id, orderCode: fresh.orderCode, status: PaymentStatus.SUCCESS, credited: false, message: 'Already settled inside transaction — no double credit' };
      }
      fresh.status = PaymentStatus.SUCCESS;
      await manager.save(fresh);

      let wallet = await manager.findOne(Wallet, { where: { userId: fresh.userId } });
      if (!wallet) {
        wallet = manager.create(Wallet, { userId: fresh.userId, balance: '0' });
        wallet = await manager.save(wallet);
      }
      const newBal = BigInt(wallet.balance) + BigInt(pkg.creditAmount);
      await manager.update(Wallet, { id: wallet.id }, { balance: newBal.toString() });

      const tx = manager.create(CreditTransaction, {
        walletId: wallet.id, amount: pkg.creditAmount, transactionType: TransactionType.TOP_UP,
        idempotencyKey: `payment:${fresh.id}`,
        referenceType: 'payment_order', referenceId: fresh.id,
        description: `Top-up ${pkg.packageName} via ${fresh.gateway} (${fresh.orderCode})`,
      });
      const savedTx = await manager.save(tx);
      const updated = await manager.findOne(Wallet, { where: { id: wallet.id } });
      return {
        callbackId: savedCb.id, orderId: fresh.id, orderCode: fresh.orderCode,
        status: PaymentStatus.SUCCESS, credited: true,
        creditAmount: pkg.creditAmount, walletBalance: Number(updated!.balance),
        transaction: { id: savedTx.id, amount: savedTx.amount, type: savedTx.transactionType },
      };
    });
  }
}
