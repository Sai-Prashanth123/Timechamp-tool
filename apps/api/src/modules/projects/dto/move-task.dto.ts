import { IsString, IsNotEmpty, IsInt, Min, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveTaskDto {
  @ApiProperty({ example: 'in_progress', enum: ['todo', 'in_progress', 'in_review', 'done'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['todo', 'in_progress', 'in_review', 'done'])
  status: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  position: number;
}
