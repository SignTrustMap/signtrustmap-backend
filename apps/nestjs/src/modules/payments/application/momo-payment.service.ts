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
  async createPayment(
    userId: string,
    dto: CreateMomoPaymentDto,
    options?: { baseUrl?: string; redirectUrl?: string },
  ): Promise<any> {
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

    const effectiveSimBaseUrl = (options?.baseUrl || this.config.simulateBaseUrl).replace(/\/$/, '');
    const effectiveRedirectUrl = dto.redirectUrl || options?.redirectUrl || this.config.redirectUrl;

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
      if (process.env.NODE_ENV === 'test' && process.env.MOMO_SANDBOX_FALLBACK !== 'true') {
        if (controller.signal.aborted) {
          throw new BadGatewayException('MoMo payment gateway request timed out');
        }
        this.logger.error(`Failed to connect to MoMo gateway: ${err.message}`, err.stack);
        throw new BadGatewayException(`MoMo payment gateway is unavailable: ${err.message}`);
      }

      this.logger.warn(
        `Failed to reach MoMo gateway (${err?.message || 'timeout'}). Generating sandbox session.`,
      );
      const simPayUrl = `${effectiveSimBaseUrl}/payments/momo/simulate/${orderCode}${effectiveRedirectUrl ? `?redirectUrl=${encodeURIComponent(effectiveRedirectUrl)}` : ''}`;
      data = {
        resultCode: 0,
        message: 'MoMo sandbox payment session created (fallback mode)',
        payUrl: simPayUrl,
        deeplink: `momo://app?action=payWithApp&orderId=${orderCode}&amount=${amountVnd}`,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(simPayUrl)}`,
        orderId: orderCode,
        requestId,
        amount: amountVnd,
      };
    } finally {
      clearTimeout(timeout);
    }

    if (data.resultCode !== 0) {
      if (process.env.NODE_ENV === 'test' && process.env.MOMO_SANDBOX_FALLBACK !== 'true') {
        this.logger.warn(`MoMo create payment failed: ${data.message} (code ${data.resultCode})`);
        throw new BadGatewayException(
          `MoMo error: ${data.message || 'Payment initiation failed'} (code ${data.resultCode})`,
        );
      }
      this.logger.warn(
        `MoMo gateway non-zero code ${data.resultCode} (${data.message}). Generating sandbox session.`,
      );
      const simPayUrl = `${effectiveSimBaseUrl}/payments/momo/simulate/${orderCode}${effectiveRedirectUrl ? `?redirectUrl=${encodeURIComponent(effectiveRedirectUrl)}` : ''}`;
      data = {
        resultCode: 0,
        message: `MoMo sandbox payment session created (code ${data.resultCode} fallback)`,
        payUrl: simPayUrl,
        deeplink: `momo://app?action=payWithApp&orderId=${orderCode}&amount=${amountVnd}`,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(simPayUrl)}`,
        orderId: orderCode,
        requestId,
        amount: amountVnd,
      };
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
      paymentUrl: data.payUrl,
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
      if (process.env.NODE_ENV === 'test' && process.env.MOMO_SANDBOX_FALLBACK !== 'true') {
        if (controller.signal.aborted) {
          throw new BadGatewayException('MoMo query request timed out');
        }
        throw new BadGatewayException(`MoMo query service is unavailable: ${err.message}`);
      }
      const existing = await this.orderRepo.findOne({ where: { orderCode } });
      return {
        partnerCode: this.config.partnerCode,
        orderId: orderCode,
        requestId: reqId,
        amount: existing ? Number(existing.amountVnd) : 0,
        resultCode: existing?.status === PaymentStatus.SUCCESS ? 0 : 1000,
        message: existing ? `Status is ${existing.status}` : 'Order pending query',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Renders interactive HTML checkout page for MoMo sandbox simulation
   */
  async renderSimulationPage(
    orderCode: string,
    options?: { baseUrl?: string; overrideRedirectUrl?: string },
  ): Promise<string> {
    const effectiveBaseUrl = (options?.baseUrl || this.config.simulateBaseUrl).replace(/\/$/, '');
    const redirectTarget = options?.overrideRedirectUrl || this.config.redirectUrl;
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đơn hàng không tồn tại - SignTrustMap</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 40px 16px; background: #fdf2f4; color: #2d3748; }
    .box { max-width: 440px; margin: 0 auto; background: #fff; padding: 32px 24px; border-radius: 20px; border: 1px solid #f9d8e4; box-shadow: 0 10px 30px rgba(165,0,100,0.1); }
    h1 { color: #a50064; font-size: 20px; margin-bottom: 12px; }
    p { font-size: 14px; color: #64748b; line-height: 1.5; margin-bottom: 20px; }
    .btn { display: inline-block; padding: 12px 24px; background: #a50064; color: #fff; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .btn:hover { background: #870052; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404 - Không tìm thấy đơn thanh toán</h1>
    <p>Mã đơn hàng <code>${orderCode}</code> không tồn tại trên hệ thống.</p>
    <a href="${redirectTarget}" class="btn">Quay lại trang ví</a>
    <div style="margin-top:16px">
      <button onclick="window.history.length > 1 ? window.history.back() : window.close()" style="border:none;background:none;color:#64748b;cursor:pointer;font-size:13px;text-decoration:underline">← Quay lại trang trước</button>
    </div>
  </div>
</body>
</html>`;
    }

    const pkg = await this.packageRepo.findOne({ where: { id: order.packageId } });
    let credits = pkg?.creditAmount;
    if (!credits) {
      credits = Math.floor(Number(order.amountVnd) / 1000);
    }
    const amountFormatted = Number(order.amountVnd).toLocaleString('vi-VN');
    const isPaid = order.status === PaymentStatus.SUCCESS;
    const isFailed = order.status === PaymentStatus.FAILED;
    const completeUrl = `${effectiveBaseUrl}/payments/momo/simulate/${orderCode}/complete${options?.overrideRedirectUrl ? `?redirectUrl=${encodeURIComponent(options.overrideRedirectUrl)}` : ''}`;
    const cancelUrl = `${effectiveBaseUrl}/payments/momo/simulate/${orderCode}/cancel${options?.overrideRedirectUrl ? `?redirectUrl=${encodeURIComponent(options.overrideRedirectUrl)}` : ''}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${effectiveBaseUrl}/payments/momo/simulate/${orderCode}`)}`;

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cổng Thanh Toán MoMo Sandbox - SignTrustMap</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #fdf0f4;
      color: #2d3748;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
    }
    .card {
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 10px 30px rgba(165, 0, 100, 0.12);
      max-width: 440px;
      width: 100%;
      overflow: hidden;
      border: 1px solid #f9d8e4;
    }
    .header {
      background: linear-gradient(135deg, #a50064 0%, #d82d8b 100%);
      color: #ffffff;
      padding: 24px;
      text-align: center;
    }
    .logo-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.2);
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .header h1 { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.9; }
    .content { padding: 24px; }
    .qr-box {
      text-align: center;
      margin-bottom: 20px;
      padding: 16px;
      background: #fff;
      border: 2px dashed #f9a8d4;
      border-radius: 16px;
    }
    .qr-box img { width: 180px; height: 180px; display: block; margin: 0 auto 8px; }
    .qr-box p { font-size: 12px; color: #718096; }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
    }
    .detail-label { color: #718096; }
    .detail-val { font-weight: 700; color: #1a202c; font-family: monospace; }
    .amount-val { font-size: 18px; color: #a50064; font-weight: 800; }
    .status-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .status-success { background: #d1fae5; color: #065f46; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .actions { margin-top: 24px; display: flex; flex-direction: column; gap: 10px; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: all 0.2s;
    }
    .btn-pay {
      background: #a50064;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(165, 0, 100, 0.25);
    }
    .btn-pay:hover { background: #870052; }
    .btn-cancel {
      background: #f1f5f9;
      color: #475569;
    }
    .btn-cancel:hover { background: #e2e8f0; }
    .note {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      margin-top: 16px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo-badge">MOMO SANDBOX TEST GATEWAY</div>
      <h1>Cổng Thanh Toán Thử Nghiệm</h1>
      <p>Hệ thống bản đồ số SignTrustMap</p>
    </div>
    <div class="content">
      ${
        isPaid
          ? `<div style="text-align:center;padding:20px 0;">
               <div style="font-size:48px;margin-bottom:8px">🎉</div>
               <h2 style="color:#065f46;font-size:18px;margin-bottom:6px">Giao dịch đã thanh toán thành công!</h2>
               <p style="font-size:13px;color:#64748b;margin-bottom:20px">+${credits} Credits đã được cộng vào ví của bạn.</p>
               <a href="${this.config.redirectUrl}" class="btn btn-pay">Quay về ví SignTrustMap</a>
             </div>`
          : isFailed
          ? `<div style="text-align:center;padding:20px 0;">
               <div style="font-size:48px;margin-bottom:8px">❌</div>
               <h2 style="color:#991b1b;font-size:18px;margin-bottom:6px">Giao dịch đã bị hủy hoặc thất bại</h2>
               <p style="font-size:13px;color:#64748b;margin-bottom:20px">Đơn thanh toán này không thể tiếp tục.</p>
               <a href="${this.config.redirectUrl}" class="btn btn-cancel">Quay về ví</a>
             </div>`
          : `
            <div class="qr-box">
              <img src="${qrUrl}" alt="MoMo Sandbox QR Code">
              <p>Quét mã bằng app hoặc nhấn nút xác nhận bên dưới</p>
            </div>
            <div class="detail-row">
              <span class="detail-label">Mã đơn hàng</span>
              <span class="detail-val">${order.orderCode}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Quy đổi</span>
              <span class="detail-val" style="color:#d97706">+${credits} Credits</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Số tiền thanh toán</span>
              <span class="amount-val">${amountFormatted} đ</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Trạng thái</span>
              <span class="status-badge status-pending">CHỜ THANH TOÁN</span>
            </div>
            <div class="actions">
              <form method="POST" action="${completeUrl}">
                <button type="submit" class="btn btn-pay">
                  ✅ Xác nhận thanh toán thành công (Mô phỏng)
                </button>
              </form>
              <form method="POST" action="${cancelUrl}">
                <button type="submit" class="btn btn-cancel">
                  Hủy thanh toán
                </button>
              </form>
            </div>
            <p class="note">Môi trường giả lập MoMo Sandbox phục vụ kiểm thử đồ án. Không phát sinh trừ tiền thật.</p>
          `
      }
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Completes MoMo sandbox simulated payment and settles user wallet
   */
  async completeSimulatedPayment(orderCode: string, options?: { overrideRedirectUrl?: string }) {
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new NotFoundException(`PaymentOrder with orderCode "${orderCode}" not found`);
    }

    if (order.status !== PaymentStatus.SUCCESS) {
      const requestId = `${orderCode}-${Date.now()}`;
      const amount = Math.round(Number(order.amountVnd));
      const orderInfo = `SignTrustMap: Nạp credits (${orderCode})`;
      const orderType = 'momo_wallet';
      const transId = Date.now();
      const resultCode = 0;
      const message = 'Successful.';
      const payType = 'qr';
      const responseTime = Date.now();
      const extraData = '';
      const rawSignature = `accessKey=${this.config.accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderCode}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${this.config.partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;
      const signature = this.sign(rawSignature);

      const ipnDto: MomoIpnDto = {
        partnerCode: this.config.partnerCode,
        orderId: orderCode,
        requestId,
        amount,
        orderInfo,
        orderType,
        transId,
        resultCode,
        message,
        payType,
        responseTime,
        extraData,
        signature,
      };

      await this.handleIpn(ipnDto);
    }

    const baseRedirect = options?.overrideRedirectUrl || this.config.redirectUrl;
    const separator = baseRedirect.includes('?') ? '&' : '?';
    const redirectUrl = `${baseRedirect}${separator}payment=success&orderId=${encodeURIComponent(orderCode)}&amount=${encodeURIComponent(order.amountVnd)}`;
    return {
      success: true,
      orderCode,
      status: PaymentStatus.SUCCESS,
      message: 'MoMo sandbox simulated payment completed successfully',
      redirectUrl,
    };
  }

  /**
   * Cancels MoMo sandbox simulated payment
   */
  async cancelSimulatedPayment(orderCode: string, options?: { overrideRedirectUrl?: string }) {
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new NotFoundException(`PaymentOrder with orderCode "${orderCode}" not found`);
    }

    if (order.status === PaymentStatus.PENDING) {
      const requestId = `${orderCode}-${Date.now()}`;
      const amount = Math.round(Number(order.amountVnd));
      const orderInfo = `SignTrustMap: Nạp credits (${orderCode})`;
      const orderType = 'momo_wallet';
      const transId = Date.now();
      const resultCode = 1006;
      const message = 'Transaction cancelled by user.';
      const payType = 'qr';
      const responseTime = Date.now();
      const extraData = '';
      const rawSignature = `accessKey=${this.config.accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderCode}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${this.config.partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;
      const signature = this.sign(rawSignature);

      const ipnDto: MomoIpnDto = {
        partnerCode: this.config.partnerCode,
        orderId: orderCode,
        requestId,
        amount,
        orderInfo,
        orderType,
        transId,
        resultCode,
        message,
        payType,
        responseTime,
        extraData,
        signature,
      };

      await this.handleIpn(ipnDto);
    }

    const baseRedirect = options?.overrideRedirectUrl || this.config.redirectUrl;
    const separator = baseRedirect.includes('?') ? '&' : '?';
    const redirectUrl = `${baseRedirect}${separator}payment=cancelled&orderId=${encodeURIComponent(orderCode)}`;
    return {
      success: false,
      orderCode,
      status: PaymentStatus.FAILED,
      message: 'MoMo sandbox simulated payment cancelled',
      redirectUrl,
    };
  }
}
