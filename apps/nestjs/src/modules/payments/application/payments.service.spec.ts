import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from '../infrastructure/persistence/payment-order.entity';

describe('PaymentsService (Phase 7 Payment Webhook Security & Idempotency)', () => {
  let service: PaymentsService;
  let ordersRepo: any;
  let callbacksRepo: any;
  let packagesRepo: any;
  let walletsRepo: any;
  let txRepo: any;
  let dataSource: any;

  const mockSecret = 'test-payment-webhook-secret';

  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = mockSecret;

    ordersRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (o: any) => o),
    };

    callbacksRepo = {
      create: jest.fn((dto: any) => ({ id: 'cb-1', ...dto })),
      save: jest.fn(async (cb: any) => cb),
    };

    packagesRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    walletsRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (w: any) => w),
      update: jest.fn(),
    };

    txRepo = {
      create: jest.fn((dto: any) => ({ id: 'tx-topup-1', ...dto })),
      save: jest.fn(async (tx: any) => tx),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(async (cb: (manager: any) => Promise<any>) => {
        const mockManager = {
          findOne: jest.fn((entity: any, _opts: any) => {
            if (entity.name === 'PaymentOrder') {
              return Promise.resolve({
                id: 'order-1',
                orderCode: 'ORD-1001',
                userId: 'user-1',
                packageId: 1,
                gateway: 'MOMO',
                amountVnd: '50000',
                status: PaymentStatus.PENDING,
              });
            }
            if (entity.name === 'Wallet') {
              return Promise.resolve({
                id: 'wallet-1',
                userId: 'user-1',
                balance: '100',
              });
            }
            return Promise.resolve(null);
          }),
          create: jest.fn((entity: any, data: any) => ({ id: 'mock-id', ...data })),
          save: jest.fn(async (data: any) => data),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return cb(mockManager);
      }),
    };

    service = new PaymentsService(
      ordersRepo,
      callbacksRepo,
      packagesRepo,
      walletsRepo,
      txRepo,
      dataSource,
    );
  });

  afterEach(() => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  });

  describe('listPackages', () => {
    it('returns active top-up packages ordered by id ascending', async () => {
      const mockPackages = [
        { id: 1, packageName: 'Starter Pack', creditAmount: 50, priceVnd: '50000', isActive: true },
        { id: 2, packageName: 'Pro Pack', creditAmount: 120, priceVnd: '100000', isActive: true },
      ];
      packagesRepo.find.mockResolvedValue(mockPackages);

      const result = await service.listPackages();

      expect(packagesRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { id: 'ASC' },
      });
      expect(result).toEqual(mockPackages);
    });
  });

  describe('verifyWebhookSignature', () => {
    const validDto = {
      orderCode: 'ORD-1001',
      gateway: 'MOMO',
      status: 'SUCCESS',
      amountVnd: '50000',
    };

    it('successfully validates signature computed with HMAC-SHA256 on payload JSON', () => {
      const sig = crypto
        .createHmac('sha256', mockSecret)
        .update(JSON.stringify(validDto))
        .digest('hex');

      expect(service.verifyWebhookSignature(validDto, sig)).toBe(true);
    });

    it('successfully validates signature computed on orderCode', () => {
      const sig = crypto
        .createHmac('sha256', mockSecret)
        .update(validDto.orderCode)
        .digest('hex');

      expect(service.verifyWebhookSignature(validDto, sig)).toBe(true);
    });

    it('throws UnauthorizedException when signature does not match', () => {
      expect(() => service.verifyWebhookSignature(validDto, 'invalid-signature')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when signature is missing but secret is configured', () => {
      expect(() => service.verifyWebhookSignature(validDto, undefined)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('handleWebhook', () => {
    const dto = {
      orderCode: 'ORD-1001',
      gateway: 'MOMO',
      status: 'SUCCESS',
      amountVnd: '50000',
    };

    it('throws NotFoundException if payment order does not exist', async () => {
      const sig = crypto
        .createHmac('sha256', mockSecret)
        .update(JSON.stringify(dto))
        .digest('hex');

      ordersRepo.findOne.mockResolvedValue(null);

      await expect(service.handleWebhook(dto, sig)).rejects.toThrow(NotFoundException);
    });

    it('idempotently ignores second SUCCESS callback on already settled order', async () => {
      const sig = crypto
        .createHmac('sha256', mockSecret)
        .update(JSON.stringify(dto))
        .digest('hex');

      const settledOrder = {
        id: 'order-1',
        orderCode: 'ORD-1001',
        userId: 'user-1',
        packageId: 1,
        gateway: 'MOMO',
        amountVnd: '50000',
        status: PaymentStatus.SUCCESS,
      };
      ordersRepo.findOne.mockResolvedValue(settledOrder);
      packagesRepo.findOne.mockResolvedValue({ id: 1, creditAmount: 50, packageName: 'Starter' });

      const result: any = await service.handleWebhook(dto, sig);

      expect(result.credited).toBe(false);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.message).toContain('idempotency');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('atomically marks order SUCCESS and credits user wallet on valid SUCCESS callback', async () => {
      const sig = crypto
        .createHmac('sha256', mockSecret)
        .update(JSON.stringify(dto))
        .digest('hex');

      const pendingOrder = {
        id: 'order-1',
        orderCode: 'ORD-1001',
        userId: 'user-1',
        packageId: 1,
        gateway: 'MOMO',
        amountVnd: '50000',
        status: PaymentStatus.PENDING,
      };
      ordersRepo.findOne.mockResolvedValue(pendingOrder);
      packagesRepo.findOne.mockResolvedValue({ id: 1, creditAmount: 50, packageName: 'Starter' });

      const result: any = await service.handleWebhook(dto, sig);

      expect(result.credited).toBe(true);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.creditAmount).toBe(50);
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });
});
