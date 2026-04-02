import { IsISO8601, IsInt, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SyncScreenshotDto {
  @ApiProperty({ example: 'screenshots/org-id/user-id/2026-04-02T09-00-00.jpg' })
  @IsString()
  screenshotKey: string;

  @ApiProperty({ example: '2026-04-02T09:00:00.000Z' })
  @IsISO8601()
  capturedAt: string;

  @ApiProperty({ example: 204800 })
  @IsInt()
  @Min(0)
  fileSizeBytes: number;
}
