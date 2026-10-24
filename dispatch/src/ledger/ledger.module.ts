import {Module} from '@nestjs/common';

import {HttpLedgerClient} from './http-ledger-client';
import {LEDGER_CLIENT} from './ledger-client';

@Module({
  providers: [{provide: LEDGER_CLIENT, useClass: HttpLedgerClient}],
  exports: [LEDGER_CLIENT],
})
export class LedgerModule {}
