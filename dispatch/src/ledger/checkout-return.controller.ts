import {Controller, Get, Res} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Response} from 'express';

import {CheckoutResult, DEFAULT_STOREFRONT_URL, storefrontReturnUrl} from './checkout-return';

@Controller('checkout')
export class CheckoutReturnController {
  constructor(private readonly config: ConfigService) {}

  @Get('success')
  success(@Res() res: Response): void {
    this.send(res, 'approved');
  }

  @Get('cancel')
  cancel(@Res() res: Response): void {
    this.send(res, 'canceled');
  }

  private send(res: Response, result: CheckoutResult): void {
    if (this.config.get('LEDGER_CHECKOUT') !== 'enabled') {
      res.status(404).json({error: 'not found'});
      return;
    }
    res.redirect(
      302,
      storefrontReturnUrl(
        this.config.get<string>('STOREFRONT_URL') ?? DEFAULT_STOREFRONT_URL,
        result,
      ),
    );
  }
}
