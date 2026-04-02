import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectTimesheetDto {
  @ApiProperty({ example: 'Missing Friday hours' })
  @IsString()
  @MinLength(1)
  rejectionNote: string;
}
