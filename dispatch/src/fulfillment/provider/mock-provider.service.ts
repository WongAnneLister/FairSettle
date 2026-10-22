import {Injectable, Logger} from '@nestjs/common';
import {createHmac, randomUUID} from 'crypto';

import {DispatchRequest, DispatchResult, FulfillmentProvider} from './fulfillment-provider';

export interface MockProviderBehaviour {
  /** Fraction of dispatch calls that throw, 0..1. */
  failureRate: number;
  /** Order ids this provider rejects every time, for testing the dead-letter path. */
  alwaysFailOrderIds: number[];
  /** Delay before the status callback fires, in ms. */
  callbackDelayMs: number;
  /** Where to POST callbacks. Null disables them. */
  callbackUrl: string | null;
  /** Shared secret used to sign callbacks. */
  signingSecret: string;
}

/**
 * Stands in for Uber Direct, DoorDash Drive, or whoever else would actually move
 * the food.
 *
 * It is deliberately a nuisance: it can refuse a dispatch, it answers
 * asynchronously, and it signs its callbacks. A provider that always succeeds
 * immediately would let every one of the failure paths in this module go
 * untested, which is the same trap as the in-memory PubSub in C6 — the
 * implementation that never runs is the one that breaks.
 */
@Injectable()
export class MockFulfillmentProvider implements FulfillmentProvider {
  private readonly logger = new Logger(MockFulfillmentProvider.name);

  private behaviour: MockProviderBehaviour = {
    failureRate: 0,
    alwaysFailOrderIds: [],
    callbackDelayMs: 50,
    callbackUrl: null,
    signingSecret: 'mock-secret',
  };

  /** Tests reconfigure the third party's behaviour; production leaves defaults. */
  configure(patch: Partial<MockProviderBehaviour>): void {
    this.behaviour = {...this.behaviour, ...patch};
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const {failureRate, alwaysFailOrderIds} = this.behaviour;

    if (alwaysFailOrderIds.includes(request.orderId)) {
      throw new Error(`provider permanently rejects order ${request.orderId}`);
    }
    if (Math.random() < failureRate) {
      throw new Error('provider temporarily unavailable');
    }

    const providerRef = `mock_${randomUUID()}`;
    this.logger.log(`accepted order ${request.orderId} as ${providerRef}`);

    // Fired and not awaited, on purpose: a real provider answers the dispatch
    // call immediately and reports progress later, out of band.
    void this.scheduleCallbacks(providerRef, request.orderId);

    return {providerRef};
  }

  private async scheduleCallbacks(providerRef: string, orderId: number): Promise<void> {
    const {callbackUrl, callbackDelayMs} = this.behaviour;
    if (!callbackUrl) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, callbackDelayMs));
    await this.send(callbackUrl, {
      eventId: randomUUID(),
      providerRef,
      orderId,
      status: 'PickedUp',
    });
  }

  /** POSTs a signed callback, exactly as a third party would. */
  async send(url: string, event: Record<string, unknown>): Promise<Response> {
    const body = JSON.stringify(event);
    const signature = createHmac('sha256', this.behaviour.signingSecret).update(body).digest('hex');

    return fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Provider-Signature': signature},
      body,
    });
  }
}
