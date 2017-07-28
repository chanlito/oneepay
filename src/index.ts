import { AxiosError, default as axios } from 'axios';
import * as crypto from 'crypto';

export class OneEpay {
  private apiURL = 'https://api-dev.oneepay.com';
  private accessToken: string;

  constructor(private clientId: string, private clientSecret: string) {}

  async authenticate() {
    const data = `${this.clientId}:${this.clientSecret}`;
    const authentication = crypto.createHash('sha1').update(data).digest('base64');
    try {
      const response = await axios.post(
        `${this.apiURL}/v1/oauth/access-token`,
        {
          client_id: this.clientId,
          permission: 'client_credentials'
        },
        {
          headers: { authentication }
        }
      );

      this.accessToken = response.data.access_token;
    } catch (error) {
      this.handleOneEpayError(error);
    }
  }

  async createTransaction(options: CreateTransactionOptions) {
    try {
      // required
      const order_id = options.UID;
      const total_amt = `${options.totalAmount}`;
      const total_qty = options.totalQuantity;
      const orderName = `Order #${order_id}.`;
      const payment_code = options.paymentCode;
      const payment_options = options.paymentOptions;
      // optional
      const description = options.description || orderName;
      const ip = options.ip || 'Unknown IP';
      const latitude = options.lat || 'Unknown Latitude';
      const longitude = options.lng || 'Unknown Longitude';
      const udid = options.deviceUDID || 'Unknown Device UDID';
      const items = options.items || [
        { name: orderName, qty: options.totalQuantity, unit_price: options.totalAmount }
      ];

      const data = order_id + total_amt + total_qty + ip + this.clientId + this.clientSecret;
      const signature = crypto.createHash('sha1').update(data).digest('base64');

      const response = await axios.post(
        `${this.apiURL}/v1/payments/transactions`,
        {
          order_id,
          description,
          total_amt,
          total_qty,
          currency_code: 'USD',
          signature,
          payment_code,
          payment_options,
          items,
          customer: { ip, latitude, longitude, udid }
        },
        { headers: { 'X-Auth': `Bearer ${this.accessToken}` } }
      );

      return response.data;
    } catch (error) {
      this.handleOneEpayError(error);
    }
  }

  async completeTransaction() {}

  private handleOneEpayError(error: AxiosError) {
    if (!error.response) throw error;

    const { errors, message, reason } = error.response.data;
    if (errors && errors.length) {
      throw new Error(errors[0].message);
    } else if (message && reason) {
      throw new Error(`${message} ${reason}`);
    } else if (message) {
      throw new Error(message);
    } else {
      throw error;
    }
  }
}

export interface CreateTransactionOptions {
  UID: string;
  description?: string;
  totalAmount: string;
  totalQuantity: number;
  paymentCode: PaymentCode;
  paymentOptions: PaymentOptions;
  items?: TransactionItem[];
  ip?: string;
  lat?: string;
  lng?: string;
  deviceUDID?: string;
}

export interface TransactionItem {
  name: string;
  qty: number;
  unit_price: string;
}

export interface PaymentOptions {
  account_type?: string;
  account?: string;
  point_id?: string;
  password?: string;
  wing_account?: string;
  wing_security_code?: string;
}

export enum PaymentCode {
  ABA = 'ABA',
  ACD = 'ACD',
  PNG = 'PNG',
  WIG = 'WIG',
  WIG_VPN = 'WIG_VPN'
}
