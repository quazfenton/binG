2026-05-07T04:17:44.023Z [INFO] Chat API [provider:openrouter model:openai/gpt-oss-120b:free]: [FC-GATE] Function calling ability UNKNOWN — using two-phase strategy {
  provider: 'openrouter',
  model: 'openai/gpt-oss-120b:free',
  toolCount: 20,
  strategy: 'Phase 1: tools only; Phase 2: text-mode fallback if no tool calls'
}
[VFS SNAPSHOT] [88r01i] GET /api/filesystem/snapshot path="project/sessions" (polling=false, count=1)
[VFS SNAPSHOT] [88r01i] Snapshot: 3 files in 5ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [88r01i] STALE SNAPSHOT: last updated 1688s ago
 GET /api/filesystem/snapshot?path=project 200 in 126ms (next.js: 90ms, proxy.ts: 15ms, application-code: 21ms)
Database base schema initialized
[database] Migrations completed successfully
[Performance Indexes] ✓ Added: idx_messages_conv_created
[Performance Indexes] ✓ Added: idx_api_credentials_user_provider
[Performance Indexes] ✓ Added: idx_user_sessions_user_expires
[Performance Indexes] ✓ Added: idx_users_email
[Performance Indexes] ✓ Added: idx_user_preferences_user_key
[Performance Indexes] ✓ Added: idx_shadow_commits_session_id
[Performance Indexes] ✓ Added: idx_shadow_commits_owner_id
[Performance Indexes] ✓ Added: idx_shadow_commits_timestamp
[Performance Indexes] ✓ Added: idx_shadow_commits_created_at

[Performance Indexes] Complete!
[Performance Indexes] Success: 9/9
[Performance Indexes] Errors: 0/9
[Performance Indexes] Expected performance improvement: 40-60% faster queries
[database] Performance indexes added successfully
[DB] Database initialized successfully (synchronous)
No pending migrations
[Logger] File logging enabled: ./logs/run.log
[VFS SNAPSHOT] [vkcrgm] GET /api/filesystem/snapshot path="project/sessions" (polling=false, count=1)
[VFS SNAPSHOT] [vkcrgm] Cache hit (age: 28s)
 GET /api/filesystem/snapshot?path=project 200 in 45ms (next.js: 28ms, proxy.ts: 7ms, application-code: 9ms)
Database base schema initialized
[database] Migrations completed successfully
[Performance Indexes] ✓ Added: idx_messages_conv_created
[Performance Indexes] ✓ Added: idx_api_credentials_user_provider
[Performance Indexes] ✓ Added: idx_user_sessions_user_expires
[Performance Indexes] ✓ Added: idx_users_email
[Performance Indexes] ✓ Added: idx_user_preferences_user_key
[Performance Indexes] ✓ Added: idx_shadow_commits_session_id
[Performance Indexes] ✓ Added: idx_shadow_commits_owner_id
[Performance Indexes] ✓ Added: idx_shadow_commits_timestamp
[Performance Indexes] ✓ Added: idx_shadow_commits_created_at

[Performance Indexes] Complete!
[Performance Indexes] Success: 9/9
[Performance Indexes] Errors: 0/9
[Performance Indexes] Expected performance improvement: 40-60% faster queries
[database] Performance indexes added successfully
[DB] Database initialized successfully (synchronous)
No pending migrations
[Logger] File logging enabled: ./logs/run.log
2026-05-07T04:18:28.431Z [ERROR] Chat API: [TOOL-CALL] ✗ VALIDATION failed — blocking execution {
  toolCallId: 'chatcmpl-tool-ad1cef9d04f929d3',
  toolName: 'batch_write',
  validationError: {
    code: 'INVALID_ARGS',
    message: 'Missing required arguments for batch_write: files',
    retryable: true,
    expectedFields: [ 'files' ],
    suggestedNextAction: 'Call batch_write again with all required fields: files'
  },
  severity: 'HIGH'
}