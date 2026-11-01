import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = req.headers['x-internal-token'] as string | undefined;
    const expected = process.env.INTERNAL_TOKEN;
    if (!expected || !token || token !== expected) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}
