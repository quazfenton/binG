/**
 * Database Schema Registry
 *
 * Single source of truth for all per-module SQL schemas.
 * All database table definitions live here in .sql files, never inline in TypeScript.
 * Callers should use:
 *   import { execSchemaFile } from '@/lib/database/schema';
 *   execSchemaFile(db, 'events-schema');
 *
 * Available schema files (in web/lib/database/schema/):
 *   - events-schema.sql     → events, scheduled_tasks
 *   - logging-schema.sql    → chat_request_logs, tool_calls, hitl_audit_logs
 *   - fs-edit-schema.sql    → fs_edit_transactions, fs_edit_denials
 *   - approval-requests.sql → approval_requests (human-in-loop variant)
 *   - healing-log.sql       → event_healing_log (self-healing variant)
 *
 * Note: The core application tables (users, sessions, conversations, messages, etc.)
 * live in schema.sql, read at runtime by getSchemaSql() in connection.ts — not in this
 * directory, to avoid renaming complexity with the existing Next.js standalone build.
 */

import { getSqlFromFile } from './loader';
export { getSqlFromFile, execSchemaFile } from './loader';