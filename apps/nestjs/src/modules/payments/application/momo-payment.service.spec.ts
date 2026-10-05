import {
  BadRequestException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { MomoPaymentService } from './momo-payment.service';
import { PaymentStatus } from '../infrastructure/persistence/payment-order.entity';

describe('MomoPaymentService (MoMo Sandbox Gateway Integration)', () => {
  let service: MomoPaymentService;
  let orderRepo: any;
  let callbackRepo: any;
  let packageRepo: any;
  let walletRepo: any;
  let txRepo: any;
  let dataSource: any;

  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.MOMO_PARTNER_CODE = 'MOMO';
    process.env.MOMO_ACCESS_KEY = 'F8BBA842ECF85';
    process.env.MOMO_SECRET_KEY = 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
    process.env.MOMO_ENDPOINT = 'https://test-payment.momo.vn/v2/gateway/api/create';
    process.env.MOMO_QUERY_ENDPOINT = 'https://test-payment.momo.vn/v2/gateway/api/query';
    process.env.MOMO_REDIRECT_URL = 'http://localhost:3979/wallet';
    process.env.MOMO_IPN_URL = 'http://localhost:3000/api/v1/payments/momo/ipn';
    process.env.MOMO_TIMEOUT_MS = '5000';

    orderRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: any) => ({ id: 'order-uuid-1', ...dto })),
      save: jest.fn(async (o: any) => ({ id: o.id || 'order-uuid-1', createdAt: new Date(), ...o })),
    };

    callbackRepo = {
      create: jest.fn((dto: any) => ({ id: 'cb-1', ...dto })),
      save: jest.fn(async (cb: any) => cb),
    };

    packageRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    walletRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: any) => ({ id: 'wallet-uuid-1', ...dto })),
      save: jest.fn(async (w: any) => w),
      update: jest.fn(),
    };

    txRepo = {
      create: jest.fn((dto: any) => ({ id: 'tx-uuid-1', ...dto })),
      save: jest.fn(async (tx: any) => tx),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(async (callback: (manager: any) => Promise<any>) => {
        const mockManager = {
          findOne: jest.fn((entity: any, _opts: any) => {
            if (entity.name === 'PaymentOrder') {
              return Promise.resolve({
                id: 'order-uuid-1',
                orderCode: 'STM-MOMO-100',
                userId: 'user-1',
                packageId: 1,
                amountVnd: '50000',
                status: PaymentStatus.PENDING,
              });
            }
            if (entity.name === 'Wallet') {
              return Promise.resolve({
                id: 'wallet-uuid-1',
                userId: 'user-1',
                balance: '100',
              });
            }
            return Promise.resolve(null);
          }),
          create: jest.fn((entity: any, data: any) => ({ id: 'created-id', ...data })),
          save: jest.fn(async (data: any) => data),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return callback(mockManager);
      }),
    };

    service = new MomoPaymentService(
      orderRepo,
      callbackRepo,
      packageRepo,
      walletRepo,
      txRepo,
      dataSource,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('sign', () => {
    it('computes HMAC-SHA256 signature with configured secretKey', () => {
      const raw = 'accessKey=F8BBA842ECF85&amount=50000';
      const expected = crypto
        .createHmac('sha256', 'K951B6PE1waDMi640xX08PD3vg6EkVlz')
        .update(raw)
        .digest('hex');

      expect(service.sign(raw)).toBe(expected);
    });
  });

  describe('createPayment', () => {
    it('creates MoMo sandbox payment session for package top-up', async () => {
      const mockPkg = {
        id: 1,
        packageName: 'Starter Pack',
        creditAmount: 50,
        priceVnd: '50000',
        isActive: true,
      };
      packageRepo.findOne.mockResolvedValue(mockPkg);
      walletRepo.findOne.mockResolvedValue({ id: 'wallet-1', userId: 'user-1', balance: '0' });

      const mockMomoResponse = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-100',
        requestId: 'STM-MOMO-100-REQ',
        amount: 50000,
        responseTime: 1728000000000,
        resultCode: 0,
        message: 'Thành công.',
        payUrl: 'https://test-payment.momo.vn/pay?t=abc',
        deeplink: 'momo://app?action=payWithApp&sid=abc',
        qrCodeUrl: 'momo://app?action=payWithApp&isScanQR=true&sid=abc',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMomoResponse,
      } as any);

      const result = await service.createPayment('user-1', { packageId: 1 });

      expect(packageRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          packageId: 1,
          amountVnd: '50000',
          gateway: 'MOMO',
          status: PaymentStatus.PENDING,
        }),
      );
      expect(orderRepo.save).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-payment.momo.vn/v2/gateway/api/create',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result.payUrl).toBe(mockMomoResponse.payUrl);
      expect(result.deeplink).toBe(mockMomoResponse.deeplink);
      expect(result.qrCodeUrl).toBe(mockMomoResponse.qrCodeUrl);
      expect(result.resultCode).toBe(0);
    });

    it('creates MoMo sandbox payment session for custom amount top-up', async () => {
      walletRepo.findOne.mockResolvedValue({ id: 'wallet-1', userId: 'user-1', balance: '0' });
      dataSource.query.mockResolvedValue([{ price: 1000 }]);

      const mockMomoResponse = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-200',
        requestId: 'REQ-200',
        amount: 100000,
        resultCode: 0,
        message: 'Thành công.',
        payUrl: 'https://test-payment.momo.vn/pay?t=xyz',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMomoResponse,
      } as any);

      const result = await service.createPayment('user-1', { customAmount: 100 });

      expect(result.paymentOrder.amountVnd).toBe('100000');
      expect(result.paymentOrder.creditAmount).toBe(100);
      expect(result.payUrl).toBe(mockMomoResponse.payUrl);
    });

    it('throws NotFoundException if top-up package does not exist', async () => {
      packageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createPayment('user-1', { packageId: 999 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if top-up package is inactive', async () => {
      packageRepo.findOne.mockResolvedValue({ id: 2, isActive: false });

      await expect(
        service.createPayment('user-1', { packageId: 2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if neither packageId nor customAmount is provided', async () => {
      await expect(
        service.createPayment('user-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if customAmount is out of range', async () => {
      await expect(
        service.createPayment('user-1', { customAmount: 5 }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPayment('user-1', { customAmount: 20000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadGatewayException if MoMo gateway returns non-zero resultCode', async () => {
      packageRepo.findOne.mockResolvedValue({
        id: 1,
        priceVnd: '50000',
        creditAmount: 50,
        isActive: true,
      });
      walletRepo.findOne.mockResolvedValue({ id: 'wallet-1', userId: 'user-1', balance: '0' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          resultCode: 11007,
          message: 'Invalid signature',
        }),
      } as any);

      await expect(
        service.createPayment('user-1', { packageId: 1 }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('throws BadGatewayException if network request fails', async () => {
      packageRepo.findOne.mockResolvedValue({
        id: 1,
        priceVnd: '50000',
        creditAmount: 50,
        isActive: true,
      });
      walletRepo.findOne.mockResolvedValue({ id: 'wallet-1', userId: 'user-1', balance: '0' });

      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.createPayment('user-1', { packageId: 1 }),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('verifyIpnSignature', () => {
    it('returns true when IPN signature matches HMAC-SHA256 calculation', () => {
      const dto = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-100',
        requestId: 'REQ-100',
        amount: 50000,
        orderInfo: 'SignTrustMap Top-up',
        orderType: 'momo_wallet',
        transId: 12345678,
        resultCode: 0,
        message: 'Thành công.',
        payType: 'qr',
        responseTime: 1728000000000,
        extraData: '',
        signature: '',
      };

      const rawSignature = `accessKey=F8BBA842ECF85&amount=${dto.amount}&extraData=${dto.extraData}&message=${dto.message}&orderId=${dto.orderId}&orderInfo=${dto.orderInfo}&orderType=${dto.orderType}&partnerCode=${dto.partnerCode}&payType=${dto.payType}&requestId=${dto.requestId}&responseTime=${dto.responseTime}&resultCode=${dto.resultCode}&transId=${dto.transId}`;
      dto.signature = crypto
        .createHmac('sha256', 'K951B6PE1waDMi640xX08PD3vg6EkVlz')
        .update(rawSignature)
        .digest('hex');

      expect(service.verifyIpnSignature(dto)).toBe(true);
    });

    it('returns false when signature is invalid', () => {
      const dto = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-100',
        requestId: 'REQ-100',
        amount: 50000,
        orderInfo: 'SignTrustMap Top-up',
        orderType: 'momo_wallet',
        transId: 12345678,
        resultCode: 0,
        message: 'Thành công.',
        payType: 'qr',
        responseTime: 1728000000000,
        signature: 'invalid-signature-hex',
      };

      expect(service.verifyIpnSignature(dto)).toBe(false);
    });
  });

  describe('handleIpn', () => {
    function generateValidIpnDto(overrides: Partial<any> = {}): any {
      const base: any = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-100',
        requestId: 'REQ-100',
        amount: 50000,
        orderInfo: 'SignTrustMap Top-up',
        orderType: 'momo_wallet',
        transId: 998877,
        resultCode: 0,
        message: 'Thành công.',
        payType: 'qr',
        responseTime: 1728000000000,
        extraData: '',
        ...overrides,
      };

      const rawSignature = `accessKey=F8BBA842ECF85&amount=${base.amount}&extraData=${base.extraData}&message=${base.message}&orderId=${base.orderId}&orderInfo=${base.orderInfo}&orderType=${base.orderType}&partnerCode=${base.partnerCode}&payType=${base.payType}&requestId=${base.requestId}&responseTime=${base.responseTime}&resultCode=${base.resultCode}&transId=${base.transId}`;
      base.signature = crypto
        .createHmac('sha256', 'K951B6PE1waDMi640xX08PD3vg6EkVlz')
        .update(rawSignature)
        .digest('hex');

      return base;
    }

    it('throws NotFoundException if payment order does not exist', async () => {
      const dto = generateValidIpnDto();
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.handleIpn(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if signature is invalid and logs callback as invalid', async () => {
      const dto = generateValidIpnDto();
      dto.signature = 'bad-signature';
      orderRepo.findOne.mockResolvedValue({ id: 'order-1', orderCode: dto.orderId });

      await expect(service.handleIpn(dto)).rejects.toThrow(BadRequestException);
      expect(callbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isValid: false }),
      );
    });

    it('marks order as FAILED when MoMo resultCode is non-zero (e.g. user cancelled)', async () => {
      const dto = generateValidIpnDto({ resultCode: 1006, message: 'Người dùng hủy giao dịch' });
      const order = {
        id: 'order-1',
        orderCode: dto.orderId,
        status: PaymentStatus.PENDING,
      };
      orderRepo.findOne.mockResolvedValue(order);

      const result = await service.handleIpn(dto);

      expect(order.status).toBe(PaymentStatus.FAILED);
      expect(orderRepo.save).toHaveBeenCalledWith(order);
      expect(result.resultCode).toBe(0);
      expect(result.message).toContain('FAILED');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('idempotently ignores callback if order is already SUCCESS', async () => {
      const dto = generateValidIpnDto();
      const order = {
        id: 'order-1',
        orderCode: dto.orderId,
        status: PaymentStatus.SUCCESS,
      };
      orderRepo.findOne.mockResolvedValue(order);

      const result = await service.handleIpn(dto);

      expect(result.resultCode).toBe(0);
      expect(result.message).toContain('idempotency');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('atomically credits wallet and updates order to SUCCESS on valid success IPN', async () => {
      const dto = generateValidIpnDto();
      const order = {
        id: 'order-1',
        orderCode: dto.orderId,
        userId: 'user-1',
        packageId: 1,
        status: PaymentStatus.PENDING,
      };
      orderRepo.findOne.mockResolvedValue(order);
      packageRepo.findOne.mockResolvedValue({ id: 1, creditAmount: 50 });

      const result: any = await service.handleIpn(dto);

      expect(result.resultCode).toBe(0);
      expect(result.credited).toBe(true);
      expect(result.creditAmount).toBe(50);
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('queryTransaction', () => {
    it('queries MoMo Sandbox API to check real-time order status', async () => {
      const mockQueryResponse = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-100',
        requestId: 'REQ-100',
        amount: 50000,
        resultCode: 0,
        message: 'Giao dịch thành công.',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockQueryResponse,
      } as any);

      const result = await service.queryTransaction('STM-MOMO-100', 'REQ-100');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-payment.momo.vn/v2/gateway/api/query',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result).toEqual(mockQueryResponse);
    });

    it('throws BadGatewayException if query fails or times out', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        service.queryTransaction('STM-MOMO-100'),
      ).rejects.toThrow(BadGatewayException);
    });
  });
});
