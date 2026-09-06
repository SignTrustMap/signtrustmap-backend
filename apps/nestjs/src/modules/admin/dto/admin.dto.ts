import { IsString, IsOptional, IsEnum, MaxLength, IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @IsEnum(['ACTIVE', 'SUSPENDED', 'BANNED'] as any)
  status: string;
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
export class AssignRoleDto {
  @IsString()
  @MaxLength(30)
  roleCode: string;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
