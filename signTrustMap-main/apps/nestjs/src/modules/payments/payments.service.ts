import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PaymentOrder, PaymentStatus } from '../../entities/payment-order.entity';
import { PaymentCallback } from '../../entities/payment-callback.entity';
import { TopupPackage } from '../../entities/topup-package.entity';
import { Wallet } from '../../entities/wallet.entity';
import { CreditTransaction, TransactionType } from '../../entities/credit-transaction.entity';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentOrder) private orders: Repository<PaymentOrder>,
    @InjectRepository(PaymentCallback) private callbacks: Repository<PaymentCallback>,
    @InjectRepository(TopupPackage) private packages: Repository<TopupPackage>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(CreditTransaction) private txRepo: Repository<CreditTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  // POST /api/v1/payments/webhook  — simulated gateway callback (FR 4.8 / Flow 11)
  // Idempotency: second SUCCESS callback on same orderCode is ignored (no double credit).
  async handleWebhook(dto: PaymentWebhookDto) {
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
    const isSuccess = normalizedStatus === 'SUCCESS';
    const isValid = true; // simulated gateway — treat as valid if order exists; optional signature check can be added later

    // Write callback row (outside tx so it is never rolled back even if later logic fails)
    const cb = this.callbacks.create({ paymentOrderId: order.id, rawPayload, isValid });
    const savedCb = await this.callbacks.save(cb);
    await this.dataSource.query(`UPDATE payment_callbacks SET is_valid=$1, processed_at=now() WHERE id=$2`, [isValid, savedCb.id]);

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
      const fresh = await manager.findOne(PaymentOrder, { where: { id: order.id } });
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
