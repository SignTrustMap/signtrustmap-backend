import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('jwt.googleClientId') || process.env.GOOGLE_CLIENT_ID || 'dummy-client-id';
    const clientSecret = configService.get<string>('jwt.googleClientSecret') || process.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret';
    const callbackURL =
      configService.get<string>('jwt.googleCallbackUrl') ||
      process.env.GOOGLE_CALLBACK_URL ||
      'http://localhost:3000/api/v1/auth/google/callback';

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<any> {
    const email = profile.emails?.[0]?.value || '';
    const fullName = profile.displayName || profile.name?.givenName || email;
    const avatarUrl = profile.photos?.[0]?.value || null;
    const providerUserId = profile.id;

    const user = {
      email,
      fullName,
      avatarUrl,
      provider: 'GOOGLE',
      providerUserId,
      accessToken,
    };
    done(null, user);
  }
}
