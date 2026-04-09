import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_log')
@Index(['organizationId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  /** UUID of the user who performed the action. Null for system events. */
  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actorId: string | null;

  /** Stored separately so it survives user deletion. */
  @Column({ name: 'actor_email', length: 255 })
  actorEmail: string;

  /**
   * Verb describing what happened.
   * Examples: user.invited, user.deactivated, user.role_changed,
   *           timesheet.approved, timesheet.rejected, subscription.changed
   */
  @Column({ length: 100 })
  action: string;

  /** Type of the affected resource, e.g. "user", "timesheet", "subscription". */
  @Column({ name: 'resource_type', length: 50 })
  resourceType: string;

  /** ID of the affected resource (UUID or other string). Nullable for bulk ops. */
  @Column({ name: 'resource_id', type: 'varchar', length: 255, nullable: true })
  resourceId: string | null;

  /** Extra context: old values, new values, diff, etc. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** IP from which the action was performed. Captured from request header. */
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
