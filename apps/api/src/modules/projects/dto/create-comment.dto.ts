import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'Great progress on this task!' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
