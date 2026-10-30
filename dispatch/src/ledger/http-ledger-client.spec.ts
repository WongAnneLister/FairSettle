import {ConfigService} from '@nestjs/config';

import {HttpLedgerClient} from './http-ledger-client';
import {LedgerRetryableError} from './ledger-client';
import {paymentRequestFor} from './checkout';

it('http client sends key, token and body; maps transport errors', async () => {
  const client = new HttpLedgerClient(
    new ConfigService({
      LEDGER_BASE_URL: 'http://127.0.0.1:9999',
      LEDGER_APP_TOKEN: 'app_x',
      LEDGER_TIMEOUT_MS: 300,
    }),
  );
  const body = paymentRequestFor(42, 1875, {
    successUrl: 'https://example.com/return',
    cancelUrl: 'https://example.com/cancel',
  });
  const fetchMock = jest.spyOn(global, 'fetch');
  try {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'pay_X',
          nextAction: {type: 'REDIRECT_TO_HOSTED_CHECKOUT', hostedUrl: 'https://example.com/pay'},
        }),
        {status: 201},
      ),
    );
    await expect(client.createPayment(body, 'dispatch-order-42')).resolves.toEqual({
      kind: 'accepted',
      paymentId: 'pay_X',
      checkoutUrl: 'https://example.com/pay',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9999/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer app_x',
        'Idempotency-Key': 'dispatch-order-42',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: expect.any(AbortSignal),
    });
    fetchMock.mockRejectedValueOnce(new DOMException('Bearer app_x must not leak', 'TimeoutError'));
    await expect(client.createPayment(body, 'dispatch-order-42')).rejects.toEqual(
      new LedgerRetryableError('TimeoutError'),
    );
    fetchMock.mockResolvedValueOnce(new Response('Bearer app_x is not JSON', {status: 502}));
    await expect(client.createPayment(body, 'dispatch-order-42')).rejects.toEqual(
      new LedgerRetryableError('ledger 502 unparsable body'),
    );
  } finally {
    fetchMock.mockRestore();
  }
});

it('readPayment reads one payment and maps answers', async () => {
  const client = new HttpLedgerClient(
    new ConfigService({
      LEDGER_BASE_URL: 'http://127.0.0.1:9999',
      LEDGER_APP_TOKEN: 'app_x',
      LEDGER_TIMEOUT_MS: 300,
    }),
  );
  const id = 'pay_' + '0'.repeat(25) + '1';
  const fetchMock = jest.spyOn(global, 'fetch');
  try {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({paymentStatus: 'AWAITING_CUSTOMER'}), {status: 200}),
    );
    await expect(client.readPayment(id)).resolves.toEqual({
      kind: 'read',
      paymentStatus: 'AWAITING_CUSTOMER',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9999/v1/payments/' + id, {
      method: 'GET',
      headers: {Authorization: 'Bearer app_x'},
      signal: expect.any(AbortSignal),
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({code: 'NOT_FOUND'}), {status: 404}),
    );
    await expect(client.readPayment(id)).resolves.toEqual({
      kind: 'rejected',
      status: 404,
      code: 'NOT_FOUND',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({code: 'UNAVAILABLE'}), {status: 503}),
    );
    await expect(client.readPayment(id)).rejects.toEqual(
      new LedgerRetryableError('ledger 503 UNAVAILABLE'),
    );
    fetchMock.mockRejectedValueOnce(new DOMException('Bearer app_x must not leak', 'TimeoutError'));
    await expect(client.readPayment(id)).rejects.toEqual(new LedgerRetryableError('TimeoutError'));
    fetchMock.mockResolvedValueOnce(new Response('{}', {status: 200}));
    await expect(client.readPayment(id)).rejects.toEqual(
      new LedgerRetryableError('ledger 200 unparsable body'),
    );
    fetchMock.mockClear();
    await expect(client.readPayment('pay_../x')).resolves.toEqual({
      kind: 'rejected',
      status: 0,
      code: 'INVALID_PAYMENT_ID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});
