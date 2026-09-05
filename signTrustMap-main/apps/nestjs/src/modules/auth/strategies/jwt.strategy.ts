import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/user.entity';
import { UserRole } from '../../../entities/user-role.entity';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoleRepo: Repository<UserRole>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || configService.get<string>('JWT_SECRET') || 'dev_jwt_secret_change_me',
    });
  }

  async validate(payload: JwtPayload) {
    // Optionally re-fetch to ensure user still active; lightweight check
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) return null;

    // Attach roles from token (already decoded) – re-query if you want live roles
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
      fullName: user.fullName,
      status: user.status,
    };
  }
}
