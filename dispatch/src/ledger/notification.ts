import {createHmac, timingSafeEqual} from 'node:crypto';

import type {LedgerPaymentEvent} from 'src/orders/order-state-machine';

export const NOTIFICATION_MAX_BYTES = 16384;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface LedgerNotification extends Record<string, unknown> {
  schemaVersion: 1;
  eventId: string;
  eventType: LedgerPaymentEvent;
  orderKey: string;
  currency: string;
  amountMinor: number;
  capturedAmountMinor: number;
  paymentStatus: string;
  businessKey: string;
  occurredAt: string;
}

export function signNotification(
  raw: Buffer,
  eventId: string,
  businessKey: string,
  timestamp: number,
  secret: string,
): string {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('KEY_UNAVAILABLE');
  }
  return (
    'v1=' +
    createHmac('sha256', secret)
      .update(String(timestamp) + '.' + eventId + '.' + businessKey + '.', 'utf8')
      .update(raw)
      .digest('hex')
  );
}

export function verifySignature(
  raw: Buffer,
  headers: {eventId: string; businessKey: string; timestamp: string; signature: string},
  secret: string,
  nowSeconds: number,
): boolean {
  if (
    !headers.eventId ||
    !headers.businessKey ||
    typeof headers.timestamp !== 'string' ||
    !/^[0-9]{1,12}$/.test(headers.timestamp) ||
    typeof headers.signature !== 'string' ||
    !/^v1=[0-9a-f]{64}$/.test(headers.signature)
  ) {
    return false;
  }
  const timestamp = Number(headers.timestamp);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }
  try {
    const expected = Buffer.from(
      signNotification(raw, headers.eventId, headers.businessKey, timestamp, secret),
      'ascii',
    );
    const given = Buffer.from(headers.signature, 'ascii');
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}

export function orderIdFromKey(orderKey: string): number | null {
  const match = /^dispatch-order-([1-9][0-9]*)$/.exec(orderKey);
  return match ? Number(match[1]) : null;
}

export function parseNotification(
  raw: Buffer,
): {ok: true; value: LedgerNotification} | {ok: false; reason: string} {
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return {ok: false, reason: 'invalid JSON'};
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {ok: false, reason: 'invalid notification'};
  }
  const n = body as Record<string, unknown>;
  if (
    n.schemaVersion !== 1 ||
    typeof n.eventId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(n.eventId) ||
    !['payment.succeeded', 'payment.canceled', 'payment.state_changed'].includes(
      n.eventType as string,
    ) ||
    typeof n.orderKey !== 'string' ||
    orderIdFromKey(n.orderKey) === null ||
    !['currency', 'paymentStatus', 'businessKey', 'occurredAt'].every(
      key => typeof n[key] === 'string',
    ) ||
    ![n.amountMinor, n.capturedAmountMinor].every(
      value => typeof value === 'number' && Number.isInteger(value) && value >= 0,
    )
  ) {
    return {ok: false, reason: 'invalid notification'};
  }
  return {ok: true, value: n as LedgerNotification};
}
