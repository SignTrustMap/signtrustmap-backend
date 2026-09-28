import { PaymentsController } from './payments.controller';
import { PaymentsService } from '../application/payments.service';

describe('PaymentsController (Phase 7 Payment Webhook Security & Idempotency)', () => {
  let controller: PaymentsController;
  let service: jest.Mocked<PaymentsService>;

  beforeEach(() => {
    service = {
      listPackages: jest.fn(),
      handleWebhook: jest.fn(),
    } as unknown as jest.Mocked<PaymentsService>;

    controller = new PaymentsController(service);
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
});
