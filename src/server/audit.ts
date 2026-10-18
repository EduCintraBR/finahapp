import { auditLog } from '@/db/schema';
import type { Tx } from './context';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CANCEL'
  | 'CONFIRM_PAYMENT'
  | 'REVERT_PAYMENT'
  | 'GENERATE'
  | 'CHANGE_FROM'
  | 'END'
  | 'CHECKPOINT'
  | 'ANTICIPATE'
  | 'REFUND';

/** Invariante 7: toda mutação relevante grava audit_log, na mesma transação. */
export async function audit(
  tx: Tx,
  entry: {
    userId: string | null;
    entity: string;
    entityId: string;
    action: AuditAction;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.insert(auditLog).values({
    userId: entry.userId,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
