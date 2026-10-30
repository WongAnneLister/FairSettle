import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';

import {interpretLedgerResponse} from './checkout';
import {
  LEDGER_PAYMENT_ID,
  LedgerClient,
  LedgerPaymentRead,
  LedgerPaymentOutcome,
  LedgerPaymentRequest,
  LedgerRetryableError,
} from './ledger-client';

@Injectable()
export class HttpLedgerClient implements LedgerClient {
  constructor(private readonly config: ConfigService) {}

  async createPayment(
    request: LedgerPaymentRequest,
    idempotencyKey: string,
  ): Promise<LedgerPaymentOutcome> {
    let response: Response;
    try {
      response = await fetch(this.config.get<string>('LEDGER_BASE_URL') + '/v1/payments', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.config.get<string>('LEDGER_APP_TOKEN'),
          'Idempotency-Key': idempotencyKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.get<number>('LEDGER_TIMEOUT_MS', 10000)),
      });
    } catch (error) {
      throw this.transportError(error);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LedgerRetryableError('ledger ' + response.status + ' unparsable body');
    }
    return interpretLedgerResponse(response.status, body);
  }

  async readPayment(paymentId: string): Promise<LedgerPaymentRead> {
    if (!LEDGER_PAYMENT_ID.test(paymentId)) {
      return {kind: 'rejected', status: 0, code: 'INVALID_PAYMENT_ID'};
    }
    let response: Response;
    try {
      response = await fetch(
        this.config.get<string>('LEDGER_BASE_URL') + '/v1/payments/' + paymentId,
        {
          method: 'GET',
          headers: {Authorization: 'Bearer ' + this.config.get<string>('LEDGER_APP_TOKEN')},
          signal: AbortSignal.timeout(this.config.get<number>('LEDGER_TIMEOUT_MS', 10000)),
        },
      );
    } catch (error) {
      throw this.transportError(error);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LedgerRetryableError('ledger ' + response.status + ' unparsable body');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new LedgerRetryableError('ledger ' + response.status + ' unparsable body');
    }
    const resource = body as Record<string, unknown>;
    if (response.status === 200) {
      if (typeof resource.paymentStatus !== 'string' || !resource.paymentStatus) {
        throw new LedgerRetryableError('ledger 200 unparsable body');
      }
      return {kind: 'read', paymentStatus: resource.paymentStatus};
    }
    const code = typeof resource.code === 'string' ? resource.code : 'UNKNOWN';
    if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
      return {kind: 'rejected', status: response.status, code};
    }
    throw new LedgerRetryableError('ledger ' + response.status + ' ' + code);
  }

  private transportError(error: unknown): LedgerRetryableError {
    const name =
      error !== null &&
      typeof error === 'object' &&
      'name' in error &&
      typeof error.name === 'string'
        ? error.name
        : 'Error';
    return new LedgerRetryableError(name);
  }
}
