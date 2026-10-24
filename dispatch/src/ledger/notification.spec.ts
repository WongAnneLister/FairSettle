import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {orderIdFromKey, parseNotification, signNotification, verifySignature} from './notification';

const raw = Buffer.from('{"a":1}');
const eventId = '00000000-0000-0000-0000-000000000001';
const businessKey = 'k';
const timestamp = 1700000000;
const secret = 's'.repeat(32);
const fixture = () =>
  readFileSync(resolve(__dirname, '../../../contracts/fixtures/ledger-payment-succeeded.json'));

function headers() {
  return {
    eventId,
    businessKey,
    timestamp: String(timestamp),
    signature: signNotification(raw, eventId, businessKey, timestamp, secret),
  };
}

describe('ledger notifications', () => {
  it('signNotification matches the ledger formula', () => {
    const expected =
      'v1=' +
      createHmac('sha256', secret)
        .update('1700000000.00000000-0000-0000-0000-000000000001.k.')
        .update(raw)
        .digest('hex');
    expect(signNotification(raw, eventId, businessKey, timestamp, secret)).toBe(expected);
  });

  it('verifySignature accepts a fresh correct signature', () => {
    for (const now of [timestamp, timestamp - 300, timestamp + 300]) {
      expect(verifySignature(raw, headers(), secret, now)).toBe(true);
    }
  });

  it('verifySignature rejects tampering and skew', () => {
    expect(verifySignature(Buffer.from('{"a":2}'), headers(), secret, timestamp)).toBe(false);
    expect(verifySignature(raw, headers(), 'x'.repeat(32), timestamp)).toBe(false);
    for (const now of [timestamp - 301, timestamp + 301]) {
      expect(verifySignature(raw, headers(), secret, now)).toBe(false);
    }
    for (const signature of [
      'v1=' + 'a'.repeat(63),
      headers().signature.toUpperCase().replace('V1=', 'v1='),
    ]) {
      expect(verifySignature(raw, {...headers(), signature}, secret, timestamp)).toBe(false);
    }
    expect(verifySignature(raw, {...headers(), timestamp: '1700000000.5'}, secret, timestamp)).toBe(
      false,
    );
  });

  it('the signature covers raw bytes, not parsed JSON', () => {
    expect(signNotification(raw, eventId, businessKey, timestamp, secret)).not.toBe(
      signNotification(Buffer.from('{ "a": 1 }'), eventId, businessKey, timestamp, secret),
    );
  });

  it('parseNotification accepts the contract fixture', () => {
    const bytes = fixture();
    expect(parseNotification(bytes)).toEqual({ok: true, value: JSON.parse(bytes.toString('utf8'))});
    const value = JSON.parse(bytes.toString('utf8'));
    expect(value).toMatchObject({
      schemaVersion: 1,
      eventType: 'payment.succeeded',
      orderKey: 'dispatch-order-1',
      amountMinor: 1875,
      capturedAmountMinor: 1875,
    });
  });

  it('parseNotification rejects bad bodies', () => {
    expect(parseNotification(Buffer.from('not JSON')).ok).toBe(false);
    const valid = JSON.parse(fixture().toString('utf8'));
    for (const patch of [
      {schemaVersion: 2},
      {eventType: 'refund.succeeded'},
      {orderKey: 'order-1'},
      {orderKey: 'dispatch-order-0'},
      {amountMinor: -1},
      {amountMinor: 1.5},
    ]) {
      expect(parseNotification(Buffer.from(JSON.stringify({...valid, ...patch}))).ok).toBe(false);
    }
    const {businessKey: _omitted, ...missing} = valid;
    expect(parseNotification(Buffer.from(JSON.stringify(missing))).ok).toBe(false);
  });

  it('orderIdFromKey', () => {
    expect(orderIdFromKey('dispatch-order-42')).toBe(42);
    for (const key of ['dispatch-order-', 'dispatch-order-042', 'x']) {
      expect(orderIdFromKey(key)).toBeNull();
    }
  });
});
