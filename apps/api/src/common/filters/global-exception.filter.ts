import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message =
        typeof res === 'string'
          ? res
          : (res as any).message ?? 'Internal server error';
    }

    // Log internally — never expose stack traces to clients.
    //
    // 404s are almost always bot scans, Azure platform probes
    // (/robots933456.txt, /favicon.ico, /health, /), or stale clients
    // hitting retired routes. They are not actionable errors and should
    // not pollute production logs with stack traces. Downgrade to a
    // single-line `warn` with no stack. Real errors (5xx, 4xx other than
    // 404) still get full stack trace logging.
    if (status === HttpStatus.NOT_FOUND) {
      this.logger.warn(`${request.method} ${request.url} → 404`);
    } else {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
