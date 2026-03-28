***Terminal log: ***

[Performance Indexes] Complete!
[Performance Indexes] Success: 9/9
[Performance Indexes] Errors: 0/9
[Performance Indexes] Expected performance improvement: 40-60% faster queries
[database] Performance indexes added successfully
[Logger] File logging enabled: ./logs/run.log
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
 POST /api/auth/validate 401 in 726ms (compile: 518ms, proxy.ts: 16ms, render: 193ms)
 POST /api/auth/check-auth0-session 401 in 152ms (compile: 143ms, proxy.ts: 4ms, render: 5ms)
 GET /api/auth/session 200 in 200ms (compile: 179ms, proxy.ts: 15ms, render: 6ms)
 GET /api/auth/session 200 in 11ms (compile: 3ms, proxy.ts: 4ms, render: 4ms)
[VFS LIST] [h401aq] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [h401aq] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [ilqzrh] GET /api/filesystem/list path="project/sessions/onedi" (polling=false, count=1)
[VFS LIST] [ilqzrh] Listing directory: "project/sessions/onedi" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [h401aq] Listed 3 entries in 452ms
[VFS LIST WARN] [h401aq] SLOW OPERATION: listDirectory took 452ms for "project"
 GET /api/filesystem/list?path=project 200 in 1812ms (compile: 1217ms, proxy.ts: 5ms, render: 590ms)
[VFS LIST] [ilqzrh] Listed 0 entries in 239ms
[VFS LIST WARN] [ilqzrh] SLOW OPERATION: listDirectory took 239ms for "project/sessions/onedi"
 GET /api/filesystem/list?path=project%2Fsessions%2Fonedi 200 in 1884ms (compile: 1420ms, proxy.ts: 54ms, render: 410ms)
[VFS LIST] [q2b1ei] GET /api/filesystem/list path="project" (polling=false, count=2)
[VFS LIST] [q2b1ei] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [q2b1ei] Listed 3 entries in 44ms
 GET /api/filesystem/list?path=project 200 in 277ms (compile: 64ms, proxy.ts: 10ms, render: 202ms)
[VFS SNAPSHOT] [1gogaz] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS SNAPSHOT] [1gogaz] Snapshot: 3 files in 5ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [1gogaz] STALE SNAPSHOT: last updated 872s ago
 GET /api/filesystem/snapshot?path=project 200 in 421ms (compile: 371ms, proxy.ts: 35ms, render: 15ms)
[VFS SNAPSHOT] [y1jeyo] GET /api/filesystem/snapshot path="project/sessions/onedi" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS SNAPSHOT] [y1jeyo] Snapshot: 0 files in 2ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [y1jeyo] STALE SNAPSHOT: last updated 872s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonedi 200 in 345ms (compile: 271ms, proxy.ts: 66ms, render: 7ms)
[VFS LIST] [px2zka] GET /api/filesystem/list path="project" (polling=false, count=3)
[VFS LIST] [px2zka] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [px2zka] Listed 3 entries in 2ms
 GET /api/filesystem/list?path=project 200 in 150ms (compile: 111ms, proxy.ts: 29ms, render: 10ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 1470ms for path "project"
[VFS LIST] [r095h9] GET /api/filesystem/list path="project" (polling=true, count=4)
[VFS LIST] [r095h9] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [r095h9] Listed 3 entries in 2ms
 GET /api/filesystem/list?path=project 200 in 18ms (compile: 5ms, proxy.ts: 4ms, render: 9ms)
 GET /api/providers 200 in 2.9s (compile: 2.9s, proxy.ts: 6ms, render: 4ms)
 GET /api/providers 200 in 33ms (compile: 22ms, proxy.ts: 4ms, render: 7ms)
[VFS SNAPSHOT] [n4eg8b] GET /api/filesystem/snapshot path="project" (polling=false, count=2)
[VFS SNAPSHOT] [n4eg8b] Cache hit (age: 2s)
 GET /api/filesystem/snapshot?path=project 200 in 11ms (compile: 3ms, proxy.ts: 3ms, render: 5ms)
 GET /api/chat/prewarm 200 in 4.5s (compile: 2.8s, proxy.ts: 6ms, render: 1722ms)
 GET /api/chat/prewarm 200 in 12ms (compile: 3ms, proxy.ts: 5ms, render: 4ms)
[VFS SNAPSHOT] [9v33mx] GET /api/filesystem/snapshot path="project" (polling=false, count=3)
[VFS SNAPSHOT] [9v33mx] Cache hit (age: 2s)
 GET /api/filesystem/snapshot?path=project 200 in 10ms (compile: 3ms, proxy.ts: 3ms, render: 5ms)
[VFS LIST] [n88dlm] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [n88dlm] Listing directory: "project/sessions" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [n88dlm] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 17ms (compile: 7ms, proxy.ts: 3ms, render: 6ms)
[VFS LIST] [f9gtom] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [f9gtom] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [f9gtom] Listed 3 entries in 2ms
 GET /api/filesystem/list?path=project 200 in 11ms (compile: 2ms, proxy.ts: 3ms, render: 6ms)
[VFS LIST] [hi7cxg] GET /api/filesystem/list path="project/sessions" (polling=false, count=2)
[VFS LIST] [hi7cxg] Listing directory: "project/sessions" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [hi7cxg] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 11ms (compile: 2ms, proxy.ts: 3ms, render: 6ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[Logger] File logging enabled: ./logs/run.log
 GET /api/gateway/git/session-anon_1774245892668_zruG2vBh6/versions?limit=20 404 in 1208ms (compile: 1192ms, proxy.ts: 4ms, render: 13ms)
[2026-03-23T06:45:42.998Z] [INFO] [API:Auth:Register] Registration attempt { email: 'bigga@veli.com', username: 'not provided', ip: '::1' }
Registration error: TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null
    at DatabaseOperations.createUserWithVerification (lib\database\connection.ts:526:17)
    at AuthService.register (lib\auth\auth-service.ts:257:33)
    at async (app\api\auth\register\route.ts:51:20)
    at async wrappedHandler (lib\middleware\validate.ts:54:16)
  524 |       VALUES (?, ?, ?, ?, ?, ?)
  525 |     `);
> 526 |     return stmt.run(email, finalUsername, passwordHash, verificationToken, verificationExpires.toISOString(), emailVerified);
      |                 ^
  527 |   }
  528 |
  529 |   getUserByEmail(email: string) {
[2026-03-23T06:45:43.595Z] [WARN] [API:Auth:Register] Registration failed { email: 'bigga@veli.com', error: 'Registration failed' }
 POST /api/auth/register 400 in 1084ms (compile: 421ms, proxy.ts: 4ms, render: 659ms)
[Auth] Failed login attempt for bigga@veli.com from ::1 (1/5)
 POST /api/auth/login 401 in 250ms (compile: 238ms, proxy.ts: 5ms, render: 7ms)
✓ Compiled in 69ms
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
Database base schema initialized
Database initialized successfully
No pending migrations
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
[VFS SNAPSHOT] [gw318t] GET /api/filesystem/snapshot path="project/sessions/onedi" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
Database base schema initialized
Database initialized successfully
No pending migrations
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
[VFS LIST] [4rh0yl] GET /api/filesystem/list path="project/sessions/onedi" (polling=false, count=1)
[VFS LIST] [4rh0yl] Listing directory: "project/sessions/onedi" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[Logger] File logging enabled: ./logs/run.log
[Logger] File logging enabled: ./logs/run.log
[VFS SNAPSHOT] [gw318t] Snapshot: 0 files in 307ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [gw318t] SLOW OPERATION: exportWorkspace took 307ms for "project/sessions/onedi"
[VFS SNAPSHOT WARN] [gw318t] STALE SNAPSHOT: last updated 1166s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonedi 200 in 997ms (compile: 657ms, proxy.ts: 6ms, render: 334ms)
[VFS LIST] [4rh0yl] Listed 0 entries in 20ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonedi 200 in 1489ms (compile: 965ms, proxy.ts: 481ms, render: 44ms)
[VFS LIST] [1lieqa] GET /api/filesystem/list path="project/sessions/onedi" (polling=false, count=2)
[VFS LIST] [1lieqa] Listing directory: "project/sessions/onedi" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [1lieqa] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonedi 200 in 25ms (compile: 6ms, proxy.ts: 7ms, render: 12ms)
  Reload env: .env
✓ Compiled in 142ms
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
 GET /api/chat/prewarm 200 in 918ms (compile: 233ms, proxy.ts: 36ms, render: 650ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[VFS SNAPSHOT] [6e99kv] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
Database base schema initialized
Database initialized successfully
No pending migrations
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
 GET /api/auth/session 200 in 1334ms (compile: 1274ms, proxy.ts: 39ms, render: 22ms)
[Logger] File logging enabled: ./logs/run.log
[Logger] File logging enabled: ./logs/run.log
[VFS SNAPSHOT] [6e99kv] Snapshot: 3 files in 342ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [6e99kv] SLOW OPERATION: exportWorkspace took 342ms for "project"
[VFS SNAPSHOT WARN] [6e99kv] STALE SNAPSHOT: last updated 1323s ago
 GET /api/filesystem/snapshot?path=project 200 in 1367ms (compile: 977ms, proxy.ts: 38ms, render: 352ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
 GET /api/gateway/git/session-anon_1774245892668_zruG2vBh6/versions?limit=20 401 in 1919ms (compile: 1859ms, proxy.ts: 35ms, render: 25ms)
 GET / 200 in 3.6s (compile: 1028ms, proxy.ts: 64ms, render: 2.5s)
[Logger] File logging enabled: ./logs/run.log
[VFS LIST] [p7imuz] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [p7imuz] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
 GET /api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 688ms (compile: 667ms, proxy.ts: 14ms, render: 7ms)
[VFS LIST] [p7imuz] Listed 3 entries in 83ms
 GET /api/filesystem/list?path=project 200 in 677ms (compile: 577ms, proxy.ts: 10ms, render: 90ms)
 GET /api/providers 200 in 280ms (compile: 249ms, proxy.ts: 11ms, render: 20ms)
 GET / 200 in 2.8s (compile: 449ms, proxy.ts: 31ms, render: 2.4s)
[VFS SNAPSHOT] [m9tmv5] GET /api/filesystem/snapshot path="project/sessions/onedi" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS SNAPSHOT] [m9tmv5] Snapshot: 0 files in 2ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [m9tmv5] STALE SNAPSHOT: last updated 1324s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonedi 200 in 57ms (compile: 29ms, proxy.ts: 17ms, render: 11ms)
[VFS SNAPSHOT] [mrfg6p] GET /api/filesystem/snapshot path="project" (polling=false, count=2)
[VFS SNAPSHOT] [mrfg6p] Cache hit (age: 1s)
 GET /api/filesystem/snapshot?path=project 200 in 67ms (compile: 39ms, proxy.ts: 18ms, render: 10ms)
 GET /api/providers 200 in 71ms (compile: 45ms, proxy.ts: 21ms, render: 5ms)
 GET / 200 in 1053ms (compile: 29ms, proxy.ts: 14ms, render: 1010ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[Logger] File logging enabled: ./logs/run.log
 GET /api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 16ms (compile: 6ms, proxy.ts: 5ms, render: 5ms)
  Reload env: .env
✓ Compiled in 75ms
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
 GET / 200 in 219ms (compile: 140ms, proxy.ts: 28ms, render: 52ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
(node:38768) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 uncaughtException listeners added to [process]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
 GET /api/gateway/git/session-anon_1774245892668_zruG2vBh6/versions?limit=20 401 in 180ms (compile: 164ms, proxy.ts: 4ms, render: 12ms)
[Logger] File logging enabled: ./logs/run.log
 GET /api/chat/prewarm 200 in 271ms (compile: 45ms, proxy.ts: 10ms, render: 217ms)
[VFS SNAPSHOT] [c6bhl3] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
 GET /api/auth/session 200 in 366ms (compile: 350ms, proxy.ts: 11ms, render: 5ms)
[VFS SNAPSHOT] [c6bhl3] Snapshot: 3 files in 52ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [c6bhl3] STALE SNAPSHOT: last updated 1396s ago
 GET /api/filesystem/snapshot?path=project 200 in 380ms (compile: 311ms, proxy.ts: 9ms, render: 60ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[Logger] File logging enabled: ./logs/run.log
 GET /api/image-proxy?url=64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 42ms (compile: 31ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [eg7cie] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [eg7cie] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS LIST] [eg7cie] Listed 3 entries in 4ms
 GET /api/filesystem/list?path=project 200 in 66ms (compile: 48ms, proxy.ts: 6ms, render: 12ms)
[VFS SNAPSHOT] [2xtrn1] GET /api/filesystem/snapshot path="project/sessions/onedi" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS SNAPSHOT] [2xtrn1] Snapshot: 0 files in 1ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [2xtrn1] STALE SNAPSHOT: last updated 1398s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonedi 200 in 36ms (compile: 17ms, proxy.ts: 10ms, render: 9ms)
[VFS SNAPSHOT] [tdzjqo] GET /api/filesystem/snapshot path="project" (polling=false, count=2)
[VFS SNAPSHOT] [tdzjqo] Cache hit (age: 2s)
 GET /api/filesystem/snapshot?path=project 200 in 43ms (compile: 26ms, proxy.ts: 10ms, render: 7ms)
 GET /64.media.tumblr.com/0411acaf933ca0d247a7e115cd761608/e85d08b8418d3bbd-0f/s500x750/cebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 404 in 1250ms (compile: 874ms, proxy.ts: 8ms, render: 368ms)
 GET /64.media.tumblr.com/0411acaf933ca0d247a7e115cd761608/e85d08b8418d3bbd-0f/s500x750/cebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 404 in 54ms (compile: 9ms, proxy.ts: 5ms, render: 40ms)
  Reload env: .env
✓ Compiled in 73ms
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
 GET / 200 in 186ms (compile: 115ms, proxy.ts: 30ms, render: 41ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
 GET /api/gateway/git/session-anon_1774245892668_zruG2vBh6/versions?limit=20 401 in 153ms (compile: 136ms, proxy.ts: 4ms, render: 13ms)
[Logger] File logging enabled: ./logs/run.log
 GET /api/chat/prewarm 200 in 315ms (compile: 54ms, proxy.ts: 23ms, render: 237ms)
[VFS LIST] [nn7tj6] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [nn7tj6] Listing directory: "project" for owner="anon:1774245897304_1rGG1U4Xl"
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Creating new workspace { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS] Loading workspace from storage { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
 GET /api/auth/session 200 in 430ms (compile: 403ms, proxy.ts: 23ms, render: 5ms)
[VFS LIST] [nn7tj6] Listed 3 entries in 58ms
 GET /api/filesystem/list?path=project 200 in 441ms (compile: 354ms, proxy.ts: 22ms, render: 64ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[Logger] File logging enabled: ./logs/run.log
[VFS SNAPSHOT] [yna9wj] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: 'anon:1774245897304_1rGG1U4Xl' }
[VFS SNAPSHOT] [yna9wj] Snapshot: 3 files in 3ms (total workspace: 3 files)
[VFS SNAPSHOT WARN] [yna9wj] STALE SNAPSHOT: last updated 1430s ago
 GET /api/filesystem/snapshot?path=project 200 in 57ms (compile: 42ms, proxy.ts: 4ms, render: 11ms)
 GET /api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 38ms (compile: 29ms, proxy.ts: 4ms, render: 6ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[2026-03-23T06:54:34.564Z] [INFO] [API:Auth:Register] Registration attempt { email: 'bigga@veli.com', username: 'not provided', ip: '::1' }
[Logger] File logging enabled: ./logs/run.log

🔐 EMAIL VERIFICATION LINK (Development):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 To: bigga@veli.com
🔗 URL: http://localhost:3000/verify-email?token=f011545c-b0b1-4cc7-abb6-ebed78727b42
⏰ Expires: 3/24/2026, 2:54:34 AM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[EmailQuotaManager] Loaded 6 email provider quotas
📧 Email sent successfully via brevo (0.08888888888888889.1f)% of monthly quota used)
[2026-03-23T06:54:35.905Z] [INFO] [API:Auth:Register] Registration successful, verification required { email: 'bigga@veli.com' }
 POST /api/auth/register 200 in 1487ms (compile: 117ms, proxy.ts: 11ms, render: 1360ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
(node:38768) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [process]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
(node:38768) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 SIGINT listeners added to [process]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
(node:38768) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 SIGTERM listeners added to [process]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
[Logger] File logging enabled: ./logs/run.log
[2026-03-23T06:54:41.273Z] [DEBUG] [Auth:JWT] Token generated {
  userId: '1',
  jti: '5b1d6ec2397de99effd8f416969da740',
  expiresIn: '7d',
  type: undefined
}
 POST /api/auth/login 200 in 1811ms (compile: 101ms, proxy.ts: 5ms, render: 1705ms)
[2026-03-23T06:54:41.993Z] [WARN] [Auth:Middleware] Missing authorization header { path: '/api/user/preferences', ip: '::1' }
 GET /api/user/preferences 401 in 218ms (compile: 207ms, proxy.ts: 4ms, render: 8ms)
[VFS LIST] [rn9k8d] GET /api/filesystem/list path="project/sessions/onedi" (polling=false, count=1)
[VFS LIST] [rn9k8d] Listing directory: "project/sessions/onedi" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Creating new workspace { ownerId: '1' }
[VFS] Loading workspace from storage { ownerId: '1' }
[VFS LIST] [rn9k8d] Listed 0 entries in 6ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonedi 200 in 20ms (compile: 4ms, proxy.ts: 4ms, render: 12ms)
[VFS SNAPSHOT] [s2veog] GET /api/filesystem/snapshot path="project/sessions/onedi" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [s2veog] Snapshot: 0 files in 2ms (total workspace: 0 files)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonedi 200 in 25ms (compile: 6ms, proxy.ts: 11ms, render: 8ms)
[VFS LIST] [an4c2o] GET /api/filesystem/list path="project/sessions/onedi" (polling=false, count=2)
[VFS LIST] [an4c2o] Listing directory: "project/sessions/onedi" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [an4c2o] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonedi 200 in 20ms (compile: 3ms, proxy.ts: 4ms, render: 13ms)
[VFS LIST] [sescw4] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [sescw4] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [sescw4] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 15ms (compile: 3ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [gvs7t5] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [gvs7t5] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [gvs7t5] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project 200 in 22ms (compile: 7ms, proxy.ts: 5ms, render: 10ms)
[VFS LIST] [m44lrc] GET /api/filesystem/list path="project/sessions/oneut" (polling=false, count=1)
[VFS LIST] [m44lrc] Listing directory: "project/sessions/oneut" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [m44lrc] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Foneut 200 in 18ms (compile: 5ms, proxy.ts: 4ms, render: 10ms)
[VFS SNAPSHOT] [7dvtm3] GET /api/filesystem/snapshot path="project/sessions/onedi" (polling=false, count=1)
[VFS SNAPSHOT] [7dvtm3] Cache hit (age: 12s)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonedi 200 in 16ms (compile: 5ms, proxy.ts: 4ms, render: 7ms)
○ Compiling /api/chat ...
[session-store] Using SQLite for session persistence
[Blaxel] Database initialized for callback secrets (encrypted)
[E2BProvider] Initialized - Template: "base", Timeout: 300000ms
[2026-03-23T06:55:19.599Z] [INFO] [Terminal:SessionManager] Using SQLite for terminal session persistence
[DEPRECATED] terminal-session-store.ts is deprecated. Use terminal-session-manager.ts instead.
[DEPRECATED] user-terminal-sessions.ts is deprecated. Use terminal-session-manager.ts instead.
[DEPRECATED] agent-session-manager.ts is deprecated. Use lib/session/session-manager.ts instead.
[MCP] .env.mcp not found, using main .env for MCP config
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
[2026-03-23T06:55:20.824Z] [WARN] [Telemetry:ResponseRouter] Failed to initialize OpenTelemetry, using in-memory metrics only: Resource class not found in @opentelemetry/resources
2026-03-23T06:55:21.914Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE user:1]: Anonymous request (no auth token/session) { authSuccess: true }
2026-03-23T06:55:21.918Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE]: Request body validated {
  messageCount: 1,
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free',
  stream: true,
  userId: '1'
}
[ChatRequestLogger] Database initialized
2026-03-23T06:55:21.920Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Selected provider { supportsStreaming: true }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Creating new workspace { ownerId: '1' }
[VFS] Loading workspace from storage { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
2026-03-23T06:55:21.931Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Validation passed, routing through priority chain {
  requestId: 'chat_1774248921911_DcUowQiWE',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-23T06:55:26.925Z [ERROR] Chat API [req:chat_1774248921911_DcUowQiWE]: V2 execution failed, falling back to v1 {
  error: 'fetch failed',
  stack: 'TypeError: fetch failed\n' +
    '    at node:internal/deps/undici/undici:14902:13\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n' +
    '    at async handleGatewayStreaming (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:1450:25)\n' +
    '    at async POST (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:339:28)\n' +
    '    at async AppRouteRouteModule.do (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:37866)\n' +
    '    at async AppRouteRouteModule.handle (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:45156)\n' +
    '    at async responseGenerator (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_43054031._.js:16540:38)\n' +
    '    at async AppRouteRouteModule.handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:1:191938)\n' +
    '    at async handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_43054031._.js:16603:32)\n' +
    '    at async Module.handler (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_43054031._.js:16656:13)\n' +
    '    at async DevServer.renderToResponseWithComponentsImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1442:9)\n' +
    '    at async DevServer.renderPageComponent (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1494:24)\n' +
    '    at async DevServer.renderToResponseImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1544:32)\n' +
    '    at async DevServer.pipeImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1038:25)\n' +
    '    at async NextNodeServer.handleCatchallRenderRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\next-server.js:395:17)\n' +
    '    at async DevServer.handleRequestImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:929:17)\n' +
    '    at async C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:387:20\n' +
    '    at async Span.traceAsyncFn (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\trace\\trace.js:157:20)\n' +
    '    at async DevServer.handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:383:24)\n' +
    '    at async invokeRender (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:248:21)\n' +
    '    at async handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:447:24)\n' +
    '    at async requestHandlerImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:496:13)\n' +
    '    at async Server.requestListener (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\start-server.js:226:13)'
}
2026-03-23T06:55:26.926Z [INFO] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Using v1 fallback path after V2 failure {
  requestId: 'chat_1774248921911_DcUowQiWE',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-23T06:55:26.927Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Routing request through priority chain {
  requestType: 'chat',
  enableTools: undefined,
  enableSandbox: undefined,
  enableComposio: undefined,
  mode: 'max'
}
[2026-03-23T06:55:26.930Z] [DEBUG] [Model:Ranker] Model stats retrieved { totalModels: 0, fromChatLogger: 0, fromProviderTelemetry: 0 }
[2026-03-23T06:55:26.931Z] [INFO] [API:ResponseRouter] Spec amplification enabled {
  fastModel: undefined,
  mode: 'max',
  provider: undefined,
  fromTelemetry: true
}
[2026-03-23T06:55:26.934Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-23T06:55:26.935Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE user:1 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
[ChatRequestLogger] Failed to log request start: SqliteError: UNIQUE constraint failed: chat_request_logs.id
    at ChatRequestLogger.logRequestStart (lib\chat\chat-request-logger.ts:153:12)
    at async EnhancedLLMService.generateResponse (lib\chat\enhanced-llm-service.ts:219:7)
    at async Object.processRequest (lib\api\response-router.ts:571:28)
    at async ResponseRouter.routeRequest (lib\api\response-router.ts:796:26)
    at async ResponseRouter.routeAndFormat (lib\api\response-router.ts:471:30)
  151 |       const requestSize = JSON.stringify(messages).length;
  152 |
> 153 |       stmt.run(
      |            ^
  154 |         requestId,
  155 |         userId,
  156 |         provider, {
  code: 'SQLITE_CONSTRAINT_PRIMARYKEY'
}
2026-03-23T06:55:26.977Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider {
  messageCount: 2,
  temperature: 0.7,
  maxTokens: 100096,
  apiKeySet: true,
  requestHasKey: true
}
[2026-03-23T06:55:26.978Z] [DEBUG] [Model:Ranker] Model stats retrieved { totalModels: 0, fromChatLogger: 0, fromProviderTelemetry: 0 }
[2026-03-23T06:55:26.979Z] [DEBUG] [Model:Ranker] Model stats retrieved { totalModels: 0, fromChatLogger: 0, fromProviderTelemetry: 0 }
2026-03-23T06:55:26.980Z [DEBUG] Chat API [req:spec-1774248926979-gou0soj provider:mistral]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: undefined,
  enableSandbox: undefined,
  fallbackProviders: undefined
}
[ChatRequestLogger] Failed to log request start: SqliteError: NOT NULL constraint failed: chat_request_logs.model
    at ChatRequestLogger.logRequestStart (lib\chat\chat-request-logger.ts:153:12)
    at async EnhancedLLMService.generateResponse (lib\chat\enhanced-llm-service.ts:219:7)
    at async ResponseRouter.routeWithSpecAmplification (lib\api\response-router.ts:1947:47)
    at async POST (app\api\chat\route.ts:658:27)
  151 |       const requestSize = JSON.stringify(messages).length;
  152 |
> 153 |       stmt.run(
      |            ^
  154 |         requestId,
  155 |         userId,
  156 |         provider, {
  code: 'SQLITE_CONSTRAINT_NOTNULL'
}
2026-03-23T06:55:27.113Z [DEBUG] Chat API [req:spec-1774248926979-gou0soj provider:mistral]: Calling provider {
  messageCount: 2,
  temperature: undefined,
  maxTokens: 2000,
  apiKeySet: true,
  requestHasKey: true
}
2026-03-23T06:55:27.216Z [ERROR] Chat API [provider:mistral]: LLM provider request failed {
  latencyMs: 4,
  error: 'Input validation failed: [\n' +
    '  {\n' +
    '    "code": "invalid_type",\n' +
    '    "expected": "string",\n' +
    '    "received": "undefined",\n' +
    '    "path": [\n' +
    '      "model"\n' +
    '    ],\n' +
    '    "message": "Required"\n' +
    '  }\n' +
    ']'
}
2026-03-23T06:55:27.222Z [DEBUG] Chat API [req:spec-1774248926979-gou0soj provider:mistral]: Provider call failed {
  latencyMs: 109,
  error: 'LLM request failed: Input validation failed: [\n' +
    '  {\n' +
    '    "code": "invalid_type",\n' +
    '    "expected": "string",\n' +
    '    "received": "undefined",\n' +
    '    "path": [\n' +
    '      "model"\n' +
    '    ],\n' +
    '    "message": "Required"\n' +
    '  }\n' +
    ']'
}
2026-03-23T06:55:27.223Z [WARN] Chat API [req:spec-1774248926979-gou0soj provider:mistral]: Primary provider failed {
  latencyMs: 244,
  error: 'Service error from mistral: LLM request failed: Input validation failed: [\n' +
    '  {\n' +
    '    "code": "invalid_type",\n' +
    '    "expected": "string",\n' +
    '    "received": "undefined",\n' +
    '    "path": [\n' +
    '      "model"\n' +
    '    ],\n' +
    '    "message": "Required"\n' +
    '  }\n' +
    ']'
}
2026-03-23T06:55:27.223Z [INFO] Chat API [req:spec-1774248926979-gou0soj provider:openrouter]: Trying fallback provider { attempt: 1, totalFallbacks: 3 }
2026-03-23T06:55:27.224Z [WARN] Chat API [req:spec-1774248926979-gou0soj provider:openrouter]: Fallback provider failed {
  latencyMs: 1,
  attempt: 1,
  error: "Cannot read properties of undefined (reading 'match')"
}
2026-03-23T06:55:27.224Z [INFO] Chat API [req:spec-1774248926979-gou0soj provider:google]: Trying fallback provider { attempt: 2, totalFallbacks: 3 }
2026-03-23T06:55:27.224Z [WARN] Chat API [req:spec-1774248926979-gou0soj provider:google]: Fallback provider failed {
  latencyMs: 0,
  attempt: 2,
  error: "Cannot read properties of undefined (reading 'match')"
}
2026-03-23T06:55:27.225Z [INFO] Chat API [req:spec-1774248926979-gou0soj provider:github]: Trying fallback provider { attempt: 3, totalFallbacks: 3 }
2026-03-23T06:55:27.225Z [WARN] Chat API [req:spec-1774248926979-gou0soj provider:github]: Fallback provider failed {
  latencyMs: 0,
  attempt: 3,
  error: "Cannot read properties of undefined (reading 'match')"
}
[2026-03-23T06:55:27.226Z] [ERROR] [API:ResponseRouter] Spec amplification failed
[2026-03-23T06:55:27.226Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-23T06:55:27.227Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE user:1 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
[ChatRequestLogger] Failed to log request start: SqliteError: UNIQUE constraint failed: chat_request_logs.id
    at ChatRequestLogger.logRequestStart (lib\chat\chat-request-logger.ts:153:12)
    at async EnhancedLLMService.generateResponse (lib\chat\enhanced-llm-service.ts:219:7)
    at async Object.processRequest (lib\api\response-router.ts:571:28)
    at async ResponseRouter.routeRequest (lib\api\response-router.ts:796:26)
    at async ResponseRouter.routeAndFormat (lib\api\response-router.ts:471:30)
    at async ResponseRouter.routeWithSpecAmplification (lib\api\response-router.ts:2030:14)
    at async POST (app\api\chat\route.ts:658:27)
  151 |       const requestSize = JSON.stringify(messages).length;
  152 |
> 153 |       stmt.run(
      |            ^
  154 |         requestId,
  155 |         userId,
  156 |         provider, {
  code: 'SQLITE_CONSTRAINT_PRIMARYKEY'
}
2026-03-23T06:55:27.320Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider {
  messageCount: 2,
  temperature: 0.7,
  maxTokens: 100096,
  apiKeySet: true,
  requestHasKey: true
}
2026-03-23T06:55:35.464Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 8253,
  tokensUsed: 2959,
  finishReason: 'stop',
  contentLength: 3717
}
2026-03-23T06:55:35.465Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 8488, tokensUsed: 2959, finishReason: 'stop' }
2026-03-23T06:55:35.466Z [INFO] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 8531, tokensUsed: 2959, finishReason: 'stop' }
[2026-03-23T06:55:35.839Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 8539 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-23T06:55:46.578Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 19258,
  tokensUsed: 4481,
  finishReason: 'stop',
  contentLength: 5756
}
2026-03-23T06:55:46.580Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 19259, tokensUsed: 4481, finishReason: 'stop' }
2026-03-23T06:55:46.581Z [INFO] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 19354, tokensUsed: 4481, finishReason: 'stop' }
2026-03-23T06:55:46.582Z [INFO] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Request handled by response router { source: 'original-system', priority: 1, fallbackChain: undefined }
2026-03-23T06:55:46.582Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE]: Starting filesystem edits processing { requestId: 'chat_1774248921911_DcUowQiWE' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/package.json' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/package.json' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/package.json',
  contentLength: 432
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.591Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/package.json v1
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/package.json'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 37c3d009-88a1-40f0-9f44-45ba1f089709
[2026-03-23T06:55:46.600Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/package.json
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/vite.config.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/vite.config.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/vite.config.js',
  contentLength: 173
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.604Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/vite.config.js v2
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/vite.config.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 041e4829-dc11-4bea-814e-9c507e9d1577
[2026-03-23T06:55:46.610Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/vite.config.js
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/index.html',
  contentLength: 343
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.613Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/index.html v3
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 6a255905-b1b6-4558-8927-a0e6afa2e9f0
[2026-03-23T06:55:46.620Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/index.html
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/main.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/main.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/main.js',
  contentLength: 131
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.624Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/main.js v4
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/main.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 07a2cb96-634c-4a37-ae1d-0f77965341f2
[2026-03-23T06:55:46.631Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/main.js
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/App.vue' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/App.vue' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/App.vue',
  contentLength: 226
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.635Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/App.vue v5
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/App.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: d6ec1003-256f-488a-818b-699c28d94e49
[2026-03-23T06:55:46.641Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/App.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js',
  contentLength: 452
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.645Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/router/index.js v6
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/router/index.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: ffa5c374-4818-44b3-a496-476f2a5532dc
[2026-03-23T06:55:46.652Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/router/index.js
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue',
  contentLength: 727
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.659Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/components/Hero.vue v7
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/Hero.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 90e1d5e0-aebd-49dc-93a3-6e18129d611a
[2026-03-23T06:55:46.667Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/Hero.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue',
  contentLength: 1373
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.671Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/components/Projects.vue v8
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/Projects.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: b25c0895-57a9-4bd9-b215-8db87382d30c
[2026-03-23T06:55:46.678Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/Projects.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue',
  contentLength: 643
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.682Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/components/ProjectCard.vue v9
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/ProjectCard.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 5367a587-1ede-4db1-9f7a-727b1be8b324
[2026-03-23T06:55:46.689Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/ProjectCard.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue',
  contentLength: 769
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.693Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/components/About.vue v10
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/About.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: d27978e9-1d08-4ed8-bcff-b31c6dadb141
[2026-03-23T06:55:46.699Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/About.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/assets/images/.keep'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/assets/images/.keep'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/assets/images/.keep',
  contentLength: 55
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T06:55:46.703Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/src/assets/images/.keep v11
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/assets/images/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 53b14064-56a1-4686-a15c-4e3cb1a5e6e8
[2026-03-23T06:55:46.711Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/assets/images/.keep
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/package.json' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/package.json' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/package.json',
  contentLength: 433
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/package.json { timeSinceLastWrite: 124, previousVersion: 1 }
[2026-03-23T06:55:46.716Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/package.json v12
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/package.json'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 54ae434d-1e94-4297-87cc-3eb35dc31023
[2026-03-23T06:55:46.723Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/package.json
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/vite.config.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/vite.config.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/vite.config.js',
  contentLength: 174
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/vite.config.js { timeSinceLastWrite: 122, previousVersion: 1 }
[2026-03-23T06:55:46.726Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/vite.config.js v13
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/vite.config.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: b0880fd1-5166-4b1f-8754-e96a78cc16e6
[2026-03-23T06:55:46.734Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/vite.config.js
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/index.html',
  contentLength: 344
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/index.html { timeSinceLastWrite: 124, previousVersion: 1 }
[2026-03-23T06:55:46.738Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/index.html v14
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 013970e8-1220-4758-8a17-4d7ebdfb1610
[2026-03-23T06:55:46.744Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/index.html
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/main.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/main.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/main.js',
  contentLength: 132
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/main.js { timeSinceLastWrite: 124, previousVersion: 1 }
[2026-03-23T06:55:46.749Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/main.js v15
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/main.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 19da40e9-a044-486c-8a5a-a6c2b02dcedd
[2026-03-23T06:55:46.756Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/main.js
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/App.vue' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/App.vue' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/App.vue',
  contentLength: 227
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/App.vue { timeSinceLastWrite: 125, previousVersion: 1 }
[2026-03-23T06:55:46.760Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/App.vue v16
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/App.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 3a27da33-152c-4376-a5fd-8d9c9f516f42
[2026-03-23T06:55:46.767Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/App.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js',
  contentLength: 453
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/router/index.js { timeSinceLastWrite: 126, previousVersion: 1 }
[2026-03-23T06:55:46.772Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/router/index.js v17
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/router/index.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: d7d1f26e-2e60-48c6-9d58-5abc648372d6
[2026-03-23T06:55:46.780Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/router/index.js
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue',
  contentLength: 728
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/components/Hero.vue { timeSinceLastWrite: 127, previousVersion: 1 }
[2026-03-23T06:55:46.786Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/components/Hero.vue v18
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/Hero.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 41a481cc-63b6-4c6f-b9ea-8b84468ce971
[2026-03-23T06:55:46.794Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/Hero.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue',
  contentLength: 1374
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/components/Projects.vue { timeSinceLastWrite: 127, previousVersion: 1 }
[2026-03-23T06:55:46.799Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/components/Projects.vue v19
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/Projects.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 18604a59-ffab-46d7-b86f-48fde7aeea6d
[2026-03-23T06:55:46.807Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/Projects.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue',
  contentLength: 644
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/components/ProjectCard.vue { timeSinceLastWrite: 130, previousVersion: 1 }
[2026-03-23T06:55:46.814Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/components/ProjectCard.vue v20
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/ProjectCard.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: ccc306ab-c6e3-4b5e-ac34-9167b73c9b8c
[2026-03-23T06:55:46.825Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/ProjectCard.vue
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue',
  contentLength: 770
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/oneut/src/components/About.vue { timeSinceLastWrite: 137, previousVersion: 1 }
[2026-03-23T06:55:46.830Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/src/components/About.vue v21
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/src/components/About.vue'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 07b759a6-f84a-4ed0-b707-7f8a123b289c
[2026-03-23T06:55:46.839Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/src/components/About.vue
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/package.json' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/vite.config.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/main.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/App.vue' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/assets/images/.keep'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/package.json' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/vite.config.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/main.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/src/App.vue' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/router/index.js'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Hero.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/Projects.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/ProjectCard.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/src/components/About.vue'
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: 'oneut',
  transactionCount: 21,
  message: 'Auto-commit: write project/sessions/oneut/package.json, write project/sessions/oneut/vite.config.js, write project/sessions/oneut/index.html, write project/sessions/oneut/src/main.js, write project/sessions/oneut/src/App.vue, write project/sessions/oneut/src/router/index.js, write project/sessions/oneut/src/components/Hero.vue, write project/sessions/oneut/src/components/Projects.vue, write project/sessions/oneut/src/components/ProjectCard.vue, write project/sessions/oneut/src/components/About.vue, write project/sessions/oneut/src/assets/images/.keep, write project/sessions/oneut/package.json, write project/sessions/oneut/vite.config.js, write project/sessions/oneut/index.html, write project/sessions/oneut/src/main.js, write project/sessions/oneut/src/App.vue, write project/sessions/oneut/src/router/index.js, write project/sessions/oneut/src/components/Hero.vue, write project/sessions/oneut/src/components/Projects.vue, write project/sessions/oneut/src/components/ProjectCard.vue, write project/sessions/oneut/src/components/About.vue'
}
[ShadowCommit] Generating diffs for 21 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 30c8b686-1efa-42d1-9de6-f0b233273e74
2026-03-23T06:55:46.865Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE]: Filesystem edits processed { requestId: 'chat_1774248921911_DcUowQiWE', appliedCount: 21 }
2026-03-23T06:55:46.868Z [DEBUG] Chat API [req:chat_1774248921911_DcUowQiWE]: Checking streaming conditions {
  requestId: 'chat_1774248921911_DcUowQiWE',
  stream: true,
  supportsStreaming: true
}
2026-03-23T06:55:46.870Z [INFO] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Starting streaming response {
  eventsCount: 6,
  hasFilesystemEdits: true,
  appliedEditsCount: 21,
  requestedFilesCount: 0
}
[VFS LIST] [yei4jc] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [yei4jc] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [yei4jc] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project 200 in 22ms (compile: 5ms, proxy.ts: 7ms, render: 11ms)
2026-03-23T06:55:47.308Z [INFO] Chat API [req:chat_1774248921911_DcUowQiWE provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Stream completed successfully { chunkCount: 25, latencyMs: 440, eventsCount: 6, tokenCount: 3 }
 POST /api/chat 200 in 33.7s (compile: 8.2s, proxy.ts: 9ms, render: 25.4s)
[VFS SNAPSHOT] [wxwof5] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [wxwof5] Snapshot: 0 files in 5ms (total workspace: 0 files)
 GET /api/filesystem/snapshot?path=project 200 in 23ms (compile: 5ms, proxy.ts: 7ms, render: 11ms)
[2026-03-23T06:55:50.852Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 2, errors: 0, avgDurationMs: 13948 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [pz8jzr] GET /api/filesystem/list path="project/sessions/oneut" (polling=false, count=1)
[VFS LIST] [pz8jzr] Listing directory: "project/sessions/oneut" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [pz8jzr] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Foneut 200 in 15ms (compile: 3ms, proxy.ts: 4ms, render: 8ms)
[VFS SNAPSHOT] [614ho5] GET /api/filesystem/snapshot path="project/sessions/oneut" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [614ho5] Snapshot: 0 files in 2ms (total workspace: 0 files)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut 200 in 16ms (compile: 5ms, proxy.ts: 3ms, render: 8ms)
[VFS LIST] [s4ch1j] GET /api/filesystem/list path="project/sessions/oneut" (polling=false, count=2)
[VFS LIST] [s4ch1j] Listing directory: "project/sessions/oneut" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [s4ch1j] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Foneut 200 in 21ms (compile: 3ms, proxy.ts: 8ms, render: 9ms)
[VFS LIST] [fgc9x4] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [fgc9x4] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [fgc9x4] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 14ms (compile: 4ms, proxy.ts: 3ms, render: 7ms)
 GET / 200 in 548ms (compile: 55ms, proxy.ts: 8ms, render: 486ms)
Database base schema initialized
Database initialized successfully
No pending migrations
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
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
 POST /api/auth/validate 200 in 1244ms (compile: 1029ms, proxy.ts: 7ms, render: 208ms)
[Logger] File logging enabled: ./logs/run.log
 GET /api/auth/session 200 in 51ms (compile: 23ms, proxy.ts: 6ms, render: 22ms)
 GET /api/auth/session 200 in 39ms (compile: 13ms, proxy.ts: 12ms, render: 14ms)
[VFS LIST] [4gmgbv] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [4gmgbv] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [4gmgbv] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project 200 in 50ms (compile: 20ms, proxy.ts: 9ms, render: 21ms)
 GET /api/chat/prewarm 200 in 79ms (compile: 50ms, proxy.ts: 9ms, render: 20ms)
 GET /api/chat/prewarm 200 in 14ms (compile: 4ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [zn5r55] GET /api/filesystem/list path="project/sessions/oneut" (polling=false, count=1)
[VFS LIST] [zn5r55] Listing directory: "project/sessions/oneut" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [zn5r55] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Foneut 200 in 40ms (compile: 18ms, proxy.ts: 14ms, render: 8ms)
[VFS SNAPSHOT] [0gac6m] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [0gac6m] Snapshot: 0 files in 3ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [0gac6m] STALE SNAPSHOT: last updated 601s ago
 GET /api/filesystem/snapshot?path=project 200 in 75ms (compile: 40ms, proxy.ts: 14ms, render: 20ms)
[VFS LIST] [d4afvx] GET /api/filesystem/list path="project" (polling=false, count=2)
[VFS LIST] [d4afvx] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [d4afvx] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project 200 in 69ms (compile: 56ms, proxy.ts: 7ms, render: 6ms)
 GET /api/providers 200 in 304ms (compile: 278ms, proxy.ts: 8ms, render: 18ms)
 GET /api/providers 200 in 10ms (compile: 3ms, proxy.ts: 4ms, render: 4ms)
[VFS LIST] [bacody] GET /api/filesystem/list path="project" (polling=false, count=3)
[VFS LIST] [bacody] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [bacody] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project 200 in 30ms (compile: 13ms, proxy.ts: 9ms, render: 8ms)
[VFS SNAPSHOT] [az95en] GET /api/filesystem/snapshot path="project" (polling=false, count=2)
[VFS SNAPSHOT] [az95en] Cache hit (age: 1s)
 GET /api/filesystem/snapshot?path=project 200 in 35ms (compile: 20ms, proxy.ts: 9ms, render: 6ms)
[VFS SNAPSHOT] [7hdds5] GET /api/filesystem/snapshot path="project/sessions/oneut" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [7hdds5] Snapshot: 0 files in 2ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [7hdds5] STALE SNAPSHOT: last updated 602s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut 200 in 41ms (compile: 26ms, proxy.ts: 9ms, render: 6ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 842ms for path "project"
[VFS LIST] [cqb057] GET /api/filesystem/list path="project" (polling=true, count=4)
[VFS LIST] [cqb057] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [cqb057] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project 200 in 21ms (compile: 7ms, proxy.ts: 6ms, render: 8ms)
[VFS SNAPSHOT] [cz4m96] GET /api/filesystem/snapshot path="project" (polling=false, count=3)
[VFS SNAPSHOT] [cz4m96] Cache hit (age: 1s)
 GET /api/filesystem/snapshot?path=project 200 in 28ms (compile: 16ms, proxy.ts: 6ms, render: 6ms)
[VFS LIST] [islt47] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=1)
[VFS LIST] [islt47] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [islt47] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 15ms (compile: 4ms, proxy.ts: 5ms, render: 6ms)
Database base schema initialized
Database initialized successfully
[session-store] Using SQLite for session persistence
[Blaxel] Database initialized for callback secrets (encrypted)
[E2BProvider] Initialized - Template: "base", Timeout: 300000ms
[2026-03-23T07:05:02.739Z] [INFO] [Terminal:SessionManager] Using SQLite for terminal session persistence
[DEPRECATED] terminal-session-store.ts is deprecated. Use terminal-session-manager.ts instead.
[DEPRECATED] user-terminal-sessions.ts is deprecated. Use terminal-session-manager.ts instead.
[DEPRECATED] agent-session-manager.ts is deprecated. Use lib/session/session-manager.ts instead.
[MCP] .env.mcp not found, using main .env for MCP config
No pending migrations
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
[Auth0] Initializing Auth0Client {
  domain: 'dev-4k1jowzqmjuqjxzp.us.auth0.com',
  clientId: 'FeUG2aHizhWMaZWEO8xfhpMpEA1ClgXF',
  hasSecret: true,
  baseUrl: 'http://localhost:3000'
}
[2026-03-23T07:05:03.339Z] [WARN] [Telemetry:ResponseRouter] Failed to initialize OpenTelemetry, using in-memory metrics only: Resource class not found in @opentelemetry/resources
2026-03-23T07:05:03.364Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx user:1]: Anonymous request (no auth token/session) { authSuccess: true }
2026-03-23T07:05:03.368Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx]: Request body validated {
  messageCount: 1,
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free',
  stream: true,
  userId: '1'
}
[ChatRequestLogger] Database initialized
2026-03-23T07:05:03.369Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Selected provider { supportsStreaming: true }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Creating new workspace { ownerId: '1' }
[VFS] Loading workspace from storage { ownerId: '1' }
[Logger] File logging enabled: ./logs/run.log
[VFS] ensureWorkspace called { ownerId: '1' }
2026-03-23T07:05:03.430Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Validation passed, routing through priority chain {
  requestId: 'chat_1774249503361_eLK6YRyAx',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-23T07:05:08.417Z [ERROR] Chat API [req:chat_1774249503361_eLK6YRyAx]: V2 execution failed, falling back to v1 {
  error: 'fetch failed',
  stack: 'TypeError: fetch failed\n' +
    '    at node:internal/deps/undici/undici:14902:13\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n' +
    '    at async handleGatewayStreaming (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:1450:25)\n' +
    '    at async POST (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:339:28)\n' +
    '    at async AppRouteRouteModule.do (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:37866)\n' +
    '    at async AppRouteRouteModule.handle (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:45156)\n' +
    '    at async responseGenerator (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_43054031._.js:16540:38)\n' +
    '    at async AppRouteRouteModule.handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:1:191938)\n' +
    '    at async handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_43054031._.js:16603:32)\n' +
    '    at async Module.handler (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_43054031._.js:16656:13)\n' +
    '    at async DevServer.renderToResponseWithComponentsImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1442:9)\n' +
    '    at async DevServer.renderPageComponent (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1494:24)\n' +
    '    at async DevServer.renderToResponseImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1544:32)\n' +
    '    at async DevServer.pipeImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1038:25)\n' +
    '    at async NextNodeServer.handleCatchallRenderRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\next-server.js:395:17)\n' +
    '    at async DevServer.handleRequestImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:929:17)\n' +
    '    at async C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:387:20\n' +
    '    at async Span.traceAsyncFn (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\trace\\trace.js:157:20)\n' +
    '    at async DevServer.handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:383:24)\n' +
    '    at async invokeRender (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:248:21)\n' +
    '    at async handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:447:24)\n' +
    '    at async requestHandlerImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:496:13)\n' +
    '    at async Server.requestListener (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\start-server.js:226:13)'
}
2026-03-23T07:05:08.417Z [INFO] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Using v1 fallback path after V2 failure {
  requestId: 'chat_1774249503361_eLK6YRyAx',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-23T07:05:08.418Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Routing request through priority chain {
  requestType: 'chat',
  enableTools: undefined,
  enableSandbox: undefined,
  enableComposio: undefined,
  mode: 'max'
}
[2026-03-23T07:05:08.453Z] [DEBUG] [Model:Ranker] Model stats retrieved { totalModels: 0, fromChatLogger: 0, fromProviderTelemetry: 0 }
[2026-03-23T07:05:08.454Z] [INFO] [API:ResponseRouter] Spec amplification enabled {
  fastModel: undefined,
  mode: 'max',
  provider: undefined,
  fromTelemetry: true
}
[2026-03-23T07:05:08.456Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-23T07:05:08.457Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx user:1 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
2026-03-23T07:05:08.493Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider {
  messageCount: 2,
  temperature: 0.7,
  maxTokens: 100096,
  apiKeySet: true,
  requestHasKey: true
}
[2026-03-23T07:05:08.508Z] [DEBUG] [Model:Ranker] Model stats retrieved { totalModels: 0, fromChatLogger: 0, fromProviderTelemetry: 0 }
[2026-03-23T07:05:08.509Z] [DEBUG] [Model:Ranker] Model stats retrieved { totalModels: 0, fromChatLogger: 0, fromProviderTelemetry: 0 }
2026-03-23T07:05:08.510Z [DEBUG] Chat API [req:spec-1774249508509-vmy7xaz provider:mistral]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: undefined,
  enableSandbox: undefined,
  fallbackProviders: undefined
}
[ChatRequestLogger] Failed to log request start: SqliteError: NOT NULL constraint failed: chat_request_logs.model
    at ChatRequestLogger.logRequestStart (lib\chat\chat-request-logger.ts:154:12)
    at async EnhancedLLMService.generateResponse (lib\chat\enhanced-llm-service.ts:219:7)
    at async ResponseRouter.routeWithSpecAmplification (lib\api\response-router.ts:1947:47)
    at async POST (app\api\chat\route.ts:658:27)
  152 |       const requestSize = JSON.stringify(messages).length;
  153 |
> 154 |       stmt.run(
      |            ^
  155 |         requestId,
  156 |         userId,
  157 |         provider, {
  code: 'SQLITE_CONSTRAINT_NOTNULL'
}
2026-03-23T07:05:08.653Z [DEBUG] Chat API [req:spec-1774249508509-vmy7xaz provider:mistral]: Calling provider {
  messageCount: 2,
  temperature: undefined,
  maxTokens: 2000,
  apiKeySet: true,
  requestHasKey: true
}
2026-03-23T07:05:08.758Z [ERROR] Chat API [provider:mistral]: LLM provider request failed {
  latencyMs: 3,
  error: 'Input validation failed: [\n' +
    '  {\n' +
    '    "code": "invalid_type",\n' +
    '    "expected": "string",\n' +
    '    "received": "undefined",\n' +
    '    "path": [\n' +
    '      "model"\n' +
    '    ],\n' +
    '    "message": "Required"\n' +
    '  }\n' +
    ']'
}
2026-03-23T07:05:08.762Z [DEBUG] Chat API [req:spec-1774249508509-vmy7xaz provider:mistral]: Provider call failed {
  latencyMs: 109,
  error: 'LLM request failed: Input validation failed: [\n' +
    '  {\n' +
    '    "code": "invalid_type",\n' +
    '    "expected": "string",\n' +
    '    "received": "undefined",\n' +
    '    "path": [\n' +
    '      "model"\n' +
    '    ],\n' +
    '    "message": "Required"\n' +
    '  }\n' +
    ']'
}
2026-03-23T07:05:08.763Z [WARN] Chat API [req:spec-1774249508509-vmy7xaz provider:mistral]: Primary provider failed {
  latencyMs: 253,
  error: 'Service error from mistral: LLM request failed: Input validation failed: [\n' +
    '  {\n' +
    '    "code": "invalid_type",\n' +
    '    "expected": "string",\n' +
    '    "received": "undefined",\n' +
    '    "path": [\n' +
    '      "model"\n' +
    '    ],\n' +
    '    "message": "Required"\n' +
    '  }\n' +
    ']'
}
2026-03-23T07:05:08.763Z [INFO] Chat API [req:spec-1774249508509-vmy7xaz provider:openrouter]: Trying fallback provider { attempt: 1, totalFallbacks: 3 }
2026-03-23T07:05:08.764Z [WARN] Chat API [req:spec-1774249508509-vmy7xaz provider:openrouter]: Fallback provider failed {
  latencyMs: 1,
  attempt: 1,
  error: "Cannot read properties of undefined (reading 'match')"
}
2026-03-23T07:05:08.765Z [INFO] Chat API [req:spec-1774249508509-vmy7xaz provider:google]: Trying fallback provider { attempt: 2, totalFallbacks: 3 }
2026-03-23T07:05:08.766Z [WARN] Chat API [req:spec-1774249508509-vmy7xaz provider:google]: Fallback provider failed {
  latencyMs: 1,
  attempt: 2,
  error: "Cannot read properties of undefined (reading 'match')"
}
2026-03-23T07:05:08.766Z [INFO] Chat API [req:spec-1774249508509-vmy7xaz provider:github]: Trying fallback provider { attempt: 3, totalFallbacks: 3 }
2026-03-23T07:05:08.767Z [WARN] Chat API [req:spec-1774249508509-vmy7xaz provider:github]: Fallback provider failed {
  latencyMs: 1,
  attempt: 3,
  error: "Cannot read properties of undefined (reading 'match')"
}
[2026-03-23T07:05:08.768Z] [ERROR] [API:ResponseRouter] Spec amplification failed
[2026-03-23T07:05:08.769Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-23T07:05:08.769Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx user:1 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
2026-03-23T07:05:08.770Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider {
  messageCount: 2,
  temperature: 0.7,
  maxTokens: 100096,
  apiKeySet: true,
  requestHasKey: true
}
2026-03-23T07:05:16.960Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 8205,
  tokensUsed: 2385,
  finishReason: 'stop',
  contentLength: 5434
}
2026-03-23T07:05:16.961Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 8468, tokensUsed: 2385, finishReason: 'stop' }
2026-03-23T07:05:16.961Z [INFO] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 8504, tokensUsed: 2385, finishReason: 'stop' }
2026-03-23T07:05:17.872Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 9101,
  tokensUsed: 2172,
  finishReason: 'stop',
  contentLength: 3250
}
2026-03-23T07:05:17.873Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 9103, tokensUsed: 2172, finishReason: 'stop' }
2026-03-23T07:05:17.874Z [INFO] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 9104, tokensUsed: 2172, finishReason: 'stop' }
2026-03-23T07:05:17.874Z [INFO] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Request handled by response router { source: 'original-system', priority: 1, fallbackChain: undefined }
2026-03-23T07:05:17.875Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx]: Starting filesystem edits processing { requestId: 'chat_1774249503361_eLK6YRyAx' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/index.html',
  contentLength: 341
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:05:17.884Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onex8/index.html v22
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 8b225bc1-f2f1-4d2e-9277-30ca281d3543
[2026-03-23T07:05:17.890Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/index.html
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/style.css',
  contentLength: 200
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:05:17.893Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onex8/style.css v23
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/style.css'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 2a866092-4db3-4bf9-8875-88e6e965140e
[2026-03-23T07:05:17.900Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/style.css
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/script.js',
  contentLength: 1202
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:05:17.905Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onex8/script.js v24
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/script.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: b8af1fa9-3880-4722-8810-b3f7a1a02255
[2026-03-23T07:05:17.910Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/script.js
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/README.md',
  contentLength: 843
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:05:17.913Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onex8/README.md v25
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/README.md'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: b8e648bf-943c-417d-bc37-da8bbd4c9085
[2026-03-23T07:05:17.928Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/README.md
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/index.html',
  contentLength: 342
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/onex8/index.html { timeSinceLastWrite: 49, previousVersion: 1 }
[2026-03-23T07:05:17.932Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/index.html v26
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 35db085c-3994-40f4-995b-7117417349cb
[2026-03-23T07:05:17.942Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/index.html
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/style.css',
  contentLength: 201
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/onex8/style.css { timeSinceLastWrite: 55, previousVersion: 1 }
[2026-03-23T07:05:17.948Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/style.css v27
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/style.css'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: c50766e3-ffac-4841-9dca-2c7e39e754b4
[2026-03-23T07:05:17.955Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/style.css
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/script.js',
  contentLength: 1203
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/onex8/script.js { timeSinceLastWrite: 55, previousVersion: 1 }
[2026-03-23T07:05:17.959Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/script.js v28
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/script.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 873371be-b51a-4e01-801f-e35e33da55d4
[2026-03-23T07:05:17.966Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/script.js
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/README.md',
  contentLength: 844
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/onex8/README.md { timeSinceLastWrite: 56, previousVersion: 1 }
[2026-03-23T07:05:17.970Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/README.md v29
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/README.md'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 2a6d6de2-7ca0-4d56-bd4d-e19f66b07547
[2026-03-23T07:05:17.978Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/README.md
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: 'onex8',
  transactionCount: 8,
  message: 'Auto-commit: write project/sessions/onex8/index.html, write project/sessions/onex8/style.css, write project/sessions/onex8/script.js, write project/sessions/onex8/README.md, write project/sessions/onex8/index.html, write project/sessions/onex8/style.css, write project/sessions/onex8/script.js, write project/sessions/onex8/README.md'
}
[ShadowCommit] Generating diffs for 8 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 927a9ed3-9ef5-4576-9c38-acb9ed10e984
2026-03-23T07:05:17.992Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx]: Filesystem edits processed { requestId: 'chat_1774249503361_eLK6YRyAx', appliedCount: 8 }
2026-03-23T07:05:17.994Z [DEBUG] Chat API [req:chat_1774249503361_eLK6YRyAx]: Checking streaming conditions {
  requestId: 'chat_1774249503361_eLK6YRyAx',
  stream: true,
  supportsStreaming: true
}
2026-03-23T07:05:17.997Z [INFO] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Starting streaming response {
  eventsCount: 167,
  hasFilesystemEdits: true,
  appliedEditsCount: 8,
  requestedFilesCount: 0
}
[2026-03-23T07:05:18.370Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 2, errors: 0, avgDurationMs: 8808 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-23T07:05:25.207Z [INFO] Chat API [req:chat_1774249503361_eLK6YRyAx provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Stream completed successfully { chunkCount: 173, latencyMs: 7212, eventsCount: 167, tokenCount: 164 }
 POST /api/chat 200 in 26.5s (compile: 4.6s, proxy.ts: 7ms, render: 21.9s)
[VFS LIST] [4q3iu2] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=1)
[VFS LIST] [4q3iu2] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [4q3iu2] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 16ms (compile: 3ms, proxy.ts: 5ms, render: 8ms)
[VFS SNAPSHOT] [ow5js2] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [ow5js2] Snapshot: 0 files in 2ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [ow5js2] STALE SNAPSHOT: last updated 649s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 15ms (compile: 4ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [kfrvax] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=2)
[VFS LIST] [kfrvax] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [kfrvax] Listed 0 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 17ms (compile: 5ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [btb1kn] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [btb1kn] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [btb1kn] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 15ms (compile: 5ms, proxy.ts: 3ms, render: 6ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/folderrrrrManual/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/folderrrrrManual/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/folderrrrrManual/.keep',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:05:57.618Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/folderrrrrManual/.keep v30
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/folderrrrrManual/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: c33ad956-6874-42de-850b-d169063d4334
[2026-03-23T07:05:57.626Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/folderrrrrManual/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:folderrrrrManual',
  transactionCount: 1,
  message: 'filesystem write: project/sessions/folderrrrrManual/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: b90e16a2-4ad0-468e-9f3e-addb13404312
 POST /api/filesystem/write 200 in 202ms (compile: 166ms, proxy.ts: 11ms, render: 26ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/folderrrrrManual/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/folderrrrrManual/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/folderrrrrManual/.keep',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/folderrrrrManual/.keep { timeSinceLastWrite: 60, previousVersion: 1 }
[2026-03-23T07:05:57.678Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/folderrrrrManual/.keep v31
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/folderrrrrManual/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 2a92f469-7651-4c59-88ea-51f551e96acc
[2026-03-23T07:05:57.686Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/folderrrrrManual/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:folderrrrrManual',
  transactionCount: 1,
  message: 'use-virtual-filesystem-opfs write: project/sessions/folderrrrrManual/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 5297788b-d5e9-4d23-a907-5e8f01f849b9
 POST /api/filesystem/write 200 in 58ms (compile: 8ms, proxy.ts: 6ms, render: 43ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/cantseeFiles.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/cantseeFiles.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/cantseeFiles.txt',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:06:18.693Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/cantseeFiles.txt v32
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/cantseeFiles.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: cf90c633-61ab-4882-82f7-35b6c57f2a28
[2026-03-23T07:06:18.700Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/cantseeFiles.txt
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:cantseeFiles.txt',
  transactionCount: 1,
  message: 'filesystem write: project/sessions/cantseeFiles.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 4a1bffd0-c491-4194-8313-d0059a0c264e
 POST /api/filesystem/write 200 in 36ms (compile: 6ms, proxy.ts: 7ms, render: 23ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/cantseeFiles.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/cantseeFiles.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/cantseeFiles.txt',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/cantseeFiles.txt { timeSinceLastWrite: 30, previousVersion: 1 }
[2026-03-23T07:06:18.725Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/cantseeFiles.txt v33
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/cantseeFiles.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 812da973-4b86-4b71-bbcf-8a16001af82b
[2026-03-23T07:06:18.731Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/cantseeFiles.txt
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:cantseeFiles.txt',
  transactionCount: 1,
  message: 'use-virtual-filesystem-opfs write: project/sessions/cantseeFiles.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 11643980-34b2-4e17-91b8-545d12004fb5
 POST /api/filesystem/write 200 in 29ms (compile: 4ms, proxy.ts: 4ms, render: 21ms)
[VFS LIST] [jzpe5g] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [jzpe5g] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [jzpe5g] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 17ms (compile: 5ms, proxy.ts: 5ms, render: 7ms)
[VFS LIST] [rorwap] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [rorwap] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [rorwap] Listed 0 entries in 2ms
 GET /api/filesystem/list?path=project 200 in 13ms (compile: 3ms, proxy.ts: 3ms, render: 6ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called { ownerId: '1', filePath: 'project/sessions/.keep', contentLength: 0 }
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:06:34.712Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/.keep v34
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 73564180-df0a-4214-8eca-e1427501e7dd
[2026-03-23T07:06:34.720Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:.keep',
  transactionCount: 1,
  message: 'filesystem write: project/sessions/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 17fe6fd0-08f4-45e9-bef6-0b20b67ca02a
 POST /api/filesystem/write 200 in 30ms (compile: 4ms, proxy.ts: 6ms, render: 21ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called { ownerId: '1', filePath: 'project/sessions/.keep', contentLength: 0 }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/.keep { timeSinceLastWrite: 40, previousVersion: 1 }
[2026-03-23T07:06:34.753Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/.keep v35
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: fd48a0ca-8b79-46aa-870a-1a7fccefb5d2
[2026-03-23T07:06:34.762Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:.keep',
  transactionCount: 1,
  message: 'use-virtual-filesystem-opfs write: project/sessions/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 9afe9bef-7be2-4963-9302-24a7a2e86959
 POST /api/filesystem/write 200 in 31ms (compile: 4ms, proxy.ts: 5ms, render: 23ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/session/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/session/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called { ownerId: '1', filePath: 'project/session/.keep', contentLength: 0 }
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:06:39.374Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/session/.keep v36
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/session/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: e2081db4-ec76-4adb-b235-b13f4a68e2ba
[2026-03-23T07:06:39.380Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/session/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/write 200 in 37ms (compile: 5ms, proxy.ts: 7ms, render: 25ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/session/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/session/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called { ownerId: '1', filePath: 'project/session/.keep', contentLength: 0 }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/session/.keep { timeSinceLastWrite: 41, previousVersion: 1 }
[2026-03-23T07:06:39.416Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/session/.keep v37
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/session/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 29f43a79-82bf-4cb2-a116-efb1971a1b3e
[2026-03-23T07:06:39.423Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/session/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/write 200 in 35ms (compile: 5ms, proxy.ts: 7ms, render: 22ms)
[VFS LIST] [i3788k] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=1)
[VFS LIST] [i3788k] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [i3788k] Listed 0 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 15ms (compile: 3ms, proxy.ts: 5ms, render: 7ms)
[VFS SNAPSHOT] [6ge1l3] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [6ge1l3] Snapshot: 0 files in 4ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [6ge1l3] STALE SNAPSHOT: last updated 727s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 40ms (compile: 12ms, proxy.ts: 16ms, render: 12ms)
[VFS LIST] [j8jmji] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=2)
[VFS LIST] [j8jmji] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [j8jmji] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 28ms (compile: 7ms, proxy.ts: 7ms, render: 13ms)
[VFS LIST] [ee95p7] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [ee95p7] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [ee95p7] Listed 0 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 18ms (compile: 5ms, proxy.ts: 5ms, render: 8ms)
[VFS SNAPSHOT] [ju40pq] GET /api/filesystem/snapshot path="project/sessions/oneut" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [ju40pq] Snapshot: 0 files in 6ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [ju40pq] STALE SNAPSHOT: last updated 738s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut 200 in 43ms (compile: 16ms, proxy.ts: 10ms, render: 17ms)
[2026-03-23T07:07:08.608Z] [INFO] [WebSocketTerminal] WebSocket terminal server listening on port 8080
[Backend] Initialized successfully
 POST /api/backend 200 in 2.5s (compile: 2.5s, proxy.ts: 6ms, render: 9ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/WTF/.keep',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:07:28.858Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/WTF/.keep v38
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/WTF/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: c1daa53f-8fed-4300-bacd-2ca94a577883
[2026-03-23T07:07:28.872Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/WTF/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'terminal write: project/sessions/oneut/WTF/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: bc6c8774-6ee0-4fcb-b905-b7c598ea7ae7
 POST /api/filesystem/write 200 in 40ms (compile: 4ms, proxy.ts: 5ms, render: 31ms)
[VFS LIST] [2hqgtx] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [2hqgtx] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [2hqgtx] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project 200 in 17ms (compile: 4ms, proxy.ts: 5ms, render: 8ms)
[VFS SNAPSHOT] [566nt4] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [566nt4] Snapshot: 0 files in 2ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [566nt4] STALE SNAPSHOT: last updated 760s ago
 GET /api/filesystem/snapshot?path=project 200 in 19ms (compile: 3ms, proxy.ts: 8ms, render: 8ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/file.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/file.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/WTF/file.txt',
  contentLength: 5
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:07:46.597Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/oneut/WTF/file.txt v39
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/WTF/file.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: fd1ebab7-bf2f-41dc-8bb2-eeee360804b6
[2026-03-23T07:07:46.603Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/WTF/file.txt
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'terminal write: project/sessions/oneut/WTF/file.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 939fb3eb-7aa9-42ad-ac3b-fb6686afc13b
 POST /api/filesystem/write 200 in 26ms (compile: 3ms, proxy.ts: 5ms, render: 17ms)
[2026-03-23T07:07:56.522Z] [DEBUG] [SessionStore] Getting active session for user: 1
[2026-03-23T07:07:56.523Z] [DEBUG] [SessionStore] No active session found for user 1
[2026-03-23T07:07:56.523Z] [DEBUG] [SessionStore] Getting active session for user: 1
[2026-03-23T07:07:56.524Z] [DEBUG] [SessionStore] No active session found for user 1
[2026-03-23T07:07:56.555Z] [DEBUG] [SandboxService] SandboxService initialized with primary provider: daytona
[2026-03-23T07:07:56.556Z] [INFO] [SandboxService] Creating workspace for user 1 with custom config
[QuotaManager] Loaded 10 provider quotas from database
[2026-03-23T07:07:56.567Z] [DEBUG] [SandboxService] Preferred provider type: daytona
[2026-03-23T07:07:56.568Z] [DEBUG] [SandboxService] Getting candidate provider types, primary: daytona
[2026-03-23T07:07:56.569Z] [DEBUG] [SandboxService] Checking provider availability: daytona
[2026-03-23T07:07:56.569Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: daytona
[2026-03-23T07:07:56.600Z] [DEBUG] [SandboxProviders] Starting initialization for provider daytona
[2026-03-23T07:07:56.601Z] [DEBUG] [SandboxProviders] Provider daytona initialization attempt 1/3
[Daytona] Initialized - API Key configured: true
[2026-03-23T07:08:15.437Z] [INFO] [SandboxProviders] Provider daytona initialized successfully in 18.837s
[2026-03-23T07:08:15.438Z] [DEBUG] [SandboxService] Provider daytona is available
[2026-03-23T07:08:15.438Z] [DEBUG] [SandboxService] Checking provider availability: e2b
[2026-03-23T07:08:15.438Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: e2b
[2026-03-23T07:08:15.439Z] [DEBUG] [SandboxProviders] Starting initialization for provider e2b
[2026-03-23T07:08:15.439Z] [DEBUG] [SandboxProviders] Provider e2b initialization attempt 1/3
[E2BProvider] Initialized - Template: "base", Timeout: 300000ms
[2026-03-23T07:08:15.441Z] [INFO] [SandboxProviders] Provider e2b initialized successfully in 0.002s
[2026-03-23T07:08:15.441Z] [DEBUG] [SandboxService] Provider e2b is available
[2026-03-23T07:08:15.441Z] [DEBUG] [SandboxService] Checking provider availability: mistral-agent
[2026-03-23T07:08:15.442Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: mistral-agent
[2026-03-23T07:08:15.442Z] [DEBUG] [SandboxProviders] Starting initialization for provider mistral-agent
[2026-03-23T07:08:15.442Z] [DEBUG] [SandboxProviders] Provider mistral-agent initialization attempt 1/3
[2026-03-23T07:08:15.444Z] [INFO] [SandboxProviders] Provider mistral-agent initialized successfully in 0.002s
[2026-03-23T07:08:15.444Z] [DEBUG] [SandboxService] Provider mistral-agent is available
[2026-03-23T07:08:15.445Z] [DEBUG] [SandboxService] Checking provider availability: runloop
[2026-03-23T07:08:15.445Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: runloop
[2026-03-23T07:08:15.445Z] [DEBUG] [SandboxProviders] Starting initialization for provider runloop
[2026-03-23T07:08:15.446Z] [DEBUG] [SandboxProviders] Provider runloop initialization attempt 1/3
[RunloopProvider] Initialized - Client configured: true
[2026-03-23T07:08:15.539Z] [INFO] [SandboxProviders] Provider runloop initialized successfully in 0.094s
[2026-03-23T07:08:15.539Z] [DEBUG] [SandboxService] Provider runloop is available
[2026-03-23T07:08:15.540Z] [DEBUG] [SandboxService] Checking provider availability: microsandbox
[2026-03-23T07:08:15.540Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: microsandbox
[2026-03-23T07:08:15.540Z] [DEBUG] [SandboxProviders] Starting initialization for provider microsandbox
[2026-03-23T07:08:15.541Z] [DEBUG] [SandboxProviders] Provider microsandbox initialization attempt 1/3
[Microsandbox] Provider initialized
[2026-03-23T07:08:15.542Z] [INFO] [SandboxProviders] Provider microsandbox initialized successfully in 0.002s
[2026-03-23T07:08:15.542Z] [DEBUG] [SandboxService] Provider microsandbox is available
[2026-03-23T07:08:15.543Z] [DEBUG] [SandboxService] Checking provider availability: sprites
[2026-03-23T07:08:15.543Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: sprites
[2026-03-23T07:08:15.544Z] [DEBUG] [SandboxProviders] Starting initialization for provider sprites
[2026-03-23T07:08:15.544Z] [DEBUG] [SandboxProviders] Provider sprites initialization attempt 1/3
[Sprites] Initialized - Region: "iad", Plan: "standard-1", Checkpoints: true
[2026-03-23T07:08:15.545Z] [INFO] [SandboxProviders] Provider sprites initialized successfully in 0.001s
[2026-03-23T07:08:15.545Z] [DEBUG] [SandboxService] Provider sprites is available
[2026-03-23T07:08:15.546Z] [DEBUG] [SandboxService] Checking provider availability: codesandbox
[2026-03-23T07:08:15.546Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: codesandbox
[2026-03-23T07:08:15.546Z] [DEBUG] [SandboxProviders] Starting initialization for provider codesandbox
[2026-03-23T07:08:15.547Z] [DEBUG] [SandboxProviders] Provider codesandbox initialization attempt 1/3
[2026-03-23T07:08:15.547Z] [INFO] [SandboxProviders] Provider codesandbox initialized successfully in 0.001s
[2026-03-23T07:08:15.547Z] [DEBUG] [SandboxService] Provider codesandbox is available
[2026-03-23T07:08:15.548Z] [DEBUG] [SandboxService] Candidate providers: daytona, e2b, mistral-agent, runloop, microsandbox, sprites, codesandbox
[2026-03-23T07:08:15.548Z] [DEBUG] [SandboxService] Candidate types for workspace creation: daytona, e2b, mistral-agent, runloop, microsandbox, sprites, codesandbox
[2026-03-23T07:08:15.548Z] [DEBUG] [SandboxService] Using direct provider chain (warm pool disabled or custom config)
[2026-03-23T07:08:15.549Z] [DEBUG] [SandboxService] Attempting to create sandbox with provider: daytona
[2026-03-23T07:08:15.549Z] [DEBUG] [SandboxService] Creating sandbox with provider daytona for user 1
[2026-03-23T07:08:15.550Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: daytona
[2026-03-23T07:08:15.550Z] [DEBUG] [SandboxProviders] Provider daytona already initialized and healthy
[2026-03-23T07:08:15.550Z] [DEBUG] [SandboxService] Provider daytona instance obtained, creating sandbox...
[Daytona] Creating sandbox - Language: "typescript", Image: "node:20-slim", User: 1
[Daytona] Sandbox params: {
  "image": "node:20-slim",
  "autoStopInterval": 60,
  "resources": {
    "cpu": 1,
    "memory": 2
  },
  "hasEnvVars": true,
  "hasLabels": true,
  "useCache": true
}
[Daytona] Persistent cache requested but SANDBOX_CACHE_VOLUME_ID is missing or not a valid UUID (got: "global-package-cache"). Skipping volume mount to avoid sandbox creation failure. Set SANDBOX_CACHE_VOLUME_ID to the UUID shown in your Daytona dashboard.
  follow-redirects options {
  maxRedirects: 21,
  maxBodyLength: Infinity,
  protocol: 'https:',
  path: '/api/sandbox',
  method: 'POST',
  headers: [Object: null prototype] {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Authorization: 'Bearer your_daytona_api_key_here',
    'X-Daytona-Source': 'typescript-sdk',
    'X-Daytona-SDK-Version': '0.143.0',
    'User-Agent': 'axios/1.13.6',
    'Content-Length': '175',
    'Accept-Encoding': 'gzip, compress, deflate, br'
  },
  agents: { http: undefined, https: undefined },
  auth: undefined,
  family: undefined,
  beforeRedirect: [Function: dispatchBeforeRedirect],
  beforeRedirects: { proxy: [Function: beforeRedirect] },
  http2Options: undefined,
  hostname: 'app.daytona.io',
  port: '',
  agent: undefined,
  nativeProtocols: {
    'http:': {
      _connectionListener: [Function: connectionListener],
      METHODS: [Array],
      STATUS_CODES: [Object],
      Agent: [Function],
      ClientRequest: [Function: ClientRequest],
      IncomingMessage: [Function: IncomingMessage],
      OutgoingMessage: [Function: OutgoingMessage],
      Server: [Function: Server],
      ServerResponse: [Function: ServerResponse],
      createServer: [Function: createServer],
      validateHeaderName: [Function],
      validateHeaderValue: [Function],
      get: [Function: get],
      request: [Function: request],
      setMaxIdleHTTPParsers: [Function: setMaxIdleHTTPParsers],
      maxHeaderSize: [Getter],
      globalAgent: [Getter/Setter]
    },
    'https:': {
      Agent: [Function: Agent],
      globalAgent: [Agent],
      Server: [Function: Server],
      createServer: [Function: createServer],
      get: [Function: get],
      request: [Function: request]
    }
  }
} +0ms
[Daytona] ✗ Failed to create sandbox: Invalid credentials
[Daytona] Error details: { name: 'DaytonaError', message: 'Invalid credentials' }
[2026-03-23T07:08:15.713Z] [WARN] [SandboxService] Provider failed (daytona): Invalid credentials; trying next fallback
[2026-03-23T07:08:15.714Z] [DEBUG] [SandboxService] Attempting to create sandbox with provider: e2b
[2026-03-23T07:08:15.714Z] [DEBUG] [SandboxService] Creating sandbox with provider e2b for user 1
[2026-03-23T07:08:15.714Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: e2b
[2026-03-23T07:08:15.715Z] [DEBUG] [SandboxProviders] Provider e2b already initialized and healthy
[2026-03-23T07:08:15.715Z] [DEBUG] [SandboxService] Provider e2b instance obtained, creating sandbox...
[E2BProvider] Creating sandbox - Language: "typescript", Template: "base", User: 1
[E2BProvider] Sandbox options: {
  "template": "base",
  "timeout": 300000,
  "hasMetadata": true,
  "hasEnvVars": true
}
[E2BProvider] ✗ Failed to create sandbox: Unauthorized, please check your credentials. - authorization header is malformed
[E2BProvider] Error details: {
  name: 'AuthenticationError',
  message: 'Unauthorized, please check your credentials. - authorization header is malformed',
  stack: 'AuthenticationError: Unauthorized, please check your credentials. - authorization header is malformed\n' +
    '    at handleApiError (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\e2b\\dist\\index.js:372:14)\n' +
    '    at SandboxApi.createSandbox (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\e2b\\dist\\index.js:3021:17)'
}
[2026-03-23T07:08:19.938Z] [WARN] [SandboxService] Provider failed (e2b): Unauthorized, please check your credentials. - authorization header is malformed; trying next fallback
[2026-03-23T07:08:19.938Z] [DEBUG] [SandboxService] Attempting to create sandbox with provider: mistral-agent
[2026-03-23T07:08:19.939Z] [DEBUG] [SandboxService] Creating sandbox with provider mistral-agent for user 1
[2026-03-23T07:08:19.939Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: mistral-agent
[2026-03-23T07:08:19.940Z] [DEBUG] [SandboxProviders] Provider mistral-agent already initialized and healthy
[2026-03-23T07:08:19.940Z] [DEBUG] [SandboxService] Provider mistral-agent instance obtained, creating sandbox...
[MistralAgent] Failed to create sandbox: API error occurred: Status 404 Content-Type "application/json; charset=utf-8"
Body: {
  "message":"no Route matched with those values",
  "request_id":"a46f2a070f6ac5492ca31328e9843261"
}
[2026-03-23T07:08:20.067Z] [WARN] [SandboxService] Provider failed (mistral-agent): Failed to create Mistral agent sandbox: API error occurred: Status 404 Content-Type "application/json; charset=utf-8"
Body: {
  "message":"no Route matched with those values",
  "request_id":"a46f2a070f6ac5492ca31328e9843261"
}. Ensure MISTRAL_API_KEY is set and valid.; trying next fallback
[2026-03-23T07:08:20.068Z] [DEBUG] [SandboxService] Attempting to create sandbox with provider: runloop
[2026-03-23T07:08:20.068Z] [DEBUG] [SandboxService] Creating sandbox with provider runloop for user 1
[2026-03-23T07:08:20.069Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: runloop
[2026-03-23T07:08:20.069Z] [DEBUG] [SandboxProviders] Provider runloop already initialized and healthy
[2026-03-23T07:08:20.070Z] [DEBUG] [SandboxService] Provider runloop instance obtained, creating sandbox...
[Runloop] Creating sandbox - User: 1, Language: typescript
[Runloop] ✗ Failed to create sandbox: Cannot read properties of undefined (reading 'create')
[2026-03-23T07:08:20.071Z] [WARN] [SandboxService] Provider failed (runloop): Cannot read properties of undefined (reading 'create'); trying next fallback
[2026-03-23T07:08:20.071Z] [DEBUG] [SandboxService] Attempting to create sandbox with provider: microsandbox
[2026-03-23T07:08:20.072Z] [DEBUG] [SandboxService] Creating sandbox with provider microsandbox for user 1
[2026-03-23T07:08:20.072Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: microsandbox
[2026-03-23T07:08:20.072Z] [DEBUG] [SandboxProviders] Provider microsandbox already initialized and healthy
[2026-03-23T07:08:20.073Z] [DEBUG] [SandboxService] Provider microsandbox instance obtained, creating sandbox...
[Microsandbox] Creating sandbox - User: 1, Language: typescript
[Microsandbox] Daemon not reachable at http://127.0.0.1:5555. Starting with: msb server start --dev
[Microsandbox] ✗ Failed to create sandbox: Microsandbox daemon not reachable at 127.0.0.1:5555
[Microsandbox] Error details: {
  name: 'Error',
  message: 'Microsandbox daemon not reachable at 127.0.0.1:5555'
}

╔═══════════════════════════════════════════════════════════════════════════════╗
║  ⚠️  SECURITY WARNING: Using local fallback sandbox (NO ISOLATION)            ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  This is ONLY safe for local development. Commands will execute on your       ║
║  host system without any sandbox isolation.                                    ║
║                                                                                ║
║  For production or any multi-tenant environment:                               ║
║  1. Install microsandbox: npm install -g microsandbox                         ║
║  2. Start daemon: msb server start --dev                                      ║
║  3. Set MICROSANDBOX_ALLOW_LOCAL_FALLBACK=false                               ║
║                                                                                ║
║  This warning will not appear in production - local fallback is blocked.      ║
╚═══════════════════════════════════════════════════════════════════════════════╝

[2026-03-23T07:08:41.101Z] [DEBUG] [SandboxService] Sandbox created successfully with ID: local-1774249721100
[dep-cache] Using persistent cache volume at /opt/cache


Source path: ./app/globals.css
Setting up new context...
Finding changed files: 51.454ms
Reading changed files: 2.124s
Sorting candidates: 36.637ms
Generate rules: 756.987ms
Build stylesheet: 18.059ms
Potential classes:  34272
Active contexts:  1
JIT TOTAL: 3.438s


[VFS LIST] [yfaqlx] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=1)
[VFS LIST] [yfaqlx] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [yfaqlx] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 22ms (compile: 8ms, proxy.ts: 5ms, render: 9ms)
[VFS SNAPSHOT] [2knt02] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [2knt02] Snapshot: 0 files in 3ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [2knt02] STALE SNAPSHOT: last updated 857s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 20ms (compile: 3ms, proxy.ts: 6ms, render: 11ms)
[VFS LIST] [xssc12] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=2)
[VFS LIST] [xssc12] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [xssc12] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 29ms (compile: 9ms, proxy.ts: 9ms, render: 11ms)
[VFS LIST] [dtukmc] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [dtukmc] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [dtukmc] Listed 0 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 17ms (compile: 4ms, proxy.ts: 5ms, render: 8ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/dafqg/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/dafqg/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/dafqg/.keep',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:09:14.184Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/dafqg/.keep v40
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/dafqg/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: a5878d7e-14cf-4f77-a06f-28f31987d87f
[2026-03-23T07:09:14.193Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/dafqg/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:dafqg',
  transactionCount: 1,
  message: 'filesystem write: project/sessions/dafqg/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: ca89a9bb-bed3-457b-9cea-de38c88188ef
 POST /api/filesystem/write 200 in 39ms (compile: 4ms, proxy.ts: 10ms, render: 25ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/dafqg/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/dafqg/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/dafqg/.keep',
  contentLength: 0
}
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] Potential concurrent modification: project/sessions/dafqg/.keep { timeSinceLastWrite: 40, previousVersion: 1 }
[2026-03-23T07:09:14.225Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/dafqg/.keep v41
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/dafqg/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 3fb6358d-385c-4ffc-9976-aaafc3f58983
[2026-03-23T07:09:14.233Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/dafqg/.keep
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:dafqg',
  transactionCount: 1,
  message: 'use-virtual-filesystem-opfs write: project/sessions/dafqg/.keep'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 1c6dda1b-d4c8-4d06-b61c-bd8404a49332
 POST /api/filesystem/write 200 in 35ms (compile: 4ms, proxy.ts: 5ms, render: 26ms)
[VFS SNAPSHOT] [z39kzb] GET /api/filesystem/snapshot path="project/sessions/oneut" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [z39kzb] Snapshot: 0 files in 2ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [z39kzb] STALE SNAPSHOT: last updated 886s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut 200 in 19ms (compile: 5ms, proxy.ts: 6ms, render: 8ms)
[VFS LIST] [8j5b75] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=1)
[VFS LIST] [8j5b75] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [8j5b75] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 18ms (compile: 4ms, proxy.ts: 6ms, render: 8ms)
[VFS SNAPSHOT] [gmqxjp] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [gmqxjp] Snapshot: 0 files in 4ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [gmqxjp] STALE SNAPSHOT: last updated 888s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 25ms (compile: 6ms, proxy.ts: 7ms, render: 13ms)
[VFS LIST] [ehuu8y] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=2)
[VFS LIST] [ehuu8y] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [ehuu8y] Listed 0 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 24ms (compile: 4ms, proxy.ts: 9ms, render: 11ms)
[2026-03-23T07:09:39.890Z] [WARN] [SandboxService] Base image provisioning failed for provider=microsandbox: Command blocked by security policy: Redirect to system directory
[2026-03-23T07:09:39.893Z] [INFO] [SandboxService] Successfully created sandbox with provider microsandbox: local-1774249721100
[2026-03-23T07:09:39.894Z] [INFO] [SandboxService] Workspace session created: e04404ef-9b6f-460d-ae08-a26cee57ec98 (sandbox: local-1774249721100)
[2026-03-23T07:09:39.894Z] [DEBUG] [SessionStore] Saving session: e04404ef-9b6f-460d-ae08-a26cee57ec98 (sandbox: local-1774249721100, user: 1)
[2026-03-23T07:09:39.895Z] [DEBUG] [SessionStore] Session e04404ef-9b6f-460d-ae08-a26cee57ec98 saved to SQLite
[SandboxSync] Starting sync for local-1774249721100 (interval: 5000ms, type: standard)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:09:39.899Z] [DEBUG] [SandboxService] SandboxService initialized with primary provider: daytona
[2026-03-23T07:09:39.900Z] [DEBUG] [SandboxService] Initializing primary provider: daytona
[2026-03-23T07:09:39.901Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: daytona
[2026-03-23T07:09:39.902Z] [DEBUG] [SandboxProviders] Starting initialization for provider daytona
[2026-03-23T07:09:39.902Z] [DEBUG] [SandboxProviders] Provider daytona initialization attempt 1/3
[Daytona] Initialized - API Key configured: true
[2026-03-23T07:09:39.906Z] [INFO] [SandboxProviders] Provider daytona initialized successfully in 0.005s
[2026-03-23T07:09:39.907Z] [DEBUG] [SandboxService] Primary provider daytona initialized successfully
  follow-redirects options {
  maxRedirects: 21,
  maxBodyLength: Infinity,
  protocol: 'https:',
  path: '/api/sandbox/local-1774249721100',
  method: 'GET',
  headers: [Object: null prototype] {
    Accept: 'application/json, text/plain, */*',
    Authorization: 'Bearer your_daytona_api_key_here',
    'X-Daytona-Source': 'typescript-sdk',
    'X-Daytona-SDK-Version': '0.143.0',
    'User-Agent': 'axios/1.13.6',
    'Accept-Encoding': 'gzip, compress, deflate, br'
  },
  agents: { http: undefined, https: undefined },
  auth: undefined,
  family: undefined,
  beforeRedirect: [Function: dispatchBeforeRedirect],
  beforeRedirects: { proxy: [Function: beforeRedirect] },
  http2Options: undefined,
  hostname: 'app.daytona.io',
  port: '',
  agent: undefined,
  nativeProtocols: {
    'http:': {
      _connectionListener: [Function: connectionListener],
      METHODS: [Array],
      STATUS_CODES: [Object],
      Agent: [Function],
      ClientRequest: [Function: ClientRequest],
      IncomingMessage: [Function: IncomingMessage],
      OutgoingMessage: [Function: OutgoingMessage],
      Server: [Function: Server],
      ServerResponse: [Function: ServerResponse],
      createServer: [Function: createServer],
      validateHeaderName: [Function],
      validateHeaderValue: [Function],
      get: [Function: get],
      request: [Function: request],
      setMaxIdleHTTPParsers: [Function: setMaxIdleHTTPParsers],
      maxHeaderSize: [Getter],
      globalAgent: [Getter/Setter]
    },
    'https:': {
      Agent: [Function: Agent],
      globalAgent: [Agent],
      Server: [Function: Server],
      createServer: [Function: createServer],
      get: [Function: get],
      request: [Function: request]
    }
  }
} +1m
 POST /api/sandbox/terminal 201 in 105s (compile: 1285ms, proxy.ts: 4ms, render: 103s)
[2026-03-23T07:09:39.948Z] [DEBUG] [SessionStore] Getting active session for user: 1
[2026-03-23T07:09:39.949Z] [DEBUG] [SessionStore] Active session found for user 1: e04404ef-9b6f-460d-ae08-a26cee57ec98
[2026-03-23T07:09:39.970Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: daytona
[2026-03-23T07:09:39.970Z] [DEBUG] [SandboxProviders] Provider daytona already initialized and healthy
  follow-redirects options {
  maxRedirects: 21,
  maxBodyLength: Infinity,
  protocol: 'https:',
  path: '/api/sandbox/local-1774249721100',
  method: 'GET',
  headers: [Object: null prototype] {
    Accept: 'application/json, text/plain, */*',
    Authorization: 'Bearer your_daytona_api_key_here',
    'X-Daytona-Source': 'typescript-sdk',
    'X-Daytona-SDK-Version': '0.143.0',
    'User-Agent': 'axios/1.13.6',
    'Accept-Encoding': 'gzip, compress, deflate, br'
  },
  agents: { http: undefined, https: undefined },
  auth: undefined,
  family: undefined,
  beforeRedirect: [Function: dispatchBeforeRedirect],
  beforeRedirects: { proxy: [Function: beforeRedirect] },
  http2Options: undefined,
  hostname: 'app.daytona.io',
  port: '',
  agent: undefined,
  nativeProtocols: {
    'http:': {
      _connectionListener: [Function: connectionListener],
      METHODS: [Array],
      STATUS_CODES: [Object],
      Agent: [Function],
      ClientRequest: [Function: ClientRequest],
      IncomingMessage: [Function: IncomingMessage],
      OutgoingMessage: [Function: OutgoingMessage],
      Server: [Function: Server],
      ServerResponse: [Function: ServerResponse],
      createServer: [Function: createServer],
      validateHeaderName: [Function],
      validateHeaderValue: [Function],
      get: [Function: get],
      request: [Function: request],
      setMaxIdleHTTPParsers: [Function: setMaxIdleHTTPParsers],
      maxHeaderSize: [Getter],
      globalAgent: [Getter/Setter]
    },
    'https:': {
      Agent: [Function: Agent],
      globalAgent: [Agent],
      Server: [Function: Server],
      createServer: [Function: createServer],
      get: [Function: get],
      request: [Function: request]
    }
  }
} +61ms
[2026-03-23T07:09:40.036Z] [WARN] [TerminalAPI] Sandbox verification error (transient), keeping session { sandboxId: 'local-1774249721100', error: 'Invalid credentials' }
[2026-03-23T07:09:40.037Z] [DEBUG] [SessionStore] Getting active session for user: 1
[2026-03-23T07:09:40.037Z] [DEBUG] [SessionStore] Active session found for user 1: e04404ef-9b6f-460d-ae08-a26cee57ec98
 POST /api/sandbox/terminal 201 in 123ms (compile: 20ms, proxy.ts: 6ms, render: 96ms)
[2026-03-23T07:09:40.042Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: daytona
[2026-03-23T07:09:40.043Z] [DEBUG] [SandboxProviders] Provider daytona already initialized and healthy
[2026-03-23T07:09:40.043Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: runloop
[2026-03-23T07:09:40.043Z] [DEBUG] [SandboxProviders] Starting initialization for provider runloop
[2026-03-23T07:09:40.044Z] [DEBUG] [SandboxProviders] Provider runloop initialization attempt 1/3
[RunloopProvider] Initialized - Client configured: true
[2026-03-23T07:09:40.053Z] [INFO] [SandboxProviders] Provider runloop initialized successfully in 0.01s
[2026-03-23T07:09:40.053Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: blaxel
[2026-03-23T07:09:40.054Z] [DEBUG] [SandboxProviders] Starting initialization for provider blaxel
[2026-03-23T07:09:40.054Z] [DEBUG] [SandboxProviders] Provider blaxel initialization attempt 1/3
[2026-03-23T07:09:40.054Z] [INFO] [SandboxProviders] Provider blaxel initialized successfully in 0s
[2026-03-23T07:09:40.055Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: blaxel-mcp
[2026-03-23T07:09:40.055Z] [ERROR] [SandboxProviders] Provider blaxel-mcp is disabled
[2026-03-23T07:09:40.055Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: sprites
[2026-03-23T07:09:40.056Z] [DEBUG] [SandboxProviders] Starting initialization for provider sprites
[2026-03-23T07:09:40.056Z] [DEBUG] [SandboxProviders] Provider sprites initialization attempt 1/3
[Sprites] Initialized - Region: "iad", Plan: "standard-1", Checkpoints: true
[2026-03-23T07:09:40.057Z] [INFO] [SandboxProviders] Provider sprites initialized successfully in 0.001s
[2026-03-23T07:09:40.057Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: codesandbox
[2026-03-23T07:09:40.057Z] [DEBUG] [SandboxProviders] Starting initialization for provider codesandbox
[2026-03-23T07:09:40.058Z] [DEBUG] [SandboxProviders] Provider codesandbox initialization attempt 1/3
[2026-03-23T07:09:40.058Z] [INFO] [SandboxProviders] Provider codesandbox initialized successfully in 0.001s
[2026-03-23T07:09:40.059Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: webcontainer
[2026-03-23T07:09:40.059Z] [DEBUG] [SandboxProviders] Starting initialization for provider webcontainer
[2026-03-23T07:09:40.059Z] [DEBUG] [SandboxProviders] Provider webcontainer initialization attempt 1/3
[2026-03-23T07:09:40.060Z] [INFO] [SandboxProviders] Provider webcontainer initialized successfully in 0.001s
[2026-03-23T07:09:40.060Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: webcontainer-filesystem
[2026-03-23T07:09:40.060Z] [DEBUG] [SandboxProviders] Starting initialization for provider webcontainer-filesystem
[2026-03-23T07:09:40.060Z] [DEBUG] [SandboxProviders] Provider webcontainer-filesystem initialization attempt 1/3
[2026-03-23T07:09:40.061Z] [INFO] [SandboxProviders] Provider webcontainer-filesystem initialized successfully in 0.001s
[2026-03-23T07:09:40.061Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: webcontainer-spawn
[2026-03-23T07:09:40.061Z] [DEBUG] [SandboxProviders] Starting initialization for provider webcontainer-spawn
[2026-03-23T07:09:40.061Z] [DEBUG] [SandboxProviders] Provider webcontainer-spawn initialization attempt 1/3
[2026-03-23T07:09:40.062Z] [INFO] [SandboxProviders] Provider webcontainer-spawn initialized successfully in 0.001s
[2026-03-23T07:09:40.062Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: opensandbox
[2026-03-23T07:09:40.062Z] [DEBUG] [SandboxProviders] Starting initialization for provider opensandbox
[2026-03-23T07:09:40.063Z] [DEBUG] [SandboxProviders] Provider opensandbox initialization attempt 1/3
[2026-03-23T07:09:40.063Z] [INFO] [SandboxProviders] Provider opensandbox initialized successfully in 0.001s
[2026-03-23T07:09:40.063Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: opensandbox-code-interpreter
[2026-03-23T07:09:40.064Z] [DEBUG] [SandboxProviders] Starting initialization for provider opensandbox-code-interpreter
[2026-03-23T07:09:40.064Z] [DEBUG] [SandboxProviders] Provider opensandbox-code-interpreter initialization attempt 1/3
[2026-03-23T07:09:40.064Z] [INFO] [SandboxProviders] Provider opensandbox-code-interpreter initialized successfully in 0s
[2026-03-23T07:09:40.065Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: opensandbox-agent
[2026-03-23T07:09:40.065Z] [DEBUG] [SandboxProviders] Starting initialization for provider opensandbox-agent
[2026-03-23T07:09:40.065Z] [DEBUG] [SandboxProviders] Provider opensandbox-agent initialization attempt 1/3
[2026-03-23T07:09:40.066Z] [INFO] [SandboxProviders] Provider opensandbox-agent initialized successfully in 0.001s
[2026-03-23T07:09:40.066Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: microsandbox
[2026-03-23T07:09:40.067Z] [DEBUG] [SandboxProviders] Starting initialization for provider microsandbox
[2026-03-23T07:09:40.067Z] [DEBUG] [SandboxProviders] Provider microsandbox initialization attempt 1/3
[Microsandbox] Provider initialized
[2026-03-23T07:09:40.067Z] [INFO] [SandboxProviders] Provider microsandbox initialized successfully in 0s
[2026-03-23T07:09:40.068Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: e2b
[2026-03-23T07:09:40.068Z] [DEBUG] [SandboxProviders] Starting initialization for provider e2b
[2026-03-23T07:09:40.068Z] [DEBUG] [SandboxProviders] Provider e2b initialization attempt 1/3
[E2BProvider] Initialized - Template: "base", Timeout: 300000ms
[2026-03-23T07:09:40.069Z] [INFO] [SandboxProviders] Provider e2b initialized successfully in 0.001s
[2026-03-23T07:09:40.069Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: mistral
[2026-03-23T07:09:40.069Z] [ERROR] [SandboxProviders] Provider mistral is disabled
[2026-03-23T07:09:40.070Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: vercel-sandbox
[2026-03-23T07:09:40.070Z] [DEBUG] [SandboxProviders] Starting initialization for provider vercel-sandbox
[2026-03-23T07:09:40.070Z] [DEBUG] [SandboxProviders] Provider vercel-sandbox initialization attempt 1/3
[2026-03-23T07:09:40.126Z] [INFO] [SandboxProviders] Provider vercel-sandbox initialized successfully in 0.056s
[2026-03-23T07:09:40.127Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: runloop
[2026-03-23T07:09:40.127Z] [DEBUG] [SandboxProviders] Provider runloop already initialized and healthy
[2026-03-23T07:09:40.128Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: blaxel
[2026-03-23T07:09:40.128Z] [DEBUG] [SandboxProviders] Provider blaxel already initialized and healthy
[2026-03-23T07:09:40.129Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: sprites
[2026-03-23T07:09:40.129Z] [DEBUG] [SandboxProviders] Provider sprites already initialized and healthy
[2026-03-23T07:09:40.247Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: codesandbox
[2026-03-23T07:09:40.247Z] [DEBUG] [SandboxProviders] Provider codesandbox already initialized and healthy
[2026-03-23T07:09:40.818Z] [DEBUG] [SessionStore] Getting active session for user: 1
[2026-03-23T07:09:40.819Z] [DEBUG] [SessionStore] Active session found for user 1: e04404ef-9b6f-460d-ae08-a26cee57ec98
 POST /api/sandbox/terminal/stream 200 in 653ms (compile: 639ms, proxy.ts: 7ms, render: 7ms)
[CodeSandbox] Failed to get sandbox local-1774249721100: Error: Failed to start VM local-1774249721100: Unauthorized
    at async CodeSandboxProvider.getSandbox (lib\sandbox\providers\codesandbox-provider.ts:193:19)
    at async SandboxService.resolveProviderForSandbox (lib\sandbox\core-sandbox-service.ts:184:9)
    at async SandboxService.getHandle (lib\sandbox\core-sandbox-service.ts:196:22)
    at async SandboxService.writeFile (lib\sandbox\core-sandbox-service.ts:311:20)
    at async SandboxFilesystemSync.syncVFSToSandbox (lib\virtual-filesystem\sync\sandbox-filesystem-sync.ts:243:9)
    at async (lib\virtual-filesystem\sync\sandbox-filesystem-sync.ts:103:9)
  191 |
  192 |       try {
> 193 |         sandbox = await sdk.sandboxes.resume(sandboxId)
      |                   ^
  194 |         wasHibernated = true
  195 |         console.log(`[CodeSandbox] Resumed hibernated sandbox ${sandboxId}`)
  196 |       } catch (resumeError: any) {
[2026-03-23T07:09:42.171Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: webcontainer
[2026-03-23T07:09:42.172Z] [DEBUG] [SandboxProviders] Provider webcontainer already initialized and healthy
[2026-03-23T07:09:42.172Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: webcontainer-filesystem
[2026-03-23T07:09:42.173Z] [DEBUG] [SandboxProviders] Provider webcontainer-filesystem already initialized and healthy
[2026-03-23T07:09:42.173Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: webcontainer-spawn
[2026-03-23T07:09:42.173Z] [DEBUG] [SandboxProviders] Provider webcontainer-spawn already initialized and healthy
[2026-03-23T07:09:42.174Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: opensandbox
[2026-03-23T07:09:42.174Z] [DEBUG] [SandboxProviders] Provider opensandbox already initialized and healthy
[2026-03-23T07:09:42.174Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: opensandbox-code-interpreter
[2026-03-23T07:09:42.175Z] [DEBUG] [SandboxProviders] Provider opensandbox-code-interpreter already initialized and healthy
[2026-03-23T07:09:42.175Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: opensandbox-agent
[2026-03-23T07:09:42.176Z] [DEBUG] [SandboxProviders] Provider opensandbox-agent already initialized and healthy
[2026-03-23T07:09:42.176Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: microsandbox
[2026-03-23T07:09:42.176Z] [DEBUG] [SandboxProviders] Provider microsandbox already initialized and healthy
[2026-03-23T07:09:42.223Z] [INFO] [API:Filesystem:Diffs] Getting diffs for owner 1, maxFiles: 50 { requestId: 'diff-1774249782222-1khpw1' }
 GET /api/filesystem/diffs?maxFiles=50 200 in 238ms (compile: 227ms, proxy.ts: 3ms, render: 8ms)
[SandboxSync] VFS → Sandbox: synced 11 files to sandbox local-1774249721100
[SandboxSync] Initial sync completed for sandbox local-1774249721100
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [mfmdg8] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [mfmdg8] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [mfmdg8] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 25ms (compile: 4ms, proxy.ts: 13ms, render: 8ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 166ms (compile: 148ms, proxy.ts: 7ms, render: 12ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/index.html',
  contentLength: 34
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:09:47.630Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/index.html v42
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 7fae76e4-04ae-48dc-b1d1-450371deee2c
[2026-03-23T07:09:47.711Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/index.html
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'command-diff write: project/sessions/onex8/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: c184ddc8-4d78-4585-9460-c6cb36ed013d
 POST /api/filesystem/write 200 in 125ms (compile: 8ms, proxy.ts: 9ms, render: 109ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 28ms (compile: 6ms, proxy.ts: 9ms, render: 13ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/style.css' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/style.css',
  contentLength: 18
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:09:47.790Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/style.css v43
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/style.css'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 319804c2-a77f-40d1-8094-3cac6dab689e
[2026-03-23T07:09:47.803Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/style.css
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'command-diff write: project/sessions/onex8/style.css'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: fcdfcb6f-3919-467a-adae-70ca19f15b4e
 POST /api/filesystem/write 200 in 40ms (compile: 5ms, proxy.ts: 5ms, render: 30ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 41ms (compile: 8ms, proxy.ts: 9ms, render: 23ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/script.js' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/script.js',
  contentLength: 72
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:09:47.892Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/script.js v44
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/script.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 3b8c34d3-f969-41ce-af46-b4e9c55fd094
[2026-03-23T07:09:47.904Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/script.js
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'command-diff write: project/sessions/onex8/script.js'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 00498d66-5b81-42aa-9e06-40d42a5bcadc
 POST /api/filesystem/write 200 in 47ms (compile: 6ms, proxy.ts: 8ms, render: 33ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/README.md' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 27ms (compile: 9ms, proxy.ts: 7ms, render: 12ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/folderrrrrManual/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 22ms (compile: 4ms, proxy.ts: 6ms, render: 12ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/cantseeFiles.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 56ms (compile: 35ms, proxy.ts: 11ms, render: 10ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 21ms (compile: 6ms, proxy.ts: 7ms, render: 8ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/session/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 19ms (compile: 3ms, proxy.ts: 6ms, render: 10ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/dafqg/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 24ms (compile: 8ms, proxy.ts: 6ms, render: 9ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/.keep' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 29ms (compile: 13ms, proxy.ts: 7ms, render: 10ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/file.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 20ms (compile: 5ms, proxy.ts: 4ms, render: 10ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/file.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/oneut/WTF/file.txt' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/oneut/WTF/file.txt',
  contentLength: 11
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:09:48.204Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/oneut/WTF/file.txt v45
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/oneut/WTF/file.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: b05c4eb6-a2e3-4393-9fa4-f8bb9ff5a662
[2026-03-23T07:09:48.218Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/oneut/WTF/file.txt
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'command-diff write: project/sessions/oneut/WTF/file.txt'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 9511e798-61f9-4fc1-814e-c669b32fb28b
 POST /api/filesystem/write 200 in 50ms (compile: 4ms, proxy.ts: 12ms, render: 35ms)
[VFS LIST] [1ymety] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [1ymety] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [1ymety] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project 200 in 27ms (compile: 8ms, proxy.ts: 10ms, render: 9ms)
[VFS SNAPSHOT] [wlko0h] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS SNAPSHOT] [wlko0h] Cache hit (age: 12s)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 27ms (compile: 8ms, proxy.ts: 7ms, render: 13ms)
[VFS SNAPSHOT] [7vf7nr] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [7vf7nr] Snapshot: 0 files in 3ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [7vf7nr] STALE SNAPSHOT: last updated 899s ago
 GET /api/filesystem/snapshot?path=project 200 in 20ms (compile: 4ms, proxy.ts: 6ms, render: 10ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:10:03.379Z] [INFO] [API:Filesystem:Diffs] Getting diffs for owner 1, maxFiles: 50 { requestId: 'diff-1774249803379-k8k78e' }
 GET /api/filesystem/diffs?maxFiles=50 200 in 19ms (compile: 7ms, proxy.ts: 4ms, render: 8ms)
[2026-03-23T07:10:04.891Z] [WARN] [Auth:Middleware] Missing authorization header { path: '/api/user/preferences', ip: '::1' }
 GET /api/user/preferences 401 in 43ms (compile: 17ms, proxy.ts: 5ms, render: 21ms)
[2026-03-23T07:10:04.908Z] [WARN] [Auth:Middleware] Missing authorization header { path: '/api/user/preferences', ip: '::1' }
 GET /api/user/preferences 401 in 12ms (compile: 3ms, proxy.ts: 4ms, render: 5ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
 GET /api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 46ms (compile: 19ms, proxy.ts: 6ms, render: 21ms)
[2026-03-23T07:10:08.867Z] [WARN] [Auth:Middleware] Missing authorization header { path: '/api/user/preferences', ip: '::1' }
 GET /api/user/preferences 401 in 12ms (compile: 4ms, proxy.ts: 4ms, render: 5ms)
[2026-03-23T07:10:08.882Z] [WARN] [Auth:Middleware] Missing authorization header { path: '/api/user/preferences', ip: '::1' }
 GET /api/user/preferences 401 in 12ms (compile: 3ms, proxy.ts: 3ms, render: 5ms)
 GET /api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 13ms (compile: 3ms, proxy.ts: 5ms, render: 5ms)
 GET /api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 in 12ms (compile: 3ms, proxy.ts: 4ms, render: 5ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/backend 200 in 33ms (compile: 24ms, proxy.ts: 4ms, render: 5ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [n1iwrg] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=1)
[VFS LIST] [n1iwrg] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [n1iwrg] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 17ms (compile: 3ms, proxy.ts: 3ms, render: 11ms)
[VFS SNAPSHOT] [6ryjf9] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [6ryjf9] Snapshot: 0 files in 3ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [6ryjf9] STALE SNAPSHOT: last updated 940s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 13ms (compile: 3ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [6c65o8] GET /api/filesystem/list path="project/sessions/onex8" (polling=false, count=2)
[VFS LIST] [6c65o8] Listing directory: "project/sessions/onex8" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [6c65o8] Listed 0 entries in 5ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonex8 200 in 25ms (compile: 6ms, proxy.ts: 9ms, render: 10ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [41rt2x] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [41rt2x] Listing directory: "project/sessions" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [41rt2x] Listed 0 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 17ms (compile: 5ms, proxy.ts: 5ms, render: 7ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
 POST /api/filesystem/read 200 in 15ms (compile: 4ms, proxy.ts: 4ms, render: 6ms)
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] readFile called { ownerId: '1', filePath: 'project/sessions/onex8/index.html' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] writeFile called {
  ownerId: '1',
  filePath: 'project/sessions/onex8/index.html',
  contentLength: 33
}
[VFS] ensureWorkspace called { ownerId: '1' }
[2026-03-23T07:10:35.791Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onex8/index.html v46
[ShadowCommit] Starting commit {
  sessionId: '1',
  transactionCount: 1,
  message: 'Write project/sessions/onex8/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: 04e831b0-006b-4342-838c-b1aab2527b4e
[2026-03-23T07:10:35.797Z] [INFO] [GitVFS] [GitVFS] Committed 1 files: Write project/sessions/onex8/index.html
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[ShadowCommit] Starting commit {
  sessionId: '1:onex8',
  transactionCount: 1,
  message: 'command-diff write: project/sessions/onex8/index.html'
}
[ShadowCommit] Generating diffs for 1 transactions
[ShadowCommit] Serializing transactions
[ShadowCommit] Commit saved to database: e5184f26-baa1-4198-9629-fe85561dc050
 POST /api/filesystem/write 200 in 26ms (compile: 4ms, proxy.ts: 5ms, render: 18ms)
[VFS LIST] [nrdedh] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [nrdedh] Listing directory: "project" for owner="1"
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS LIST] [nrdedh] Listed 0 entries in 2ms
 GET /api/filesystem/list?path=project 200 in 15ms (compile: 3ms, proxy.ts: 4ms, render: 7ms)
[VFS SNAPSHOT] [qu5yzq] GET /api/filesystem/snapshot path="project/sessions/onex8" (polling=false, count=1)
[VFS SNAPSHOT] [qu5yzq] Cache hit (age: 7s)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8 200 in 26ms (compile: 9ms, proxy.ts: 8ms, render: 9ms)
[VFS SNAPSHOT] [qig9a5] GET /api/filesystem/snapshot path="project/sessions/oneut" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [qig9a5] Snapshot: 0 files in 2ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [qig9a5] STALE SNAPSHOT: last updated 947s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut 200 in 33ms (compile: 18ms, proxy.ts: 8ms, render: 7ms)
[VFS SNAPSHOT] [aupkz3] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS SNAPSHOT] [aupkz3] Snapshot: 0 files in 2ms (total workspace: 0 files)
[VFS SNAPSHOT WARN] [aupkz3] STALE SNAPSHOT: last updated 947s ago
 GET /api/filesystem/snapshot?path=project 200 in 15ms (compile: 4ms, proxy.ts: 5ms, render: 6ms)
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }
[VFS] ensureWorkspace called { ownerId: '1' }
[VFS] getWorkspaceVersion called { ownerId: '1' }



***console log; ***
forward-logs-shared.ts:95 Download the React DevTools for a better development experience: https://react.dev/link/react-devtools
forward-logs-shared.ts:95 [HMR] connected
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
features.ts:85 [useVFS] getSnapshot: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 39ms
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 31ms
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 27ms
features.ts:85 [useVFS] getSnapshot: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 25ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/oneut", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 12ms
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/oneut
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] registered filesystem-updated event listener
opfs-core.ts:549 [OPFS] Closed
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project
features.ts:85 [useVFS] getSnapshot: joining in-flight request for "project"
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project (waiting 41ms)
features.ts:85 [useVFS] getSnapshot: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 48ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/oneut
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/oneut
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] registered filesystem-updated event listener
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249490193}
input-response-separator.ts:157 Content length: 41
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
opfs-adapter.ts:234 [OPFS] Disabled
features.ts:85 [useVFS] request: response status=200 (226ms)
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project (waiting 77ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Foneut
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project (waiting 81ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/snapshot?path=project (waiting 335ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/snapshot?path=project (waiting 285ms)
features.ts:86 [useVFS WARN] OPFS initialization failed, falling back to server-only: Unhandled error. (undefined)
warn @ forward-logs-shared.ts:95
warn @ features.ts:86
useVirtualFilesystem.useEffect @ use-virtual-filesystem.ts:253
Promise.catch
useVirtualFilesystem.useEffect @ use-virtual-filesystem.ts:252
react_stack_bottom_frame @ react-dom-client.development.js:28123
runWithFiberInDEV @ react-dom-client.development.js:986
<CodePreviewPanel>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
ChatPanel @ chat-panel.tsx:254
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopConcurrentByScheduler @ react-dom-client.development.js:18991
renderRootConcurrent @ react-dom-client.development.js:18973
performWorkOnRoot @ react-dom-client.development.js:17834
performWorkOnRootViaSchedulerTask @ react-dom-client.development.js:20384
performWorkUntilDeadline @ scheduler.development.js:45
<ChatPanel>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
ConversationInterface @ conversation-interface.tsx:1649
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12085
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopConcurrentByScheduler @ react-dom-client.development.js:18991
renderRootConcurrent @ react-dom-client.development.js:18973
performWorkOnRoot @ react-dom-client.development.js:17834
performWorkOnRootViaSchedulerTask @ react-dom-client.development.js:20384
performWorkUntilDeadline @ scheduler.development.js:45
<...>
exports.jsx @ react-jsx-runtime.development.js:342
LoadableComponent @ loadable.tsx:65
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performWorkOnRootViaSchedulerTask @ react-dom-client.development.js:20384
performWorkUntilDeadline @ scheduler.development.js:45
<LoadableComponent>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
ChatBox @ page.tsx:92
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performWorkOnRootViaSchedulerTask @ react-dom-client.development.js:20384
performWorkUntilDeadline @ scheduler.development.js:45
<ChatBox>
exports.jsx @ react-jsx-runtime.development.js:342
ClientPageRoot @ client-page.tsx:83
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12085
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performWorkOnRootViaSchedulerTask @ react-dom-client.development.js:20384
performWorkUntilDeadline @ scheduler.development.js:45
"use client"
Function.all @ VM301 <anonymous>:1
Function.all @ VM301 <anonymous>:1
initializeElement @ react-server-dom-turbopack-client.browser.development.js:1940
"use server"
ResponseInstance @ react-server-dom-turbopack-client.browser.development.js:2784
createResponseFromOptions @ react-server-dom-turbopack-client.browser.development.js:4660
exports.createFromReadableStream @ react-server-dom-turbopack-client.browser.development.js:5064
module evaluation @ app-index.tsx:211
(anonymous) @ dev-base.ts:244
runModuleExecutionHooks @ dev-base.ts:278
instantiateModule @ dev-base.ts:238
getOrInstantiateModuleFromParent @ dev-base.ts:162
commonJsRequire @ runtime-utils.ts:389
(anonymous) @ app-next-turbopack.ts:11
(anonymous) @ app-bootstrap.ts:79
loadScriptsInSequence @ app-bootstrap.ts:23
appBootstrap @ app-bootstrap.ts:61
module evaluation @ app-next-turbopack.ts:10
(anonymous) @ dev-base.ts:244
runModuleExecutionHooks @ dev-base.ts:278
instantiateModule @ dev-base.ts:238
getOrInstantiateRuntimeModule @ dev-base.ts:128
registerChunk @ runtime-backend-dom.ts:57
await in registerChunk
registerChunk @ dev-base.ts:1149
(anonymous) @ dev-backend-dom.ts:126
(anonymous) @ dev-backend-dom.ts:126
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (576ms)
features.ts:85 [useVFS] request: response status=200 (576ms)
features.ts:85 [useVFS] request: response status=200 (572ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/oneut", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/oneut", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/oneut" (fresh: true)
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [useVFS] request: response status=200 (68ms)
features.ts:85 [useVFS] request: response status=200 (67ms)
features.ts:85 [useVFS] request: response status=200 (67ms)
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
TerminalPanel.tsx:215 [TerminalPanel] VFS Snapshot received: {fileCount: 0, samplePaths: Array(0), scopePath: 'project/sessions/oneut'}
TerminalPanel.tsx:239 [TerminalPanel] VFS is empty, using minimal project structure
features.ts:85 [useVFS] request: response status=200 (75ms)
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (82ms)
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/onex8
features.ts:85 [useVFS] request: response status=200 (60ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:215 [TerminalPanel] VFS Snapshot received: {fileCount: 0, samplePaths: Array(0), scopePath: 'project/sessions/onex8'}
TerminalPanel.tsx:229 [TerminalPanel] VFS appears empty but keeping existing 1 entries
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249498779}
input-response-separator.ts:157 Content length: 0
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 4601ms
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/index.html
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249518007-1', emittedAt: 1774249518007, scopePath: 'project/sessions/onex8', sessionId: 'onex8', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project"
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache hit for "project" (fresh: true)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated event] received in TerminalPanel {protocolVersion: 1, eventId: 'fs-1774249518007-1', emittedAt: 1774249518007, scopePath: 'project/sessions/onex8', sessionId: 'onex8', …}
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] got snapshot, filesCount=0, scope="project/sessions/onex8"
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] VFS appears empty but keeping existing 1 entries
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/style.css
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/script.js
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/README.md
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/index.html
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/style.css
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/script.js
use-enhanced-chat.ts:613 [Chat] Progressive file edit detected: project/sessions/onex8/README.md
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518145}
input-response-separator.ts:157 Content length: 0
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518276}
input-response-separator.ts:157 Content length: 21
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518396}
input-response-separator.ts:157 Content length: 93
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518525}
input-response-separator.ts:157 Content length: 148
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518653}
input-response-separator.ts:157 Content length: 193
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518774}
input-response-separator.ts:157 Content length: 241
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249518892}
input-response-separator.ts:157 Content length: 290
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519011}
input-response-separator.ts:157 Content length: 377
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519127}
input-response-separator.ts:157 Content length: 405
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519247}
input-response-separator.ts:157 Content length: 430
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519372}
input-response-separator.ts:157 Content length: 458
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519515}
input-response-separator.ts:157 Content length: 489
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519627}
input-response-separator.ts:157 Content length: 523
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519756}
input-response-separator.ts:157 Content length: 572
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249519887}
input-response-separator.ts:157 Content length: 632
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520012}
input-response-separator.ts:157 Content length: 682
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520130}
input-response-separator.ts:157 Content length: 730
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520273}
input-response-separator.ts:157 Content length: 772
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520402}
input-response-separator.ts:157 Content length: 856
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520534}
input-response-separator.ts:157 Content length: 930
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520667}
input-response-separator.ts:157 Content length: 1015
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520788}
input-response-separator.ts:157 Content length: 1041
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249520902}
input-response-separator.ts:157 Content length: 1081
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521040}
input-response-separator.ts:157 Content length: 1126
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521180}
input-response-separator.ts:157 Content length: 1177
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521290}
input-response-separator.ts:157 Content length: 1204
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521421}
input-response-separator.ts:157 Content length: 1239
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521555}
input-response-separator.ts:157 Content length: 1273
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521678}
input-response-separator.ts:157 Content length: 1316
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521830}
input-response-separator.ts:157 Content length: 1366
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249521963}
input-response-separator.ts:157 Content length: 1430
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522087}
input-response-separator.ts:157 Content length: 1465
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522221}
input-response-separator.ts:157 Content length: 1508
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522369}
input-response-separator.ts:157 Content length: 1555
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522504}
input-response-separator.ts:157 Content length: 1605
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522630}
input-response-separator.ts:157 Content length: 1640
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522750}
input-response-separator.ts:157 Content length: 1700
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249522875}
input-response-separator.ts:157 Content length: 1727
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523013}
input-response-separator.ts:157 Content length: 1767
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523137}
input-response-separator.ts:157 Content length: 1815
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523261}
input-response-separator.ts:157 Content length: 1925
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523399}
input-response-separator.ts:157 Content length: 2004
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523590}
input-response-separator.ts:157 Content length: 2061
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523745}
input-response-separator.ts:157 Content length: 2133
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249523892}
input-response-separator.ts:157 Content length: 2185
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524045}
input-response-separator.ts:157 Content length: 2237
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524161}
input-response-separator.ts:157 Content length: 2313
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 0, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524299}
input-response-separator.ts:157 Content length: 2343
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 1, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524416}
input-response-separator.ts:157 Content length: 2384
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 1, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524537}
input-response-separator.ts:157 Content length: 2470
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524653}
input-response-separator.ts:157 Content length: 2533
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
chat-panel.tsx:106 Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
error @ intercept-console-error.ts:42
getRootForUpdatedFiber @ react-dom-client.development.js:4908
enqueueConcurrentHookUpdate @ react-dom-client.development.js:4861
dispatchSetStateInternal @ react-dom-client.development.js:9493
dispatchSetState @ react-dom-client.development.js:9453
ChatPanel.useCallback[handleScroll] @ chat-panel.tsx:106
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchContinuousEvent @ react-dom-client.development.js:25678
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524774}
input-response-separator.ts:157 Content length: 2607
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249524895}
input-response-separator.ts:157 Content length: 2665
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249525012}
input-response-separator.ts:157 Content length: 2729
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249525054}
input-response-separator.ts:157 Content length: 2786
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249525091}
input-response-separator.ts:157 Content length: 2813
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249525128}
input-response-separator.ts:157 Content length: 2826
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249525167}
input-response-separator.ts:157 Content length: 2838
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
input-response-separator.ts:155 Content Processing Debug - assistant
input-response-separator.ts:156 Context: {isUserInput: false, isApiResponse: true, source: 'assistant', timestamp: 1774249525336}
input-response-separator.ts:157 Content length: 2855
input-response-separator.ts:158 Result: {mode: 'chat', shouldShowDiffs: false, shouldOpenCodePreview: false, codeBlockCount: 2, fileDiffCount: 0}
use-enhanced-chat.ts:140 Fetch failed loading: POST "http://localhost:3000/api/chat".
useEnhancedChat.useCallback[handleSubmit] @ use-enhanced-chat.ts:140
ConversationInterface.useCallback[handleSubmit] @ conversation-interface.tsx:495
(anonymous) @ conversation-interface.tsx:1435
setTimeout
handleChatSubmit @ conversation-interface.tsx:1430
(anonymous) @ conversation-interface.tsx:1677
setTimeout
onSubmit @ conversation-interface.tsx:1676
onKeyDown @ interaction-panel.tsx:1887
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
conversation-interface.tsx:364 Streaming session display-assistant-1774249498698-1774249498777 completed
conversation-interface.tsx:564 [Continuance] Auto-triggering next request
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 45ms
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 43ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/onex8
features.ts:85 [useVFS] getSnapshot: joining in-flight request for "project/sessions/onex8"
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] request: response status=200 (58ms)
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project%2Fsessions%2Fonex8 (waiting 95ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (34ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: response status=200 (20ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
features.ts:85 [useVFS] request: response status=200 (40ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] writeFile: writing "project/sessions/folderrrrrManual/.keep" (contentLength=0)
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 135ms
features.ts:85 [useVFS] writeFile: OPFS write complete for "project/sessions/folderrrrrManual/.keep", version=1
features.ts:85 [useVFS] request: POST /api/filesystem/write
features.ts:85 [useVFS] request: response status=200 (61ms)
features.ts:85 [useVFS] writeFile: server write-through complete for "project/sessions/folderrrrrManual/.keep"
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] writeFile: writing "project/sessions/cantseeFiles.txt" (contentLength=0)
features.ts:85 [useVFS] writeFile: OPFS write complete for "project/sessions/cantseeFiles.txt", version=1
features.ts:85 [useVFS] request: POST /api/filesystem/write
features.ts:85 [useVFS] request: response status=200 (32ms)
features.ts:85 [useVFS] writeFile: server write-through complete for "project/sessions/cantseeFiles.txt"
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 18ms
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
features.ts:85 [useVFS] request: response status=200 (19ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [CodePreviewPanel] openFilesystemDirectory: "project" -> "project"
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
features.ts:85 [useVFS] request: response status=200 (42ms)
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [useVFS] writeFile: writing "project/sessions/.keep" (contentLength=0)
features.ts:85 [useVFS] writeFile: OPFS write complete for "project/sessions/.keep", version=1
features.ts:85 [useVFS] request: POST /api/filesystem/write
features.ts:85 [useVFS] request: response status=200 (34ms)
features.ts:85 [useVFS] writeFile: server write-through complete for "project/sessions/.keep"
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] writeFile: writing "project/session/.keep" (contentLength=0)
features.ts:85 [useVFS] writeFile: OPFS write complete for "project/session/.keep", version=1
features.ts:85 [useVFS] request: POST /api/filesystem/write
features.ts:85 [useVFS] request: response status=200 (39ms)
features.ts:85 [useVFS] writeFile: server write-through complete for "project/session/.keep"
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 46ms
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 43ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/onex8
features.ts:85 [useVFS] getSnapshot: joining in-flight request for "project/sessions/onex8"
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] request: response status=200 (55ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project%2Fsessions%2Fonex8 (waiting 96ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (61ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: response status=200 (31ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
features.ts:85 [useVFS] request: response status=200 (42ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions", 0 entries
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] removed filesystem-updated event listener
logger.ts:306 [2026-03-23T07:07:06.140Z] [DEBUG] [TerminalPanel] Initializing WebSocket terminal server...
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/onex8
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] registered filesystem-updated event listener
logger.ts:306 [2026-03-23T07:07:06.276Z] [INFO] [TerminalHealthMonitor] Health monitoring started
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/oneut", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut
features.ts:85 [useVFS] request: response status=200 (52ms)
TerminalPanel.tsx:215 [TerminalPanel] VFS Snapshot received: {fileCount: 0, samplePaths: Array(0), scopePath: 'project/sessions/onex8'}
TerminalPanel.tsx:229 [TerminalPanel] VFS appears empty but keeping existing 2 entries
logger.ts:306 [2026-03-23T07:07:08.631Z] [INFO] [TerminalPanel] WebSocket terminal server initialized
forward-logs-shared.ts:95 [Fast Refresh] done in 2330ms
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: attempting to sync "project/sessions/oneut/WTF/.keep" (contentLength=0)
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: normalized paths - scope="project/sessions/onex8", input="project/sessions/oneut/WTF/.keep", scoped="project/sessions/oneut/WTF/.keep"
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: OPFS write complete for "project/sessions/oneut/WTF/.keep"
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: API response status=200
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: dispatched filesystem-updated event for "project/sessions/oneut/WTF/.keep"
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249648881-2', emittedAt: 1774249648881, path: 'project/sessions/oneut/WTF/.keep', scopePath: 'project/sessions/onex8', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project"
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated event] received in TerminalPanel {protocolVersion: 1, eventId: 'fs-1774249648881-2', emittedAt: 1774249648881, path: 'project/sessions/oneut/WTF/.keep', scopePath: 'project/sessions/onex8', …}
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] got snapshot, filesCount=0, scope="project/sessions/onex8"
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] VFS appears empty but keeping existing 3 entries
features.ts:85 [useVFS] request: response status=200 (20ms)
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 29ms
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
features.ts:85 [useVFS] request: response status=200 (22ms)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
forward-logs-shared.ts:95 [Fast Refresh] done in 157ms
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: attempting to sync "project/sessions/oneut/WTF/file.txt" (contentLength=5)
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: normalized paths - scope="project/sessions/onex8", input="project/sessions/oneut/WTF/file.txt", scoped="project/sessions/oneut/WTF/file.txt"
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: OPFS write complete for "project/sessions/oneut/WTF/file.txt"
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: API response status=200
TerminalPanel.tsx:136 [TerminalPanel] syncFileToVFS: dispatched filesystem-updated event for "project/sessions/oneut/WTF/file.txt"
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249666609-3', emittedAt: 1774249666609, path: 'project/sessions/oneut/WTF/file.txt', scopePath: 'project/sessions/onex8', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project"
features.ts:85 [useVFS] listDirectory: cache hit for "project" (fresh: true)
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache hit for "project" (fresh: true)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated event] received in TerminalPanel {protocolVersion: 1, eventId: 'fs-1774249666609-3', emittedAt: 1774249666609, path: 'project/sessions/oneut/WTF/file.txt', scopePath: 'project/sessions/onex8', …}
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] got snapshot, filesCount=0, scope="project/sessions/onex8"
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] VFS appears empty but keeping existing 4 entries
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 20326ms
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 10325ms
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 46ms
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 43ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/onex8
features.ts:85 [useVFS] getSnapshot: joining in-flight request for "project/sessions/onex8"
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] request: response status=200 (58ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project%2Fsessions%2Fonex8 (waiting 96ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (45ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: response status=200 (33ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
features.ts:85 [useVFS] request: response status=200 (42ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] writeFile: writing "project/sessions/dafqg/.keep" (contentLength=0)
features.ts:85 [useVFS] writeFile: OPFS write complete for "project/sessions/dafqg/.keep", version=1
features.ts:85 [useVFS] request: POST /api/filesystem/write
features.ts:85 [useVFS] request: response status=200 (40ms)
features.ts:85 [useVFS] writeFile: server write-through complete for "project/sessions/dafqg/.keep"
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] removed filesystem-updated event listener
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/onex8
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/oneut", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut
features.ts:85 [useVFS] request: response status=200 (22ms)
TerminalPanel.tsx:215 [TerminalPanel] VFS Snapshot received: {fileCount: 0, samplePaths: Array(0), scopePath: 'project/sessions/onex8'}
TerminalPanel.tsx:229 [TerminalPanel] VFS appears empty but keeping existing 4 entries
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 45ms
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 42ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/onex8
features.ts:85 [useVFS] getSnapshot: joining in-flight request for "project/sessions/onex8"
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] request: response status=200 (59ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project%2Fsessions%2Fonex8 (waiting 95ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (61ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: response status=200 (27ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
logger.ts:306 [2026-03-23T07:09:40.041Z] [DEBUG] [SandboxConnection] Detected provider type: null for sandbox local-1774249721100
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [Fast Refresh] done in 645ms
sandbox-connection-manager.ts:338 WebSocket connection to 'ws://localhost:3000/api/sandbox/terminal/ws?sessionId=e04404ef-9b6f-460d-ae08-a26cee57ec98&sandboxId=local-1774249721100&token=ca8109e6-8b2e-436d-95f6-227fc7719493' failed: 
connectWebSocket @ sandbox-connection-manager.ts:338
connect @ sandbox-connection-manager.ts:286
logger.ts:304 [2026-03-23T07:09:40.834Z] [WARN] [SandboxConnection] WebSocket error Event {isTrusted: true, type: 'error', target: WebSocket, currentTarget: WebSocket, eventPhase: 2, …}
warn @ forward-logs-shared.ts:95
output @ logger.ts:304
warn @ logger.ts:343
ws.onerror @ sandbox-connection-manager.ts:355
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 229ms
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/onex8
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
features.ts:85 [useVFS] request: response status=200 (81ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions", 0 entries
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
file-diff-utils.ts:48 Failed to apply unified diff: Error: Removed line count did not match for hunk at line 3
    at parseHunk (parse.js:139:19)
    at parseIndex (parse.js:55:34)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
forward-logs-shared.ts:95 [Fast Refresh] done in 160ms
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
file-diff-utils.ts:48 Failed to apply unified diff: Error: Removed line count did not match for hunk at line 3
    at parseHunk (parse.js:139:19)
    at parseIndex (parse.js:55:34)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
file-diff-utils.ts:48 Failed to apply unified diff: Error: Removed line count did not match for hunk at line 3
    at parseHunk (parse.js:139:19)
    at parseIndex (parse.js:55:34)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
file-diff-utils.ts:48 Failed to apply unified diff: Error: Removed line count did not match for hunk at line 3
    at parseHunk (parse.js:139:19)
    at parseIndex (parse.js:55:34)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/sessions/onex8/README.md', currentContentLength: 844, currentContentPreview: '# Click Target Web Game\n\nA tiny browser game where…ps://nodejs.org/\n2. **Install dependencies**  \n  ', diffPreview: '--- a/project/sessions/onex8/README.md\n+++ b/proje…0 +33,1 @@\n - `README.md` – This file\n \n Enjoy!\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
(anonymous) @ react-dom-client.development.js:20418
file-diff-utils.ts:48 Failed to apply unified diff: Error: Unknown line 3 "+"
    at parseIndex (parse.js:58:23)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/sessions/folderrrrrManual/.keep', currentContentLength: 0, currentContentPreview: '', diffPreview: '--- a/project/sessions/folderrrrrManual/.keep\n+++ b/project/sessions/folderrrrrManual/.keep\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
file-diff-utils.ts:48 Failed to apply unified diff: Error: Unknown line 3 "+"
    at parseIndex (parse.js:58:23)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/sessions/cantseeFiles.txt', currentContentLength: 0, currentContentPreview: '', diffPreview: '--- a/project/sessions/cantseeFiles.txt\n+++ b/project/sessions/cantseeFiles.txt\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
file-diff-utils.ts:48 Failed to apply unified diff: Error: Unknown line 3 "+"
    at parseIndex (parse.js:58:23)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/sessions/.keep', currentContentLength: 0, currentContentPreview: '', diffPreview: '--- a/project/sessions/.keep\n+++ b/project/sessions/.keep\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
file-diff-utils.ts:48 Failed to apply unified diff: Error: Unknown line 3 "+"
    at parseIndex (parse.js:58:23)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/session/.keep', currentContentLength: 0, currentContentPreview: '', diffPreview: '--- a/project/session/.keep\n+++ b/project/session/.keep\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
file-diff-utils.ts:48 Failed to apply unified diff: Error: Unknown line 3 "+"
    at parseIndex (parse.js:58:23)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/sessions/dafqg/.keep', currentContentLength: 0, currentContentPreview: '', diffPreview: '--- a/project/sessions/dafqg/.keep\n+++ b/project/sessions/dafqg/.keep\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
file-diff-utils.ts:48 Failed to apply unified diff: Error: Unknown line 3 "+"
    at parseIndex (parse.js:58:23)
    at parsePatch (parse.js:144:9)
    at applyUnifiedDiffToContent (file-diff-utils.ts:43:30)
    at applyDiffToContent (file-diff-utils.ts:117:5)
    at ConversationInterface.useCallback[applyDiffsToFilesystem] (conversation-interface.tsx:1152:45)
    at async ConversationInterface.useCallback[applyPolledDiffs] (conversation-interface.tsx:1288:7)
error @ intercept-console-error.ts:42
applyUnifiedDiffToContent @ file-diff-utils.ts:48
applyDiffToContent @ file-diff-utils.ts:117
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1152
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
conversation-interface.tsx:1157 [applyDiffsToFilesystem] Diff application returned null {path: 'project/sessions/oneut/WTF/.keep', currentContentLength: 0, currentContentPreview: '', diffPreview: '--- a/project/sessions/oneut/WTF/.keep\n+++ b/project/sessions/oneut/WTF/.keep\n+', readError: null, …}
warn @ forward-logs-shared.ts:95
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1157
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
forward-logs-shared.ts:95 [Fast Refresh] done in 143ms
conversation-interface.tsx:1256 [Diff Application Failed] {failedFiles: Array(7), failedDiffs: {…}, reason: 'Search blocks not found or patches could not be applied', totalEntriesAttempted: 11, appliedCount: 4, …}
error @ intercept-console-error.ts:42
ConversationInterface.useCallback[applyDiffsToFilesystem] @ conversation-interface.tsx:1256
await in ConversationInterface.useCallback[applyDiffsToFilesystem]
ConversationInterface.useCallback[applyPolledDiffs] @ conversation-interface.tsx:1288
onClick @ code-preview-panel.tsx:6019
executeDispatch @ react-dom-client.development.js:20543
runWithFiberInDEV @ react-dom-client.development.js:986
processDispatchQueue @ react-dom-client.development.js:20593
(anonymous) @ react-dom-client.development.js:21164
batchedUpdates$1 @ react-dom-client.development.js:3377
dispatchEventForPluginEventSystem @ react-dom-client.development.js:20747
dispatchEvent @ react-dom-client.development.js:25693
dispatchDiscreteEvent @ react-dom-client.development.js:25661
<button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
_c @ button.tsx:46
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Button>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
CodePreviewPanel @ code-preview-panel.tsx:6015
react_stack_bottom_frame @ react-dom-client.development.js:28038
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249788231-4', emittedAt: 1774249788231, scopePath: 'project/sessions/onex8', source: 'command-diff', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project"
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated event] received in TerminalPanel {protocolVersion: 1, eventId: 'fs-1774249788231-4', emittedAt: 1774249788231, scopePath: 'project/sessions/onex8', source: 'command-diff', …}
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] got snapshot, filesCount=0, scope="project/sessions/onex8"
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] VFS appears empty but keeping existing 4 entries
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249788231-4', emittedAt: 1774249788231, scopePath: 'project/sessions/onex8', source: 'command-diff', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project/sessions"
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 46ms
features.ts:85 [useVFS] request: response status=200 (201ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 47ms
features.ts:85 [useVFS] request: response status=200 (45ms)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project
features.ts:85 [useVFS] request: response status=200 (31ms)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
logger.ts:306 [2026-03-23T07:09:49.916Z] [WARN] [SandboxConnection] Connection timeout, falling back to local mode
warn @ forward-logs-shared.ts:95
output @ logger.ts:306
warn @ logger.ts:343
handleConnectionTimeout @ sandbox-connection-manager.ts:1007
(anonymous) @ sandbox-connection-manager.ts:176
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener

image-proxy:1  GET http://localhost:3000/api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 (Bad Request)
(index):1 Loading the image 'http://64.media.tumblr.com/0411acaf933ca0d247a7e115cd761608/e85d08b8418d3bbd-0f/s500x750/cebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif' violates the following Content Security Policy directive: "img-src 'self' data: https: blob:". The action has been blocked.
settings.tsx:234 Fetch failed loading: GET "http://localhost:3000/api/user/preferences".
Settings.useEffect.loadPreferences @ settings.tsx:234
image-proxy:1  GET http://localhost:3000/api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 (Bad Request)
image-proxy:1  GET http://localhost:3000/api/image-proxy?url=%2F%2F64.media.tumblr.com%2F0411acaf933ca0d247a7e115cd761608%2Fe85d08b8418d3bbd-0f%2Fs500x750%2Fcebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif 400 (Bad Request)
Image
(anonymous) @ image-component.tsx:220
applyRef @ use-merged-ref.ts:55
(anonymous) @ use-merged-ref.ts:42
commitAttachRef @ react-dom-client.development.js:13938
runWithFiberInDEV @ react-dom-client.development.js:986
safelyAttachRef @ react-dom-client.development.js:13956
...
commitLayoutEffectOnFiber @ react-dom-client.development.js:14983
recursivelyTraverseLayoutEffects @ react-dom-client.development.js:16370
<img>
exports.jsx @ react-jsx-runtime.development.js:342
(anonymous) @ image-component.tsx:259
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateForwardRef @ react-dom-client.development.js:10059
beginWork @ react-dom-client.development.js:12475
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<ForwardRef>
exports.jsx @ react-jsx-runtime.development.js:342
(anonymous) @ image-component.tsx:412
react_stack_bottom_frame @ react-dom-client.development.js:28038
(anonymous) @ react-dom-client.development.js:20418
<ForwardRef>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
(anonymous) @ settings.tsx:932
Settings @ settings.tsx:922
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Settings>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
ConversationInterface @ conversation-interface.tsx:1720
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
(index):1 Loading the image 'http://64.media.tumblr.com/0411acaf933ca0d247a7e115cd761608/e85d08b8418d3bbd-0f/s500x750/cebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif' violates the following Content Security Policy directive: "img-src 'self' data: https: blob:". The action has been blocked.
settings.tsx:234 Fetch failed loading: GET "http://localhost:3000/api/user/preferences".
Settings.useEffect.loadPreferences @ settings.tsx:234
Settings.useEffect @ settings.tsx:276
react_stack_bottom_frame @ react-dom-client.development.js:28123
runWithFiberInDEV @ react-dom-client.development.js:986
<Settings>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
ConversationInterface @ conversation-interface.tsx:1720
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
settings.tsx:234 Fetch failed loading: GET "http://localhost:3000/api/user/preferences".
Settings.useEffect.loadPreferences @ settings.tsx:234
Settings.useEffect @ settings.tsx:276
react_stack_bottom_frame @ react-dom-client.development.js:28123
runWithFiberInDEV @ react-dom-client.development.js:986
commitHookEffectListMount @ react-dom-client.development.js:13692
commitHookPassiveMountEffects @ react-dom-client.development.js:13779
reconnectPassiveEffects @ react-dom-client.development.js:17124
doubleInvokeEffectsOnFiber @ react-dom-client.development.js:20130
runWithFiberInDEV @ react-dom-client.development.js:986

commitDoubleInvokeEffectsInDEV @ react-dom-client.development.js:20139
flushPassiveEffects @ react-dom-client.development.js:19866
flushPendingEffects @ react-dom-client.development.js:19785
flushSpawnedWork @ react-dom-client.development.js:19741
commitRoot @ react-dom-client.development.js:19335
commitRootWhenReady @ react-dom-client.development.js:18178
performWorkOnRoot @ react-dom-client.development.js:18054
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
<Settings>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:342
ConversationInterface @ conversation-interface.tsx:1720
react_stack_bottom_frame @ react-dom-client.development.js:28038
renderWithHooksAgain @ react-dom-client.development.js:8084
renderWithHooks @ react-dom-client.development.js:7996
updateFunctionComponent @ react-dom-client.development.js:10501
beginWork @ react-dom-client.development.js:12136
runWithFiberInDEV @ react-dom-client.development.js:986
performUnitOfWork @ react-dom-client.development.js:18997
workLoopSync @ react-dom-client.development.js:18825
renderRootSync @ react-dom-client.development.js:18806
performWorkOnRoot @ react-dom-client.development.js:17835
performSyncWorkOnRoot @ react-dom-client.development.js:20399
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:20241
processRootScheduleInMicrotask @ react-dom-client.development.js:20280
(anonymous) @ react-dom-client.development.js:20418
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] removed filesystem-updated event listener
logger.ts:306 [2026-03-23T07:10:12.516Z] [DEBUG] [TerminalPanel] Initializing WebSocket terminal server...
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/onex8
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] registered filesystem-updated event listener
RenderService.ts:55 Uncaught TypeError: Cannot read properties of undefined (reading 'dimensions')
    at get dimensions (RenderService.ts:55:77)
    at zt._sync (Viewport.ts:160:35)
    at Viewport.ts:146:12
    at en._runRefreshCallbacks (RenderDebouncer.ts:80:7)
    at en._innerRefresh (RenderDebouncer.ts:75:10)
    at RenderDebouncer.ts:53:93
get dimensions @ RenderService.ts:55
_sync @ Viewport.ts:160
(anonymous) @ Viewport.ts:146
_runRefreshCallbacks @ RenderDebouncer.ts:80
_innerRefresh @ RenderDebouncer.ts:75
(anonymous) @ RenderDebouncer.ts:53
requestAnimationFrame
refresh @ RenderDebouncer.ts:53
refreshRows @ RenderService.ts:168
refresh @ CoreBrowserTerminal.ts:853
clear @ CoreBrowserTerminal.ts:1257
clear @ Terminal.ts:225
TerminalPanel.useEffect @ TerminalPanel.tsx:332
TerminalPanel.useEffect @ TerminalPanel.tsx:329
react_stack_bottom_frame @ react-dom-client.development.js:28123
runWithFiberInDEV @ react-dom-client.development.js:986
commitPassiveMountOnFiber @ react-dom-client.development.js:16725
logger.ts:306 [2026-03-23T07:10:12.554Z] [INFO] [TerminalPanel] WebSocket terminal server initialized
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:215 [TerminalPanel] VFS Snapshot received: {fileCount: 0, samplePaths: Array(0), scopePath: 'project/sessions/onex8'}
TerminalPanel.tsx:229 [TerminalPanel] VFS appears empty but keeping existing 4 entries
logger.ts:306 [2026-03-23T07:10:15.069Z] [INFO] [TerminalHealthMonitor] Health monitoring stopped
logger.ts:306 [2026-03-23T07:10:15.071Z] [INFO] [TerminalHealthMonitor] Health monitoring started
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] removed filesystem-updated event listener
TerminalPanel.tsx:205 [TerminalPanel] Starting VFS sync, scopePath: project/sessions/onex8
TerminalPanel.tsx:136 [TerminalPanel] [TerminalPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] getSnapshot: cache hit for "project/sessions/oneut" (fresh: true)
TerminalPanel.tsx:215 [TerminalPanel] VFS Snapshot received: {fileCount: 0, samplePaths: Array(0), scopePath: 'project/sessions/onex8'}
TerminalPanel.tsx:229 [TerminalPanel] VFS appears empty but keeping existing 4 entries
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 46ms
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 44ms
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
features.ts:85 [useVFS] listDirectory: queuing path change for after current load completes: project/sessions/onex8
features.ts:85 [useVFS] getSnapshot: joining in-flight request for "project/sessions/onex8"
features.ts:85 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
features.ts:85 [useVFS] request: response status=200 (71ms)
features.ts:85 [useVFS] request: debouncing duplicate call to /api/filesystem/list?path=project%2Fsessions%2Fonex8 (waiting 96ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] request: response status=200 (59ms)
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: response status=200 (30ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions/onex8", 0 entries
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions/onex8" (fresh: true)
features.ts:85 [useVFS] listDirectory: cache miss for "project/sessions", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
features.ts:85 [useVFS] request: response status=200 (62ms)
features.ts:85 [useVFS] listDirectory: loaded "project/sessions", 0 entries
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249835802-5', emittedAt: 1774249835802, scopePath: 'project/sessions/onex8', source: 'command-diff', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project"
features.ts:85 [useVFS] listDirectory: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: GET /api/filesystem/list?path=project
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated event] received in TerminalPanel {protocolVersion: 1, eventId: 'fs-1774249835802-5', emittedAt: 1774249835802, scopePath: 'project/sessions/onex8', source: 'command-diff', …}
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/oneut", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 49ms
features.ts:85 [CodePreviewPanel] [filesystem-updated event] received {protocolVersion: 1, eventId: 'fs-1774249835802-5', emittedAt: 1774249835802, scopePath: 'project/sessions/onex8', source: 'command-diff', …}
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshing directory: "project/sessions"
features.ts:85 [useVFS] listDirectory: cache hit for "project/sessions" (fresh: true)
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache miss for "project/sessions/onex8", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 48ms
features.ts:85 [useVFS] request: response status=200 (163ms)
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonex8
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Foneut
features.ts:85 [useVFS] listDirectory: loaded "project", 0 entries
features.ts:85 [CodePreviewPanel] [filesystem-updated] directory refreshed
features.ts:85 [useVFS] getSnapshot: cache miss for "project", fetching from API
features.ts:85 [useVFS] request: cooldown active for GET, waiting 48ms
features.ts:85 [useVFS] request: response status=200 (29ms)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
features.ts:85 [useVFS] request: response status=200 (38ms)
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] got snapshot, filesCount=0, scope="project/sessions/onex8"
TerminalPanel.tsx:136 [TerminalPanel] [filesystem-updated] VFS appears empty but keeping existing 4 entries
features.ts:85 [useVFS] request: GET /api/filesystem/snapshot?path=project
features.ts:85 [useVFS] request: response status=200 (18ms)
features.ts:85 [CodePreviewPanel] [filesystem-updated] refreshed scopedPreviewFiles (0 files)
