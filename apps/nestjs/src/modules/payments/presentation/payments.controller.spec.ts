import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from '../application/payments.service';
import { MomoPaymentService } from '../application/momo-payment.service';

describe('PaymentsController (Payment Webhook & MoMo Sandbox Gateway)', () => {
  let controller: PaymentsController;
  let service: jest.Mocked<PaymentsService>;
  let momoService: jest.Mocked<MomoPaymentService>;

  beforeEach(() => {
    service = {
      listPackages: jest.fn(),
      handleWebhook: jest.fn(),
    } as unknown as jest.Mocked<PaymentsService>;

    momoService = {
      createPayment: jest.fn(),
      handleIpn: jest.fn(),
      queryTransaction: jest.fn(),
    } as unknown as jest.Mocked<MomoPaymentService>;

    controller = new PaymentsController(service, momoService);
  });

  it('listPackages delegates to service.listPackages', async () => {
    const expected = [{ id: 1, packageName: 'Starter Pack', creditAmount: 50 }];
    service.listPackages.mockResolvedValue(expected as any);

    const result = await controller.listPackages();

    expect(service.listPackages).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('handleWebhook passes dto and x-webhook-signature to service.handleWebhook', async () => {
    const dto = {
      orderCode: 'ORD-1001',
      status: 'SUCCESS',
    };
    const signature = 'sig-hex-123';
    const expected = { credited: true, status: 'SUCCESS' };
    service.handleWebhook.mockResolvedValue(expected as any);

    const result = await controller.handleWebhook(dto, signature, undefined);

    expect(service.handleWebhook).toHaveBeenCalledWith(dto, 'sig-hex-123');
    expect(result).toBe(expected);
  });

  it('handleWebhook prefers x-webhook-signature over stripe-signature when both present', async () => {
    const dto = {
      orderCode: 'ORD-1001',
      status: 'SUCCESS',
    };
    const expected = { credited: true, status: 'SUCCESS' };
    service.handleWebhook.mockResolvedValue(expected as any);

    const result = await controller.handleWebhook(dto, 'x-sig', 'stripe-sig');

    expect(service.handleWebhook).toHaveBeenCalledWith(dto, 'x-sig');
    expect(result).toBe(expected);
  });

  it('handleWebhook falls back to stripe-signature when x-webhook-signature is absent', async () => {
    const dto = {
      orderCode: 'ORD-1001',
      status: 'SUCCESS',
    };
    const expected = { credited: true, status: 'SUCCESS' };
    service.handleWebhook.mockResolvedValue(expected as any);

    const result = await controller.handleWebhook(dto, undefined, 'stripe-sig');

    expect(service.handleWebhook).toHaveBeenCalledWith(dto, 'stripe-sig');
    expect(result).toBe(expected);
  });

  describe('MoMo Gateway Endpoints', () => {
    const user = { id: 'usr-123', email: 'test@signmap.site' };

    it('createMomoPayment delegates to momoService.createPayment', async () => {
      const dto = { packageId: 1 };
      const expected = {
        payUrl: 'https://test-payment.momo.vn/pay',
        orderId: 'STM-MOMO-100',
      };
      momoService.createPayment.mockResolvedValue(expected as any);

      const result = await controller.createMomoPayment(user, dto);

      expect(momoService.createPayment).toHaveBeenCalledWith(user.id, dto);
      expect(result).toBe(expected);
    });

    it('handleMomoIpn delegates to momoService.handleIpn', async () => {
      const ipnDto = {
        partnerCode: 'MOMO',
        orderId: 'STM-MOMO-100',
        requestId: 'REQ-1',
        amount: 50000,
        orderInfo: 'Nạp credits',
        orderType: 'momo_wallet',
        transId: 999999,
        resultCode: 0,
        message: 'Thành công.',
        payType: 'qr',
        responseTime: 1728000000000,
        signature: 'valid-sig',
      };
      const expected = { resultCode: 0, message: 'Payment settled' };
      momoService.handleIpn.mockResolvedValue(expected as any);

      const result = await controller.handleMomoIpn(ipnDto);

      expect(momoService.handleIpn).toHaveBeenCalledWith(ipnDto);
      expect(result).toBe(expected);
    });

    it('queryMomoTransaction delegates to momoService.queryTransaction', async () => {
      const expected = { resultCode: 0, message: 'Thành công.' };
      momoService.queryTransaction.mockResolvedValue(expected as any);

      const result = await controller.queryMomoTransaction('STM-MOMO-100', 'REQ-1');

      expect(momoService.queryTransaction).toHaveBeenCalledWith('STM-MOMO-100', 'REQ-1');
      expect(result).toBe(expected);
    });

    it('throws ServiceUnavailableException if momoService is not provided', async () => {
      const controllerWithoutMomo = new PaymentsController(service, undefined);

      expect(() =>
        controllerWithoutMomo.createMomoPayment(user, { packageId: 1 }),
      ).toThrow(ServiceUnavailableException);

      expect(() =>
        controllerWithoutMomo.handleMomoIpn({} as any),
      ).toThrow(ServiceUnavailableException);

      expect(() =>
        controllerWithoutMomo.queryMomoTransaction('STM-100'),
      ).toThrow(ServiceUnavailableException);
    });
  });
});
