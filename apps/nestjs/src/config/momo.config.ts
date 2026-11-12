export interface MomoConfig {
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  endpoint: string;
  queryEndpoint: string;
  redirectUrl: string;
  ipnUrl: string;
  simulateBaseUrl: string;
  requestType: string;
  timeoutMs: number;
}

export function getMomoConfig(): MomoConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const defaultAppUrl = isProd ? 'https://api.signmap.site' : 'http://localhost:3000';
  const appUrl = (process.env.APP_URL || process.env.API_BASE_URL || defaultAppUrl).replace(/\/$/, '');
  const defaultWebUrl = isProd ? 'https://signmap.site' : 'http://localhost:5173';
  const webUrl = (process.env.FRONTEND_URL || process.env.WEB_URL || defaultWebUrl).replace(/\/$/, '');

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
      process.env.MOMO_REDIRECT_URL || `${webUrl}/wallet`,
    ipnUrl:
      process.env.MOMO_IPN_URL ||
      `${appUrl}/api/v1/payments/momo/ipn`,
    simulateBaseUrl:
      process.env.MOMO_SIMULATE_BASE_URL || `${appUrl}/api/v1`,
    requestType: process.env.MOMO_REQUEST_TYPE || 'captureWallet',
    timeoutMs: Number(process.env.MOMO_TIMEOUT_MS) || 4000,
  };
}
