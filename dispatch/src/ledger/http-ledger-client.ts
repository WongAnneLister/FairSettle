import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';

import {interpretLedgerResponse} from './checkout';
import {
  LedgerClient,
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
      const name =
        error !== null &&
        typeof error === 'object' &&
        'name' in error &&
        typeof error.name === 'string'
          ? error.name
          : 'Error';
      throw new LedgerRetryableError(name);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LedgerRetryableError('ledger ' + response.status + ' unparsable body');
    }
    return interpretLedgerResponse(response.status, body);
  }
}
