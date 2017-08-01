import { AxiosError, default as axios } from 'axios';
import * as crypto from 'crypto';
import * as debug from 'debug';
import * as indicative from 'indicative';

export class OneEpay {
  private accessToken: string;
  private signature: string;

  constructor(private apiURL: string, private clientId: string, private clientSecret: string) {
    if (!apiURL) throw new OneEpayError('Missing OneEpay apiUrl.');
    else if (!clientId) throw new OneEpayError('Missing OneEpay clientId.');
    else if (!clientSecret) throw new OneEpayError('Missing OneEpay clientSecret.');
  }

  async createTransaction(options: CreateTransactionOptions) {
    const log = debug('oneepay:create-transaction');
    log('options', options);

    await this.authenticate();

    if (!this.accessToken) throw new CreateTransactionError('Missing authentication. Did you call authenticate first?');
    await this.validateCreateTransaction(options);

    try {
      // required
      const order_id = options.UID;
      const total_amt = `${options.totalAmount}`;
      const total_qty = options.totalQuantity;
      const orderName = `Order #${order_id}.`;
      const payment_code = options.paymentCode;
      const payment_options = {
        account: options.paymentOptions.account,
        account_type: options.paymentOptions.accountType,
        point_id: options.paymentOptions.paygoId,
        wing_account: options.paymentOptions.wingAccount,
        wing_security_code: options.paymentOptions.wingSecurityCode
      };
      // optional
      const description = options.description || orderName;
      const ip = options.ip || 'Unknown IP';
      const latitude = options.lat || 'Unknown Latitude';
      const longitude = options.lng || 'Unknown Longitude';
      const udid = options.deviceUDID || 'Unknown Device UDID';
      const items = options.items || [
        { name: orderName, qty: 1, unit_price: options.totalAmount }
      ];
      log('items', items);

      this.makeSignature({ UID: order_id, totalAmount: total_amt, totalQuantity: total_qty, ip });

      const response = await axios.post(
        `${this.apiURL}/v1/payments/transactions`,
        {
          order_id,
          description,
          total_amt,
          total_qty,
          currency_code: 'USD',
          signature: this.signature,
          payment_code,
          payment_options,
          items,
          customer: { ip, latitude, longitude, udid }
        },
        { headers: { 'X-Auth': `Bearer ${this.accessToken}` } }
      );
      log('response', response.data);
      const result: CreateTransactionResponse = response.data;

      return result;
    } catch (error) {
      this.handleOneEpayError(error);
    }
  }

  async completeTransaction(options: CompleteTransactionOptions) {
    const log = debug('oneepay:complete-transaction');
    log('options', options);

    await this.authenticate();

    if (!this.accessToken) {
      throw new CompleteTransactionError('Missing authentication. Did you call authenticate first?');
    }

    await this.validateCompleteTransaction(options);

    const { UID, totalAmount, totalQuantity, txid, securityCode } = options;
    const ip = options.ip || 'Unknown IP';

    this.makeSignature({ UID, totalAmount, totalQuantity, ip });

    try {
      const response = await axios.post(
        `${this.apiURL}/v1/payments/transactions/commit`,
        {
          txid,
          signature: this.signature,
          security_code: securityCode,
          ip
        },
        { headers: { 'X-Auth': `Bearer ${this.accessToken}` } }
      );
      log('response', response.data);
      const result: CompleteTransactionResponse = response.data;

      return result;
    } catch (error) {
      this.handleOneEpayError(error);
    }
  }

  private async authenticate(): Promise<void> {
    const log = debug('oneepay:authenticate');
    const data = `${this.clientId}:${this.clientSecret}`;
    log('authentication data', data);
    const authentication = crypto.createHash('sha1').update(data).digest('base64');
    log('authentication', authentication);
    const apiEndpoint = `${this.apiURL}/v1/oauth/access-token`;
    log('api endpoint', apiEndpoint);
    try {
      const response = await axios.post(
        apiEndpoint,
        {
          client_id: this.clientId,
          permission: 'client_credentials'
        },
        {
          headers: { authentication }
        }
      );
      this.accessToken = response.data.access_token;
      log('access token', this.accessToken);
    } catch (error) {
      this.handleOneEpayError(error);
    }
  }

  private makeSignature({ UID, totalAmount, totalQuantity, ip }: MakeSignatureOptions) {
    const data = UID + totalAmount + totalQuantity + ip + this.clientId + this.clientSecret;
    this.signature = crypto.createHash('sha1').update(data).digest('base64');
  }

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

  private async validateCreateTransaction(options: CreateTransactionOptions) {
    if (typeof options !== 'object') throw new CreateTransactionError('Invalid argument type.');
    const rules = {
      UID: 'required|string',
      totalAmount: 'required|string|is_money',
      totalQuantity: 'required|integer',
      paymentCode: 'required|in:ABA,ACD,PNG,WIG,WIG_VPN',
      paymentOptions: 'required|object',
      'paymentOptions.accountType': 'required_when:paymentCode,ACD',
      'paymentOptions.account': 'required_when:paymentCode,ACD',
      'paymentOptions.paygoId': 'required_when:paymentCode,PNG',
      'paymentOptions.wingAccount': 'required_when:paymentCode,WIG_VPN|string',
      'paymentOptions.wingSecurityCode': 'required_when:paymentCode,WIG_VPN|string'
    };
    const messages = {
      required: '{{field}} field is missing.',
      string: '{{field}} must be a string.',
      integer: '{{field}} must be an integer.',
      is_money: '{{field}} contains invalid amount.',
      object: '{{field}} must be an object.',
      required_when: '{{field}} field is missing.',
      'paymentCode.in': '{{field}} must be of value ABA, ACD, PNG, WIG, or WIG_VPN.'
    };
    await indicative.validate(options, rules, messages).catch((errors: any) => {
      throw new CreateTransactionError(errors[0].message);
    });
  }

  private async validateCompleteTransaction(options: CompleteTransactionOptions) {
    if (typeof options !== 'object') throw new CompleteTransactionError('Invalid argument type.');
    const rules = {
      UID: 'required|string',
      totalAmount: 'required|string|is_money',
      totalQuantity: 'required|integer',
      txid: 'required',
      securityCode: 'required'
    };
    const messages = {
      required: '{{field}} field is missing.',
      string: '{{field}} must be a string.',
      integer: '{{field}} must be an integer.',
      is_money: '{{field}} contains invalid amount.'
    };
    await indicative.validate(options, rules, messages).catch((errors: any) => {
      throw new CompleteTransactionError(errors[0].message);
    });
  }
}

const isMoney = function(data: any, field: any, message: string, args: any[], get: Function) {
  return new Promise((resolve, reject) => {
    // get value of field under validation
    const fieldValue: string = get(data, field);
    if (!fieldValue) return resolve('validation skipped' + args);

    const regex = /^[0-9]*\.[0-9]{2}$/;
    return regex.test(fieldValue) ? resolve('validation passed') : reject(message);
  });
};

indicative.extend('isMoney', isMoney, 'The {{field}} field is not valid.');

class CreateTransactionError extends Error {
  constructor(message: string) {
    super();
    this.name = 'CreateTransactionError';
    this.message = message;
  }
}

class CompleteTransactionError extends Error {
  constructor(message: string) {
    super();
    this.name = 'CompleteTransactionError';
    this.message = message;
  }
}

class OneEpayError extends Error {
  constructor(message: string) {
    super();
    this.name = 'OneEpayError';
    this.message = message;
  }
}

export interface CreateTransactionOptions {
  UID: string;
  totalAmount: string;
  totalQuantity: number;
  paymentCode: PaymentCode;
  paymentOptions: PaymentOptions;
  description?: string;
  deviceUDID?: string;
  ip?: string;
  lat?: string;
  lng?: string;
  items?: TransactionItem[];
}

export interface CreateTransactionResponse {
  txid: number;
  state: string;
  expires_in_sec: number;
  uid: string;
  description: string;
  total_qty: 1;
  total_amt: string;
  currency_code: string;
  payment_transaction_id: number;
  payment_code: string;
  instructions: string;
  payment_options: {
    account?: string;
    account_type?: string;
    point_id?: string;
    wing_account?: string;
    wing_security_code?: string;
  };
  customer: {
    ip: string;
    latitude: string;
    longitude: string;
    udid: string;
  };
  items: TransactionItem[];
}

export interface CompleteTransactionOptions {
  UID: string;
  totalAmount: string;
  totalQuantity: number;
  txid: string;
  securityCode: string;
  ip?: string;
}

export interface CompleteTransactionResponse {
  uid: string;
  state: string;
}

export interface MakeSignatureOptions {
  UID: string;
  totalAmount: string;
  totalQuantity: number;
  ip: string;
}

export interface TransactionItem {
  name: string;
  qty: number;
  unit_price: string;
}

export interface PaymentOptions {
  accountType?: string;
  account?: string;
  paygoId?: string;
  wingAccount?: string;
  wingSecurityCode?: string;
}

export enum PaymentCode {
  ABA = 'ABA',
  ACD = 'ACD',
  PNG = 'PNG',
  WIG = 'WIG',
  WIG_VPN = 'WIG_VPN'
}
