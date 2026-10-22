import {Injectable} from '@nestjs/common';
import {MailerService} from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendUserConfirmation(code: string, email: string): Promise<void> {
    const url = `http://127.0.0.1:3000/confirm?code=${code}`;
    try {
      await this.mailerService.sendMail({
        to: email,
        from: 'Delivery <noreply@fairsettle.local>',
        subject: 'Welcome to FairSettle Dispatch! Confirm your account',
        text: 'Welcome to FairSettle Dispatch! Confirm your account',
        template: 'confirmation',
        context: {
          verificationUrl: url,
        },
      });
    } catch (error) {
      console.error('Email Error');
    }
  }
}
