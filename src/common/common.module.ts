import {Global, Module} from '@nestjs/common';

import {PUB_SUB} from './common.constants';
import {PubSub} from 'graphql-subscriptions';

@Global()
@Module({
  providers: [
    {
      provide: PUB_SUB,
      // A factory, not a module-level `const pubsub = new PubSub()`.
      //
      // The constant was process-wide state that every application instance in
      // the process shared. In production that is invisible — one process, one
      // app — but it means two instances booted in one test process share a bus
      // they would not share in a deployment, so a test cannot tell a
      // process-local bus from a shared one.
      //
      // One instance per application container is what a replica actually has.
      useFactory: () => new PubSub(),
    },
  ],
  exports: [PUB_SUB],
})
export class CommonModule {}
