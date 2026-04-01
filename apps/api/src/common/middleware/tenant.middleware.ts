import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const host = req.headers['host'] ?? '';
    const subdomain = host.split('.')[0];
    (req as any).tenantSubdomain = subdomain;
    next();
  }
}
