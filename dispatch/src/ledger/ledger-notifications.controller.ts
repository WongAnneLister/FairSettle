import {Controller, Logger, Post, RawBodyRequest, Req, Res} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Request, Response} from 'express';

import {LedgerNotificationService} from './ledger-notification.service';
import {NOTIFICATION_MAX_BYTES, parseNotification, verifySignature} from './notification';

@Controller('webhooks')
export class LedgerNotificationsController {
  private readonly logger = new Logger(LedgerNotificationsController.name);

  constructor(
    private readonly ingest: LedgerNotificationService,
    private readonly config: ConfigService,
  ) {}

  @Post('ledger')
  async ledger(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    if (this.config.get('LEDGER_CHECKOUT') !== 'enabled') {
      res.status(404).json({error: 'not found'});
      return;
    }
    const raw = req.rawBody;
    if (!Buffer.isBuffer(raw)) {
      res.status(400).json({error: 'raw body required'});
      return;
    }
    if (raw.length > NOTIFICATION_MAX_BYTES) {
      res.status(413).json({error: 'body too large'});
      return;
    }
    const eventId = this.singleHeader(req, 'x-payments-event-id');
    const businessKey = this.singleHeader(req, 'x-payments-business-key');
    const timestamp = this.singleHeader(req, 'x-payments-timestamp');
    const signature = this.singleHeader(req, 'x-payments-signature');
    if (
      !eventId ||
      !businessKey ||
      !timestamp ||
      !signature ||
      !verifySignature(
        raw,
        {eventId, businessKey, timestamp, signature},
        this.config.get<string>('LEDGER_NOTIFICATION_SECRET'),
        Math.floor(Date.now() / 1000),
      )
    ) {
      res.status(401).json({error: 'invalid signature'});
      return;
    }
    const parsed = parseNotification(raw);
    if (
      parsed.ok === false ||
      parsed.value.eventId !== eventId ||
      parsed.value.businessKey !== businessKey
    ) {
      res.status(400).json({error: 'invalid notification'});
      return;
    }
    const n = parsed.value;
    try {
      const result = await this.ingest.ingest(n, raw);
      const outcome = result.kind === 'recorded' ? result.reason : result.kind;
      this.logger.log(
        'event ' + n.eventId + ' (' + n.eventType + ') for ' + n.orderKey + ': ' + outcome,
      );
      if (result.kind === 'duplicate') {
        res.status(200).json({received: true, duplicate: true});
      } else if (result.kind === 'conflict') {
        res.status(409).json({error: 'event id reused with different content'});
      } else {
        res
          .status(200)
          .json({received: true, duplicate: false, applied: result.applied, reason: result.reason});
      }
    } catch {
      this.logger.error(
        'event ' + n.eventId + ' (' + n.eventType + ') for ' + n.orderKey + ': persistence failed',
      );
      res.status(500).json({error: 'notification persistence failed'});
    }
  }

  private singleHeader(req: Request, name: string): string | undefined {
    let count = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index].toLowerCase() === name) {
        count += 1;
      }
    }
    const value = req.headers[name];
    return count === 1 && typeof value === 'string' ? value : undefined;
  }
}
