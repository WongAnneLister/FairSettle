import {ConfigService} from '@nestjs/config';
import {SERVICE_READABLE, serviceTokenMatches} from './service-token';
import {CanActivate, ExecutionContext, Injectable} from '@nestjs/common';

import {AllowedRoles} from './role.decorator';
import {GqlExecutionContext} from '@nestjs/graphql';
import {JwtService} from 'src/jwt/jwt.service';
import {Reflector} from '@nestjs/core';
import {UsersService} from 'src/users/users.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.get<AllowedRoles>('roles', context.getHandler());
    if (!roles) {
      return true;
    }
    const gqlContext = GqlExecutionContext.create(context).getContext();
    if (gqlContext.serviceToken !== undefined) {
      if (
        this.reflector.get(SERVICE_READABLE, context.getHandler()) &&
        serviceTokenMatches(this.config.get('AGENT_SERVICE_TOKEN'), gqlContext.serviceToken)
      ) {
        gqlContext['caller'] = {kind: 'service'};
        return true;
      }
      return false;
    }
    const token = gqlContext.token;
    if (token) {
      const decoded = this.jwtService.verify(token.toString());
      if (typeof decoded === 'object' && Object.prototype.hasOwnProperty.call(decoded, 'email')) {
        const {user} = await this.usersService.findByEmail(decoded.email);
        if (!user) {
          return false;
        }
        gqlContext['user'] = user;
        gqlContext['caller'] = {kind: 'user', user};
        if (roles.includes('Any')) {
          return true;
        }
        return roles.includes(user.role);
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
}
