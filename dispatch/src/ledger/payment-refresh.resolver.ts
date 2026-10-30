import {Args, Mutation, Resolver} from '@nestjs/graphql';

import {AuthUser} from 'src/auth/auth-user.decorator';
import {Role} from 'src/auth/role.decorator';
import {User} from 'src/users/entities/user.entity';

import {RefreshOrderPaymentInput, RefreshOrderPaymentOutput} from './dto/refresh-order-payment.dto';
import {PaymentRefreshService} from './payment-refresh.service';

@Resolver()
export class PaymentRefreshResolver {
  constructor(private readonly payments: PaymentRefreshService) {}

  @Mutation(returns => RefreshOrderPaymentOutput)
  @Role(['Any'])
  refreshOrderPayment(
    @AuthUser() user: User,
    @Args('input') input: RefreshOrderPaymentInput,
  ): Promise<RefreshOrderPaymentOutput> {
    return this.payments.refresh(user, input);
  }
}
