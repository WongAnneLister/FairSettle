import {Global, Inject, Module, OnModuleDestroy} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {RedisPubSub} from 'graphql-redis-subscriptions';
import Redis, {RedisOptions} from 'ioredis';

import {PUB_SUB} from './common.constants';

@Global()
@Module({
  providers: [
    {
      provide: PUB_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const options: RedisOptions = {
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
          // The subscriber connection must be able to reconnect on its own: a
          // dropped connection that never retries is a subscription that goes
          // quiet without erroring, which is the failure mode this whole change
          // is about.
          retryStrategy: times => Math.min(times * 200, 5000),
        };

        // graphql-redis-subscriptions needs two connections. A Redis client in
        // subscriber mode may only issue subscribe/unsubscribe commands, so
        // publishing has to go down a separate one.
        return new RedisPubSub({
          publisher: new Redis(options),
          subscriber: new Redis(options),
        });
      },
    },
  ],
  exports: [PUB_SUB],
})
export class CommonModule implements OnModuleDestroy {
  constructor(@Inject(PUB_SUB) private readonly pubsub: RedisPubSub) {}

  /**
   * Closes both Redis connections on shutdown.
   *
   * Nest calls lifecycle hooks on providers, and a RedisPubSub has `close()`
   * rather than `onModuleDestroy`, so nothing would have called it. The sockets
   * then outlive the application: the process refuses to exit, and a rolling
   * deploy leaves connections behind on every replica it replaces.
   *
   * Surfaced by the e2e suite hanging after its assertions passed.
   */
  async onModuleDestroy(): Promise<void> {
    await this.pubsub.close();
  }
}
