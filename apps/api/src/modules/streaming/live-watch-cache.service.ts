import { Injectable, OnModuleDestroy } from '@nestjs/common';

/**
 * In-memory TTL cache for the "is this user currently being watched live"
 * flag used by the screenshot burst-mode pipeline.
 *
 * Why a dedicated class instead of RedisService?
 * - Explicit about purpose: just one key per user, just one value (bool), just
 *   one TTL rule (60s). No general-purpose KV misuse.
 * - Zero external dependencies: no Redis account, no file writes, no disk I/O,
 *   no cross-process coordination. Pure in-process memory.
 * - Fine for single-instance deployments (which is the norm for this product).
 *   For multi-instance API scaling later, swap this out for Redis pub/sub with
 *   a `live:watch:*` key space.
 *
 * Scope: the desktop agent polls GET /agent/sync/commands every 2 seconds and
 * asks "am I being watched?". The /streaming/request/:userId endpoint sets the
 * flag here with a short TTL (60s). The browser keeps it alive by re-hitting
 * the endpoint every 20s while the live view is open. When the flag expires
 * (manager closed the tab, browser crashed, network died) the agent's next
 * command-poll sees `liveView=false` and burst mode stops automatically.
 */
@Injectable()
export class LiveWatchCache implements OnModuleDestroy {
  /** userId → absolute expiry timestamp (ms since epoch) */
  private readonly store = new Map<string, number>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor() {
    // Periodic sweep so stale entries don't pile up in memory. Fires every 30s
    // — fast enough to keep the map tiny, slow enough that it's invisible.
    this.sweepInterval = setInterval(() => this.sweep(), 30_000);
    // Node doesn't need to keep the process alive for this timer.
    this.sweepInterval.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepInterval);
    this.store.clear();
  }

  /**
   * Mark a user as actively watched for the next `ttlSeconds` seconds.
   * Calling this again before the TTL expires simply extends the expiry —
   * that's how the browser's 20s keep-alive pings work.
   */
  markWatched(userId: string, ttlSeconds = 60): void {
    this.store.set(userId, Date.now() + ttlSeconds * 1000);
  }

  /** True if the user is still in the watch window. Lazily expires on read. */
  isWatched(userId: string): boolean {
    const expiresAt = this.store.get(userId);
    if (expiresAt === undefined) return false;
    if (Date.now() > expiresAt) {
      this.store.delete(userId);
      return false;
    }
    return true;
  }

  /** Clear the watch flag immediately (used by POST /streaming/request/:id/stop). */
  clearWatched(userId: string): void {
    this.store.delete(userId);
  }

  /** Drop all entries whose TTL has expired. Called by the periodic sweep. */
  private sweep(): void {
    const now = Date.now();
    for (const [userId, expiresAt] of this.store.entries()) {
      if (now > expiresAt) this.store.delete(userId);
    }
  }
}
