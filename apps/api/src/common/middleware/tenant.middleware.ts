import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

// Public paths that don't need tenant context.
// The health, root, and Azure platform probe paths live at absolute
// root (not under /api/v1/*) via the exclude list in main.ts —
// list them here so the tenant middleware short-circuits them too.
const PUBLIC_PATHS = [
  '/api/docs',
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/billing/webhook',
  '/health',
  '/robots933456.txt',
  '/favicon.ico',
  '/',
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      if (!UUID_REGEX.test(orgId)) {
        next(new Error('Invalid organization id format'));
        return;
      }
      try {
        await this.dataSource.query(
          `SET LOCAL app.current_org = '${orgId}'`,
        );
      } catch (err) {
        next(err);
        return;
      }
    }

    next();
  }
}
