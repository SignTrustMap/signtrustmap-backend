import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemParameter } from './entities/system-parameter.entity';
import { ParameterAuditLog } from './entities/parameter-audit-log.entity';
import { SystemParametersService } from './system-parameters.service';
import { SystemParametersController } from './system-parameters.controller';
import { RedisModule } from '../../integrations/redis/redis.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SystemParameter, ParameterAuditLog]),
    RedisModule,
  ],
  controllers: [SystemParametersController],
  providers: [SystemParametersService],
  exports: [SystemParametersService],
})
export class SystemParametersModule {}
