import {createParamDecorator, ExecutionContext} from '@nestjs/common';
import {GqlExecutionContext} from '@nestjs/graphql';
import {User} from 'src/users/entities/user.entity';

export type Caller = {kind: 'user'; user: User} | {kind: 'service'};
export const CurrentCaller = createParamDecorator(
  (data: unknown, context: ExecutionContext): Caller =>
    GqlExecutionContext.create(context).getContext()['caller'],
);

export function callerRef(caller: Caller): number | 'service' {
  return caller.kind === 'service' ? 'service' : caller.user.id;
}
