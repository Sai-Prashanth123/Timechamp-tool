import { IsEmail, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../database/entities/user.entity';

export class InviteUserDto {
  @ApiProperty({ example: 'colleague@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}
