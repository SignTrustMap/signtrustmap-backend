import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { WalletService } from './wallet.service';
import { Wallet } from '../infrastructure/persistence/wallet.entity';
import {
  CreditTransaction,
  TransactionType,
} from '../infrastructure/persistence/credit-transaction.entity';
import { TopupPackage } from '../../payments/infrastructure/persistence/topup-package.entity';
import { PaymentOrder } from '../../payments/infrastructure/persistence/payment-order.entity';
import { PaymentMethod } from '../infrastructure/persistence/payment-method.entity';

describe('WalletService (Phase 1 Ledger & Double-Entry Tests)', () => {
  let service: WalletService;
  let walletRepo: any;
  let txRepo: any;
  let packageRepo: any;
  let orderRepo: any;
  let methodRepo: any;
  let dataSource: any;
  let mockManager: any;

  beforeEach(() => {
    walletRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: any) => ({ id: 'w-1', ...dto }) as Wallet),
      save: jest.fn(async (w: any) => w),
      update: jest.fn().mockResolvedValue({ affected: 1 } as any),
    };

    txRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: any) => ({ id: 'tx-1', createdAt: new Date(), ...dto }) as CreditTransaction),
      save: jest.fn(async (t: any) => ({ id: 'tx-1', createdAt: new Date(), ...t })),
      createQueryBuilder: jest.fn(),
    };

    packageRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: any) => dto as any),
      save: jest.fn(async (dto: any) => dto),
    };

    orderRepo = {
      create: jest.fn((dto: any) => dto as any),
      save: jest.fn(async (dto: any) => dto),
    };

    methodRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto: any) => dto as any),
      save: jest.fn(async (dto: any) => dto),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockManager = {
      findOne: jest.fn(),
      create: jest.fn((entityClass: any, dto: any) => ({ id: 'mock-id', ...dto })),
      save: jest.fn(async (entity: any) => entity),
      update: jest.fn().mockResolvedValue({ affected: 1 } as any),
      query: jest.fn().mockResolvedValue([]),
    };

    dataSource = {
      transaction: jest.fn(async (callback: any) => callback(mockManager)),
      query: jest.fn().mockResolvedValue([]),
    };

    service = new WalletService(
      walletRepo as unknown as Repository<Wallet>,
      txRepo as unknown as Repository<CreditTransaction>,
      packageRepo as unknown as Repository<TopupPackage>,
      orderRepo as unknown as Repository<PaymentOrder>,
      methodRepo as unknown as Repository<PaymentMethod>,
      dataSource as unknown as DataSource,
    );
  });

  describe('ensureWallet and getWallet', () => {
    it('creates a new wallet if user does not have one', async () => {
      walletRepo.findOne.mockResolvedValue(null);
      txRepo.find.mockResolvedValue([]);

      const result = await service.getWallet('user-1');

      expect(walletRepo.create).toHaveBeenCalledWith({ userId: 'user-1', balance: '0', isFrozen: false });
      expect(walletRepo.save).toHaveBeenCalled();
      expect(result.wallet.balance).toBe(0);
      expect(result.wallet.isFrozen).toBe(false);
    });

    it('returns existing wallet balance and recent transactions with ledger metadata', async () => {
      const existingWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '500',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };
      const existingTx: CreditTransaction = {
        id: 'tx-1',
        walletId: 'w-1',
        amount: 50,
        balanceAfter: '500',
        transactionType: TransactionType.SURVEY_REWARD,
        idempotencyKey: 'idemp-1',
        referenceType: 'survey_submission',
        referenceId: 'sub-1',
        metadata: { submissionId: 'sub-1' },
        description: 'Survey reward',
        createdAt: new Date(),
        wallet: existingWallet,
      };

      walletRepo.findOne.mockResolvedValue(existingWallet);
      txRepo.find.mockResolvedValue([existingTx]);

      const result = await service.getWallet('user-1');

      expect(result.wallet.balance).toBe(500);
      expect(result.wallet.isFrozen).toBe(false);
      expect(result.recentTransactions).toHaveLength(1);
      expect(result.recentTransactions[0].balanceAfter).toBe(500);
      expect(result.recentTransactions[0].idempotencyKey).toBe('idemp-1');
    });
  });

  describe('creditUser (Pessimistic Locking & Idempotency)', () => {
    it('credits user atomically with pessimistic lock and records balanceAfter', async () => {
      const existingWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '100',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockImplementation(async (entityClass: any, options: any) => {
        if (entityClass === Wallet) {
          expect(options.lock).toEqual({ mode: 'pessimistic_write' });
          return existingWallet;
        }
        return null;
      });

      const res = await service.creditUser(
        'user-1',
        25,
        TransactionType.SURVEY_REWARD,
        'survey',
        's-1',
        'Survey reward',
        { idempotencyKey: 'key-credit-1' },
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockManager.update).toHaveBeenCalledWith(Wallet, { id: 'w-1' }, { balance: '125' });
      expect(mockManager.create).toHaveBeenCalledWith(
        CreditTransaction,
        expect.objectContaining({
          walletId: 'w-1',
          amount: 25,
          balanceAfter: '125',
          idempotencyKey: 'key-credit-1',
          transactionType: TransactionType.SURVEY_REWARD,
        }),
      );
      expect(res.newBalance).toBe(125);
    });

    it('rejects credit if the target wallet is frozen', async () => {
      const frozenWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '100',
        isFrozen: true,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockImplementation(async (entityClass: any) => {
        if (entityClass === Wallet) return frozenWallet;
        return null;
      });

      await expect(
        service.creditUser('user-1', 25, TransactionType.SURVEY_REWARD, null, null, 'Test credit'),
      ).rejects.toThrow(BadRequestException);
    });

    it('replays existing transaction without duplicating credit when idempotencyKey matches', async () => {
      const existingTx: CreditTransaction = {
        id: 'tx-existing',
        walletId: 'w-1',
        amount: 50,
        balanceAfter: '150',
        transactionType: TransactionType.REVALIDATION_REWARD,
        idempotencyKey: 'duplicate-key-1',
        referenceType: 'revalidation_task',
        referenceId: 'task-1',
        metadata: {},
        description: 'Revalidation reward',
        createdAt: new Date(),
        wallet: {} as any,
      };

      txRepo.findOne.mockResolvedValue(existingTx);
      walletRepo.findOne.mockResolvedValue({ id: 'w-1', balance: '150' } as any);

      const res = await service.creditUser(
        'user-1',
        50,
        TransactionType.REVALIDATION_REWARD,
        'revalidation_task',
        'task-1',
        'Revalidation reward',
        { idempotencyKey: 'duplicate-key-1' },
      );

      expect(res.idempotentReplay).toBe(true);
      expect(res.txId).toBe('tx-existing');
      expect(res.newBalance).toBe(150);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('deductUser (Pessimistic Locking & Overdraft Prevention)', () => {
    it('deducts user atomically with pessimistic lock and records balanceAfter', async () => {
      const existingWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '200',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockImplementation(async (entityClass: any, options: any) => {
        if (entityClass === Wallet) {
          expect(options.lock).toEqual({ mode: 'pessimistic_write' });
          return existingWallet;
        }
        return null;
      });

      const res = await service.deductUser(
        'user-1',
        30,
        TransactionType.NAVIGATION_FEE,
        'navigation_session',
        'nav-1',
        'Trip fee',
        { idempotencyKey: 'key-deduct-1' },
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockManager.update).toHaveBeenCalledWith(Wallet, { id: 'w-1' }, { balance: '170' });
      expect(mockManager.create).toHaveBeenCalledWith(
        CreditTransaction,
        expect.objectContaining({
          walletId: 'w-1',
          amount: -30,
          balanceAfter: '170',
          idempotencyKey: 'key-deduct-1',
          transactionType: TransactionType.NAVIGATION_FEE,
        }),
      );
      expect(res.newBalance).toBe(170);
    });

    it('throws BadRequestException when user has insufficient balance', async () => {
      const existingWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '20',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockImplementation(async (entityClass: any) => {
        if (entityClass === Wallet) return existingWallet;
        return null;
      });

      await expect(
        service.deductUser('user-1', 50, TransactionType.NAVIGATION_FEE, null, null, 'Fee'),
      ).rejects.toThrow('Insufficient balance');
    });

    it('rejects deduction when wallet is frozen', async () => {
      const frozenWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '200',
        isFrozen: true,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockImplementation(async (entityClass: any) => {
        if (entityClass === Wallet) return frozenWallet;
        return null;
      });

      await expect(
        service.deductUser('user-1', 20, TransactionType.NAVIGATION_FEE, null, null, 'Fee'),
      ).rejects.toThrow('Wallet is frozen');
    });
  });

  describe('manualAdjustment (Admin Audit & Strict Non-Negative Check)', () => {
    it('applies positive manual adjustment and logs audit trail', async () => {
      const targetWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '100',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockResolvedValue(targetWallet);

      const res = await service.manualAdjustment(
        'admin-1',
        'w-1',
        {
          amount: 50,
          reason: 'Correction for false rejection appeal',
          referenceType: 'appeal',
          referenceId: 'app-1',
        },
        '127.0.0.1',
      );

      expect(mockManager.update).toHaveBeenCalledWith(Wallet, { id: 'w-1' }, { balance: '150' });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['admin-1', 'w-1']),
      );
      expect(res.oldBalance).toBe(100);
      expect(res.newBalance).toBe(150);
    });

    it('applies negative manual adjustment when balance permits', async () => {
      const targetWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '100',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockResolvedValue(targetWallet);

      const res = await service.manualAdjustment(
        'admin-1',
        'w-1',
        {
          amount: -40,
          reason: 'Duplicate payout correction',
        },
      );

      expect(mockManager.update).toHaveBeenCalledWith(Wallet, { id: 'w-1' }, { balance: '60' });
      expect(res.oldBalance).toBe(100);
      expect(res.newBalance).toBe(60);
    });

    it('prevents adjustment that would cause negative balance', async () => {
      const targetWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '30',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockResolvedValue(targetWallet);

      await expect(
        service.manualAdjustment('admin-1', 'w-1', {
          amount: -50,
          reason: 'Excessive debit',
        }),
      ).rejects.toThrow('Adjustment would result in negative balance');
    });

    it('requires a reason of at least 5 characters', async () => {
      await expect(
        service.manualAdjustment('admin-1', 'w-1', {
          amount: 50,
          reason: 'fix',
        }),
      ).rejects.toThrow('at least 5 characters');
    });

    it('throws NotFoundException if target wallet does not exist', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.manualAdjustment('admin-1', 'w-999', {
          amount: 50,
          reason: 'Valid reason here',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('freezeWallet', () => {
    it('freezes an active wallet and records audit log', async () => {
      const targetWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '100',
        isFrozen: false,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockResolvedValue(targetWallet);

      const res = await service.freezeWallet('admin-1', 'w-1', true, 'Suspicious fraud investigation', '10.0.0.1');

      expect(targetWallet.isFrozen).toBe(true);
      expect(mockManager.save).toHaveBeenCalledWith(targetWallet);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['admin-1', 'w-1']),
      );
      expect(res.isFrozen).toBe(true);
    });

    it('unfreezes a frozen wallet', async () => {
      const targetWallet: Wallet = {
        id: 'w-1',
        userId: 'user-1',
        balance: '100',
        isFrozen: true,
        updatedAt: new Date(),
        user: {} as any,
      };

      mockManager.findOne.mockResolvedValue(targetWallet);

      const res = await service.freezeWallet('admin-1', 'w-1', false, 'Account appeal approved');

      expect(targetWallet.isFrozen).toBe(false);
      expect(res.isFrozen).toBe(false);
    });
  });
});
