import { Controller, Get, Header, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Root-level probe handlers for cloud platform reachability checks.
 *
 * Azure App Service, Container Apps, and ACI fire a handful of magic
 * URLs at every container on startup to decide whether the site is
 * "real" and reachable:
 *
 *   GET /                    → warm-up / readiness probe
 *   GET /robots933456.txt    → Azure language detection probe
 *   GET /favicon.ico         → browser auto-fetch when you open the URL
 *
 * (The `/health` path is served separately by HealthController via the
 * `exclude` list in main.ts so it stays the canonical health route
 * without duplication.)
 *
 * Without these handlers every probe gets a 404 from the NestJS router
 * and the GlobalExceptionFilter logs a full stack trace — minutes of
 * noise on every deploy. Serving a lightweight 200/204 here makes
 * Azure happy AND keeps production logs clean.
 *
 * These routes are excluded from the global `api/v1` prefix via the
 * `exclude` option on `setGlobalPrefix` in main.ts so they serve
 * at the absolute root paths that Azure actually hits.
 *
 * `@ApiExcludeController` keeps these probe endpoints out of the
 * Swagger docs — they're infrastructure plumbing, not API surface.
 */
@ApiExcludeController()
@Controller()
export class ProbeController {
  /**
   * Root-path warm-up probe. Returns a minimal JSON so curl / monitors
   * get a friendly response instead of an empty body.
   */
  @Get()
  root() {
    return { service: 'timechamp-api', status: 'ok' };
  }

  /**
   * Azure's language-detection magic filename. Azure fires this at every
   * container on startup; any non-404 response is treated as "this is a
   * real site". We return a minimal robots.txt since the API has
   * nothing to index.
   */
  @Get('robots933456.txt')
  @Header('Content-Type', 'text/plain')
  azureProbe() {
    return 'User-agent: *\nDisallow: /\n';
  }

  /**
   * Browser auto-fetch when you open the API URL in a tab. Return 204
   * No Content so the browser stops asking and the log stays clean.
   */
  @Get('favicon.ico')
  @HttpCode(204)
  favicon() {
    return;
  }
}
