import { IsString, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({ example: 'price_xxx' })
  @IsString()
  priceId: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: 500 })
  @IsNumber()
  @Min(1)
  @Max(500)
  seats: number;
}
