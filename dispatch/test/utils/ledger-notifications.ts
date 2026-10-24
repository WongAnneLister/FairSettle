import {INestApplication} from '@nestjs/common';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as request from 'supertest';

import {signNotification} from 'src/ledger/notification';

export function notificationBody(overrides: Record<string, unknown> = {}): Buffer {
  const body = {
    ...JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../contracts/fixtures/ledger-payment-succeeded.json'),
        'utf8',
      ),
    ),
    ...overrides,
  };
  body.businessKey = [
    body.organizationId,
    body.environmentId,
    body.applicationId,
    body.orderId,
    body.eventType,
  ].join(':');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

export function postNotification(
  app: INestApplication,
  raw: Buffer,
  opts: {
    secret?: string;
    timestamp?: number;
    eventIdHeader?: string;
    businessKeyHeader?: string;
    signature?: string;
  } = {},
) {
  const body = JSON.parse(raw.toString('utf8'));
  const eventId = opts.eventIdHeader ?? body.eventId;
  const businessKey = opts.businessKeyHeader ?? body.businessKey;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature =
    opts.signature ??
    signNotification(raw, eventId, businessKey, timestamp, opts.secret ?? 'n'.repeat(40));
  return request(app.getHttpServer())
    .post('/webhooks/ledger')
    .set('Content-Type', 'application/json')
    .set('X-Payments-Event-Id', eventId)
    .set('X-Payments-Business-Key', businessKey)
    .set('X-Payments-Timestamp', String(timestamp))
    .set('X-Payments-Signature', signature)
    .send(raw.toString('utf8'));
}
