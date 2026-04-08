import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExportTimesheetsDto {
  @ApiProperty({ description: 'Start date YYYY-MM-DD' })
  @IsDateString()
  from: string;

  @ApiProperty({ description: 'End date YYYY-MM-DD' })
  @IsDateString()
  to: string;
}
