import { BadRequestException } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from '../application/wallet.service';
import { TransactionType } from '../infrastructure/persistence/credit-transaction.entity';

describe('WalletController', () => {
  let controller: WalletController;
  let service: {
    getWallet: jest.Mock;
    listTransactions: jest.Mock;
    listPackages: jest.Mock;
    topUp: jest.Mock;
    topUpCustom: jest.Mock;
    listPaymentMethods: jest.Mock;
    addPaymentMethod: jest.Mock;
    removePaymentMethod: jest.Mock;
    deductUser: jest.Mock;
    creditUser: jest.Mock;
  };

  const mockUser = { id: 'u-123', email: 'test@stm.dev' };

  beforeEach(() => {
    service = {
      getWallet: jest.fn(),
      listTransactions: jest.fn(),
      listPackages: jest.fn(),
      topUp: jest.fn(),
      topUpCustom: jest.fn(),
      listPaymentMethods: jest.fn(),
      addPaymentMethod: jest.fn(),
      removePaymentMethod: jest.fn(),
      deductUser: jest.fn(),
      creditUser: jest.fn(),
    };
    controller = new WalletController(service as unknown as WalletService);
  });

  it('getWallet calls service.getWallet', async () => {
    service.getWallet.mockResolvedValue({ userId: mockUser.id, balance: 150 });
    const res = await controller.getWallet(mockUser);
    expect(res).toEqual({ userId: mockUser.id, balance: 150 });
    expect(service.getWallet).toHaveBeenCalledWith(mockUser.id);
  });

  it('listTransactions parses pagination and calls service', async () => {
    service.listTransactions.mockResolvedValue({ items: [], total: 0 });
    const res = await controller.listTransactions(mockUser, '2', '10', 'SURVEY_REWARD', '2026-09-01', '2026-09-30');
    expect(res).toEqual({ items: [], total: 0 });
    expect(service.listTransactions).toHaveBeenCalledWith(mockUser.id, {
      page: 2,
      pageSize: 10,
      type: 'SURVEY_REWARD',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('listPackages calls service.listPackages', async () => {
    service.listPackages.mockResolvedValue([{ id: 1, name: 'Starter' }]);
    const res = await controller.listPackages();
    expect(res).toEqual([{ id: 1, name: 'Starter' }]);
    expect(service.listPackages).toHaveBeenCalled();
  });

  it('topUp calls service.topUp', async () => {
    service.topUp.mockResolvedValue({ orderId: 'ord-1' });
    const res = await controller.topUp(mockUser, { packageId: 1 });
    expect(res).toEqual({ orderId: 'ord-1' });
    expect(service.topUp).toHaveBeenCalledWith(mockUser.id, { packageId: 1 });
  });

  it('topUpCustom calls service.topUpCustom', async () => {
    service.topUpCustom.mockResolvedValue({ orderId: 'ord-2' });
    const res = await controller.topUpCustom(mockUser, { amount: 50000 });
    expect(res).toEqual({ orderId: 'ord-2' });
    expect(service.topUpCustom).toHaveBeenCalledWith(mockUser.id, { amount: 50000 });
  });

  it('listPaymentMethods calls service.listPaymentMethods', async () => {
    service.listPaymentMethods.mockResolvedValue([]);
    const res = await controller.listPaymentMethods(mockUser);
    expect(res).toEqual([]);
    expect(service.listPaymentMethods).toHaveBeenCalledWith(mockUser.id);
  });

  it('addPaymentMethod calls service.addPaymentMethod', async () => {
    service.addPaymentMethod.mockResolvedValue({ id: 'pm-1' });
    const res = await controller.addPaymentMethod(mockUser, {
      provider: 'STRIPE',
      type: 'CARD',
      lastFour: '4242',
      token: 'tok_1',
    } as any);
    expect(res).toEqual({ id: 'pm-1' });
    expect(service.addPaymentMethod).toHaveBeenCalled();
  });

  it('deletePaymentMethod calls service.removePaymentMethod', async () => {
    service.removePaymentMethod.mockResolvedValue({ deleted: true });
    const res = await controller.deletePaymentMethod(mockUser, 'pm-1');
    expect(res).toEqual({ deleted: true });
    expect(service.removePaymentMethod).toHaveBeenCalledWith(mockUser.id, 'pm-1');
  });

  describe('internalDeduct', () => {
    it('throws BadRequestException if userId or amount is missing', async () => {
      await expect(controller.internalDeduct({ userId: '', amount: 10 })).rejects.toThrow(BadRequestException);
      await expect(controller.internalDeduct({ userId: 'u1', amount: 0 })).rejects.toThrow(BadRequestException);
    });

    it('calls service.deductUser with valid params', async () => {
      service.deductUser.mockResolvedValue({ newBalance: 90 });
      const res = await controller.internalDeduct({
        userId: 'u1',
        amount: 10,
        referenceType: 'nav',
        referenceId: 'sess-1',
        description: 'trip fee',
        idempotencyKey: 'idem-1',
      });
      expect(res).toEqual({ newBalance: 90 });
      expect(service.deductUser).toHaveBeenCalledWith(
        'u1',
        10,
        TransactionType.NAVIGATION_FEE,
        'nav',
        'sess-1',
        'trip fee',
        { idempotencyKey: 'idem-1' },
      );
    });
  });

  describe('internalCredit', () => {
    it('throws BadRequestException if userId or amount is missing', async () => {
      await expect(controller.internalCredit({ userId: '', amount: 20 })).rejects.toThrow(BadRequestException);
      await expect(controller.internalCredit({ userId: 'u1', amount: 0 })).rejects.toThrow(BadRequestException);
    });

    it('calls service.creditUser with valid params', async () => {
      service.creditUser.mockResolvedValue({ newBalance: 120 });
      const res = await controller.internalCredit({
        userId: 'u1',
        amount: 20,
        type: TransactionType.SURVEY_REWARD,
        referenceType: 'survey',
        referenceId: 'sub-1',
        description: 'survey payout',
        idempotencyKey: 'idem-2',
      });
      expect(res).toEqual({ newBalance: 120 });
      expect(service.creditUser).toHaveBeenCalledWith(
        'u1',
        20,
        TransactionType.SURVEY_REWARD,
        'survey',
        'sub-1',
        'survey payout',
        { idempotencyKey: 'idem-2' },
      );
    });
  });
});
