import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { RouteSignQueryService } from './application/route-sign-query.service';
import { VerifiedSignService } from './application/verified-sign.service';
import { VERIFIED_SIGN_REPOSITORY } from './domain/verified-sign.repository';
import { TypeOrmVerifiedSignRepository } from './infrastructure/persistence/typeorm-verified-sign.repository';
import { VerifiedSignOrmEntity } from './infrastructure/persistence/verified-sign.orm-entity';
import { VerifiedSignController } from './presentation/verified-sign.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VerifiedSignOrmEntity]), CatalogModule],
  controllers: [VerifiedSignController],
  providers: [
    RouteSignQueryService,
    VerifiedSignService,
    {
      provide: VERIFIED_SIGN_REPOSITORY,
      useClass: TypeOrmVerifiedSignRepository,
    },
  ],
  exports: [RouteSignQueryService, VerifiedSignService],
})
export class SignMapModule {}
