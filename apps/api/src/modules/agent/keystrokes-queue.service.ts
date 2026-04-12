import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * KeystrokesQueueService — pgmq wrapper for the agent_keystrokes queue.
 * Mirrors the structure of ActivityQueueService and MetricsQueueService.
 */
@Injectable()
export class KeystrokesQueueService {
  private static readonly QUEUE_NAME = 'agent_keystrokes';

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async enqueue(payload: KeystrokesQueuePayload): Promise<number> {
    const result = await this.dataSource.query<Array<{ send: number }>>(
      `SELECT pgmq.send($1, $2::jsonb) AS send`,
      [KeystrokesQueueService.QUEUE_NAME, JSON.stringify(payload)],
    );
    return result[0]?.send ?? 0;
  }

  async read(batchSize: number, visibilityTimeoutSec = 30): Promise<KeystrokesQueueMessage[]> {
    return this.dataSource.query<KeystrokesQueueMessage[]>(
      `SELECT msg_id, message FROM pgmq.read($1, $2, $3)`,
      [KeystrokesQueueService.QUEUE_NAME, visibilityTimeoutSec, batchSize],
    );
  }

  async deleteMany(msgIds: number[]): Promise<void> {
    if (msgIds.length === 0) return;
    await this.dataSource.query(
      `SELECT pgmq.delete($1, $2::bigint[])`,
      [KeystrokesQueueService.QUEUE_NAME, msgIds],
    );
  }

  async depth(): Promise<number> {
    const result = await this.dataSource.query<Array<{ queue_length: string }>>(
      `SELECT queue_length FROM pgmq.metrics($1)`,
      [KeystrokesQueueService.QUEUE_NAME],
    );
    return parseInt(result[0]?.queue_length ?? '0', 10);
  }
}

export interface KeystrokesQueuePayload {
  userId: string;
  organizationId: string;
  events: Array<{
    keysPerMin: number;
    mousePerMin: number;
    recordedAt: string;
  }>;
}

export interface KeystrokesQueueMessage {
  msg_id: number;
  message: KeystrokesQueuePayload;
}
