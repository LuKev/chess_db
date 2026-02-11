import type { Pool } from "pg";

type AuditEventInput = {
  userId: number | null;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(
  pool: Pool,
  event: AuditEventInput
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (
      user_id,
      action,
      method,
      path,
      status_code,
      ip_address,
      user_agent,
      request_id,
      metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
    )`,
    [
      event.userId,
      event.action,
      event.method,
      event.path,
      event.statusCode,
      event.ipAddress,
      event.userAgent,
      event.requestId,
      JSON.stringify(event.metadata ?? {}),
    ]
  );
}
