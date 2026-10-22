import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHmac, timingSafeEqual} from 'crypto';

import {WebhookIngestService} from './webhook-ingest.service';

export interface FulfillmentCallback {
  eventId: string;
  providerRef: string;
  orderId: number;
  status: string;
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly ingest: WebhookIngestService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Status callbacks from the fulfillment provider.
   *
   * Always answers 200 for anything it has durably decided about — including
   * duplicates and events it chose to ignore. A provider reads a non-2xx as
   * "try again", so returning 4xx for an event that was already applied is how
   * a redelivery loop starts.
   */
  @Post('fulfillment')
  @HttpCode(200)
  async fulfillment(
    @Body() body: FulfillmentCallback,
    @Headers('x-provider-signature') signature: string,
    @Headers('x-raw-body') _raw?: string,
  ): Promise<{received: true; applied: boolean; reason?: string}> {
    this.verify(body, signature);

    if (!body?.eventId || !body?.providerRef || !body?.status) {
      throw new BadRequestException('eventId, providerRef and status are required');
    }

    const result = await this.ingest.apply(body);
    this.logger.log(
      `event ${body.eventId} (${body.status}) for ${body.providerRef}: ${result.reason}`,
    );

    return {received: true, applied: result.applied, reason: result.reason};
  }

  /**
   * HMAC over the body, compared in constant time.
   *
   * Without this the endpoint is an unauthenticated way for anyone who can guess
   * an order id to mark it delivered.
   */
  private verify(body: unknown, signature: string): void {
    const secret = this.config.get<string>('FULFILLMENT_SIGNING_SECRET');
    const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

    const given = Buffer.from(signature ?? '', 'utf8');
    const want = Buffer.from(expected, 'utf8');

    // timingSafeEqual throws on a length mismatch, so the lengths are compared
    // first — and a wrong-length signature is rejected before any comparison.
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new UnauthorizedException('bad signature');
    }
  }
}
