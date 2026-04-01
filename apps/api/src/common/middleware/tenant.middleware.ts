import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

// Public paths that don't need tenant context
const PUBLIC_PATHS = [
  '/api/docs',
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/health',
  '/api/v1/billing/webhook',
];

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const isPublic = PUBLIC_PATHS.some((p) => req.path.startsWith(p));
    if (isPublic) {
      next();
      return;
    }

    const orgId = (req as any).user?.organizationId as string | undefined;
    if (orgId) {
      // Set PostgreSQL session variable — RLS policies read this per connection
      await this.dataSource.query(
        `SET LOCAL app.current_org = '${orgId}'`,
      );
    }

    next();
  }
}
