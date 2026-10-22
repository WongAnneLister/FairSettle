import {Injectable, Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Interval} from '@nestjs/schedule';

import {OutboxService} from './outbox.service';

/** How often to look for due events. */
const TICK_MS = 1000;

/** Upper bound on batches per tick, so one tick cannot run away. */
const MAX_BATCHES_PER_TICK = 5;

@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);

  /**
   * Guards against overlap within this process.
   *
   * @Interval fires on a timer regardless of whether the previous tick has
   * finished, and a slow provider makes that likely. Overlapping ticks are safe
   * across replicas — SKIP LOCKED sees to that — but pointless within one, and
   * they multiply the connections held.
   */
  private running = false;

  /**
   * Whether this process drains the outbox.
   *
   * Not a test switch: which processes run background work is a deployment
   * decision. Draining from every API pod means the poll rate scales with
   * however many replicas happen to be serving traffic, and an autoscaler then
   * controls how hard the provider gets hit. Being able to run the drain on
   * dedicated workers is the point; SKIP LOCKED makes either arrangement safe.
   *
   * e2e turns it off so it can drive drain() deterministically rather than
   * racing a timer.
   */
  private readonly enabled: boolean;

  constructor(
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('OUTBOX_POLLING', 'enabled') !== 'disabled';
  }

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;

    try {
      // Keep draining while batches come back full: a backlog should clear at
      // the rate the provider can absorb, not one batch per second.
      for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
        const processed = await this.outbox.drain();
        if (processed === 0) {
          break;
        }
      }
    } catch (error) {
      // A throw out of a timer callback is an unhandled rejection that takes
      // the process down — the failure mode B7 had.
      this.logger.error(
        'outbox drain failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
