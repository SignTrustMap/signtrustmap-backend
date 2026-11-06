import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemFeatureFlag } from './system-feature-flag.entity';
import { SystemSwitchService } from './system-switch.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SystemFeatureFlag])],
  providers: [SystemSwitchService],
  exports: [SystemSwitchService, TypeOrmModule],
})
export class SystemSwitchModule {}
