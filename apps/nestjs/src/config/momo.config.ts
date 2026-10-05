export interface MomoConfig {
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  endpoint: string;
  queryEndpoint: string;
  redirectUrl: string;
  ipnUrl: string;
  requestType: string;
  timeoutMs: number;
}

export function getMomoConfig(): MomoConfig {
  return {
    partnerCode: process.env.MOMO_PARTNER_CODE || 'MOMO',
    accessKey: process.env.MOMO_ACCESS_KEY || 'F8BBA842ECF85',
    secretKey: process.env.MOMO_SECRET_KEY || 'K951B6PE1waDMi640xX08PD3vg6EkVlz',
    endpoint:
      process.env.MOMO_ENDPOINT ||
      'https://test-payment.momo.vn/v2/gateway/api/create',
    queryEndpoint:
      process.env.MOMO_QUERY_ENDPOINT ||
      'https://test-payment.momo.vn/v2/gateway/api/query',
    redirectUrl:
      process.env.MOMO_REDIRECT_URL || 'http://localhost:3979/wallet',
    ipnUrl:
      process.env.MOMO_IPN_URL ||
      'http://localhost:3000/api/v1/payments/momo/ipn',
    requestType: process.env.MOMO_REQUEST_TYPE || 'captureWallet',
    timeoutMs: Number(process.env.MOMO_TIMEOUT_MS) || 10000,
  };
}
