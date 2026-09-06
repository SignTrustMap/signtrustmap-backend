import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CreditTransaction, TransactionType } from '../infrastructure/persistence/credit-transaction.entity';
import { PaymentMethod } from '../infrastructure/persistence/payment-method.entity';
import { Wallet } from '../infrastructure/persistence/wallet.entity';
import { PaymentOrder, PaymentStatus } from '../../payments/infrastructure/persistence/payment-order.entity';
import { TopupPackage } from '../../payments/infrastructure/persistence/topup-package.entity';
import { TopUpDto, CustomTopUpDto, CreatePaymentMethodDto } from '../presentation/dto/wallet.dto';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(CreditTransaction) private readonly txRepo: Repository<CreditTransaction>,
    @InjectRepository(TopupPackage) private readonly packageRepo: Repository<TopupPackage>,
    @InjectRepository(PaymentOrder) private readonly orderRepo: Repository<PaymentOrder>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureWallet(userId: string): Promise<Wallet> {
    let wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) {
      wallet = this.walletRepo.create({ userId, balance: '0' });
      wallet = await this.walletRepo.save(wallet);
    }
    return wallet;
  }

  async getWallet(userId: string) {
    const wallet = await this.ensureWallet(userId);
    const recentTransactions = await this.txRepo.find({
      where: { walletId: wallet.id },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return {
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        balance: Number(wallet.balance),
        updatedAt: wallet.updatedAt,
      },
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        transactionType: t.transactionType,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        description: t.description,
        createdAt: t.createdAt,
      })),
    };
  }

  async listTransactions(userId: string, q: { page?: number; pageSize?: number; type?: string; from?: string; to?: string }) {
    const wallet = await this.ensureWallet(userId);
    const p = Math.max(1, q.page ?? 1);
    const ps = Math.min(Math.max(1, q.pageSize ?? 20), 100);
    const qb = this.txRepo.createQueryBuilder('t')
      .where('t.walletId = :walletId', { walletId: wallet.id })
      .orderBy('t.createdAt', 'DESC')
      .skip((p - 1) * ps).take(ps);
    if (q.type) qb.andWhere('t.transactionType = :type', { type: q.type });
    if (q.from) qb.andWhere('t.createdAt >= :from', { from: new Date(q.from) });
    if (q.to) qb.andWhere('t.createdAt <= :to', { to: new Date(q.to) });
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async listPackages() {
    return this.packageRepo.find({ where: { isActive: true } as any, order: { creditAmount: 'ASC' } as any });
  }

  async topUp(userId: string, dto: TopUpDto) {
    const pkg = await this.packageRepo.findOne({ where: { id: dto.packageId } });
    if (!pkg) throw new NotFoundException(`Top-up package #${dto.packageId} not found`);
    if (!pkg.isActive) throw new NotFoundException(`Top-up package #${dto.packageId} is inactive`);

    await this.ensureWallet(userId);
    const orderCode = `STM-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const order = this.orderRepo.create({ userId, packageId: pkg.id, orderCode, amountVnd: pkg.priceVnd, gateway: 'MOCK', status: PaymentStatus.PENDING } as any);
    const saved = (await this.orderRepo.save(order as any)) as unknown as PaymentOrder;
    return {
      paymentOrder: {
        id: saved.id, orderCode: saved.orderCode, packageId: saved.packageId,
        packageName: pkg.packageName, amountVnd: saved.amountVnd,
        creditAmount: pkg.creditAmount, gateway: saved.gateway,
        status: saved.status, createdAt: saved.createdAt,
      },
      message: 'Payment order created. Complete via gateway callback.',
    };
  }

  async topUpCustom(userId: string, dto: CustomTopUpDto) {
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 10 || amount > 10000) {
      throw new BadRequestException('amount must be an integer in [10, 10000]');
    }
    await this.ensureWallet(userId);
    // Price rule: 1 credit = 1000 VND (configurable via credit_rules table)
    let pricePerCredit = 1000;
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT reward_amount::int AS price FROM credit_rules WHERE transaction_type='TOP_UP' AND is_active=true LIMIT 1`,
      );
      if (rows.length && Number(rows[0].price)) pricePerCredit = rows[0].price;
    } catch {}
    const amountVnd = String(amount * pricePerCredit);
    // Find or create a matching package row (ad hoc)
    let pkg: TopupPackage | null = null;
    try {
      pkg = await this.packageRepo.findOne({ where: { creditAmount: amount } as any });
      if (!pkg) {
        const created = this.packageRepo.create({
          packageName: `Custom ${amount} credits`, priceVnd: amountVnd, creditAmount: amount, isActive: true,
        } as any);
        pkg = (await this.packageRepo.save(created as any)) as unknown as TopupPackage;
      }
    } catch {
      pkg = { id: -1, packageName: `Custom ${amount}`, priceVnd: amountVnd, creditAmount: amount } as any;
    }
    const orderCode = `STM-CUSTOM-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const order = this.orderRepo.create({
      userId, packageId: (pkg as any).id > 0 ? (pkg as any).id : 1,
      orderCode, amountVnd, gateway: 'MOCK', status: PaymentStatus.PENDING,
    } as any);
    const saved = (await this.orderRepo.save(order as any)) as unknown as PaymentOrder;
    // Override credit amount for custom orders (stored in note / callback payload)
    return {
      paymentOrder: {
        id: saved.id, orderCode: saved.orderCode, packageId: saved.packageId,
        customAmount: amount, amountVnd, gateway: saved.gateway, status: saved.status, createdAt: saved.createdAt,
      },
      message: `Custom order: ${amount} credits for ${amountVnd} VND. Complete via payment gateway.`,
    };
  }

  // ── Saved payment methods ──
  async listPaymentMethods(userId: string) {
    try {
      return await this.methodRepo.find({ where: { userId }, order: { isDefault: 'DESC', createdAt: 'DESC' } as any });
    } catch {
      return [];
    }
  }

  async addPaymentMethod(userId: string, dto: CreatePaymentMethodDto) {
    // Validate last4 and expiry
    if (!/^\d{4}$/.test(dto.cardLast4)) throw new BadRequestException('cardLast4 must be 4 digits');
    const row = this.methodRepo.create({
      userId, cardHolderName: dto.cardHolderName, cardLast4: dto.cardLast4,
      cardBrand: (dto.cardBrand ?? 'VISA').toUpperCase(),
      expiryMonth: dto.expiryMonth, expiryYear: dto.expiryYear,
      isDefault: dto.isDefault ?? false,
    } as any);
    if ((dto.isDefault ?? false) === true) {
      await this.methodRepo.update({ userId } as any, { isDefault: false } as any);
    }
    return this.methodRepo.save(row);
  }

  async removePaymentMethod(userId: string, methodId: string) {
    const m = await this.methodRepo.findOne({ where: { id: methodId } as any });
    if (!m) throw new NotFoundException('PaymentMethod ' + methodId + ' not found');
    if (m.userId !== userId) throw new BadRequestException('PaymentMethod does not belong to you');
    await this.methodRepo.delete({ id: methodId } as any);
    return { deleted: true, id: methodId };
  }

  // ── Internal: credit a user (used by Consensus / Survey / Revalidation) ──
  async creditUser(
    userId: string,
    amount: number,
    type: TransactionType,
    referenceType: string | null,
    referenceId: string | null,
    description: string,
  ): Promise<{ walletId: string; newBalance: number; txId: string }> {
    if (!amount || amount <= 0) {
      // nothing to credit
      const w = await this.ensureWallet(userId);
      return { walletId: w.id, newBalance: Number(w.balance), txId: '' };
    }
    return this.dataSource.transaction(async (manager) => {
      let wallet = await manager.findOne(Wallet, { where: { userId } });
      if (!wallet) {
        wallet = manager.create(Wallet, { userId, balance: '0' } as any);
        wallet = await manager.save(wallet);
      }
      const newBal = BigInt(wallet.balance) + BigInt(amount);
      await manager.update(Wallet, { id: wallet.id }, { balance: newBal.toString() });
      const tx = manager.create(CreditTransaction, {
        walletId: wallet.id,
        amount,
        transactionType: type,
        referenceType,
        referenceId,
        description,
      } as any);
      const savedTx = await manager.save(tx);
      return { walletId: wallet.id, newBalance: Number(newBal), txId: savedTx.id };
    });
  }

  // ── Internal: deduct credits (used by FastAPI navigation sessions) ──
  async deductUser(
    userId: string,
    amount: number,
    type: TransactionType,
    referenceType: string | null,
    referenceId: string | null,
    description: string,
  ): Promise<{ walletId: string; newBalance: number; txId: string }> {
    if (!amount || amount <= 0) throw new BadRequestException('Deduction amount must be positive');
    const pos = Math.abs(amount);
    return this.dataSource.transaction(async (manager) => {
      const wallet = await manager.findOne(Wallet, { where: { userId } });
      if (!wallet) throw new BadRequestException(`No wallet found for user ${userId}`);
      const cur = BigInt(wallet.balance);
      if (cur < BigInt(pos)) throw new BadRequestException('Insufficient balance');
      const newBal = cur - BigInt(pos);
      await manager.update(Wallet, { id: wallet.id }, { balance: newBal.toString() });
      const tx = manager.create(CreditTransaction, {
        walletId: wallet.id,
        amount: -pos,
        transactionType: type,
        referenceType,
        referenceId,
        description,
      } as any);
      const savedTx = await manager.save(tx);
      return { walletId: wallet.id, newBalance: Number(newBal), txId: savedTx.id };
    });
  }

  /** Resolve reward amount for a given transaction type from `credit_rules`. Fallback to defaults. */
  async resolveRewardAmount(type: TransactionType, fallback: number): Promise<number> {
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT reward_amount FROM credit_rules WHERE transaction_type=$1 AND is_active=true LIMIT 1`,
        [type],
      );
      if (rows.length && Number.isFinite(Number(rows[0].reward_amount))) return Number(rows[0].reward_amount);
    } catch {
      // table may not have rows yet
    }
    return fallback;
  }
}
