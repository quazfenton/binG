# Database Schema Registry

All SQL table definitions live in `.sql` files here, never inline in TypeScript.
This prevents the kind of drift that caused the `user_sessions` / `performance-indexes` bug.

## Schema File Map

| Schema File | Tables Defined | Owner(s) |
|---|---|---|
| `events-schema.sql` | `events`, `scheduled_tasks` | `lib/events/` (store, scheduler) |
| `logging-schema.sql` | `chat_request_logs`, `tool_calls`, `hitl_audit_logs` | `lib/chat/`, `lib/orchestra/stateful-agent/` |
| `fs-edit-schema.sql` | `fs_edit_transactions`, `fs_edit_denials` | `lib/virtual-filesystem/` |
| `approval-requests.sql` | `approval_requests` (human-in-loop) | `lib/events/human-in-loop.ts` |
| `healing-log.sql` | `event_healing_log` (self-healing) | `lib/events/self-healing.ts` |

**Core schema** lives in `lib/database/schema.sql` and is read at runtime by
`getSchemaSql()` in `connection.ts`. It is NOT in this directory because
`schema.sql` is the existing Next.js standalone build entry point — renaming it
would require updating the build configuration.


## Usage

```ts
import { execSchemaFile } from '@/lib/database/schema';

export async function initializeMyFeature(): Promise<void> {
  const db = getDatabase();
  execSchemaFile(db, 'events-schema'); // loads events-schema.sql
}
```

## Adding a New Schema

1. Create `web/lib/database/schema/<name>.sql` with your `CREATE TABLE IF NOT EXISTS` statements and indexes.
2. Import `execSchemaFile` from `@/lib/database/schema` in the file that owns the table.
3. Call `execSchemaFile(db, '<name>')` in the module's init function.
4. Update this README's table ownership map.