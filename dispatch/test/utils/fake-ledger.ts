import {createServer, IncomingHttpHeaders, Server, ServerResponse} from 'node:http';

export type Step =
  | {respond: 'ok'}
  | {respond: 'settled'}
  | {respond: 'status'; status: number; code: string}
  | {respond: 'unknown'}
  | {respond: 'slow'; delayMs: number};

export type ReadStep =
  {respond: 'resource'; paymentStatus?: string} | {respond: 'status'; status: number; code: string};

interface FakePayment {
  id: string;
  key: string;
  body: Record<string, unknown>;
  settled?: boolean;
}

export class FakeLedger {
  readonly requests: Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: Record<string, unknown>;
  }> = [];
  readonly payments = new Map<string, FakePayment>();
  private readonly steps = new Map<string, Step[]>();
  private readonly readSteps = new Map<string, ReadStep[]>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private server: Server;
  private sequence = 0;

  async start(): Promise<string> {
    this.server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk.toString();
      }
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      this.requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body,
      });
      const read = request.url?.match(/^\/v1\/payments\/(pay_[0-9A-Z]{26})$/);
      if (request.method === 'GET' && read) {
        if (!request.headers.authorization?.startsWith('Bearer ')) {
          this.answer(response, 401, {code: 'UNAUTHORIZED'});
          return;
        }
        const step = this.readSteps.get(read[1])?.shift() ?? {respond: 'resource'};
        if (step.respond === 'status') {
          this.answer(response, step.status, {code: step.code});
          return;
        }
        const payment = [...this.payments.values()].find(value => value.id === read[1]);
        if (!payment) {
          this.answer(response, 404, {code: 'NOT_FOUND'});
          return;
        }
        this.answer(response, 200, {
          ...this.resource(payment),
          paymentStatus: step.paymentStatus ?? 'AWAITING_CUSTOMER',
        });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/payments') {
        this.answer(response, 404, {code: 'NOT_FOUND'});
        return;
      }
      if (!request.headers.authorization?.startsWith('Bearer ')) {
        this.answer(response, 401, {code: 'UNAUTHORIZED'});
        return;
      }
      const key = request.headers['idempotency-key'] as string;
      if (!key) {
        this.answer(response, 400, {code: 'IDEMPOTENCY_KEY_REQUIRED'});
        return;
      }
      const orderKey = body.orderKey as string;
      const existing = this.payments.get(orderKey);
      if (existing) {
        if (existing.key !== key) {
          this.answer(response, 409, {code: 'ORDER_INTENT_CONFLICT'});
          return;
        }
        response.setHeader('Idempotent-Replay', 'true');
        this.answer(response, 200, this.resource(existing));
        return;
      }
      const step = this.steps.get(orderKey)?.shift() ?? {respond: 'ok'};
      if (step.respond === 'status') {
        this.answer(response, step.status, {code: step.code});
        return;
      }
      this.sequence += 1;
      const payment = {
        id: 'pay_' + String(this.sequence).padStart(26, '0'),
        key,
        body,
        settled: step.respond === 'settled',
      };
      this.payments.set(orderKey, payment);
      if (step.respond === 'unknown') {
        this.answer(response, 500, {
          code: 'PROVIDER_UNKNOWN_RESULT',
          details: [{field: 'paymentId', issue: payment.id}],
        });
      } else if (step.respond === 'slow') {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          this.answer(response, 201, this.resource(payment));
        }, step.delayMs);
        this.timers.add(timer);
      } else {
        this.answer(response, 201, this.resource(payment));
      }
    });
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + (this.server.address() as {port: number}).port;
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close(error => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
    });
  }

  script(orderKey: string, steps: Step[]): void {
    this.steps.set(orderKey, [...steps]);
  }

  scriptRead(paymentId: string, steps: ReadStep[]): void {
    this.readSteps.set(paymentId, [...steps]);
  }

  private resource(payment: FakePayment): Record<string, unknown> {
    return {
      id: payment.id,
      orderKey: payment.body.orderKey,
      paymentStatus: 'AWAITING_CUSTOMER',
      amountMinor: payment.body.amountMinor,
      currency: payment.body.currency,
      nextAction: payment.settled
        ? {type: 'NONE'}
        : {
            type: 'REDIRECT_TO_HOSTED_CHECKOUT',
            hostedUrl:
              'https://www.sandbox.paypal.com/checkoutnow?token=FAKE' + payment.id.slice(4),
          },
    };
  }

  private answer(response: ServerResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(body));
  }
}
