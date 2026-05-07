const fs = require('fs');
let content = fs.readFileSync('lib/database/connection.ts', 'utf-8');

// FIX 1: Append logging tables to MOCK_SCHEMA
// Find the pattern where MOCK_SCHEMA ends
const schemaEnd = 'paths_json TEXT NOT NULL);';
const loggingTables = " CREATE TABLE IF NOT EXISTS chat_request_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, message_count INTEGER NOT NULL, request_size INTEGER NOT NULL, response_size INTEGER, token_usage_prompt INTEGER, token_usage_completion INTEGER, token_usage_total INTEGER, latency_ms INTEGER, streaming BOOLEAN NOT NULL DEFAULT 0, success BOOLEAN NOT NULL DEFAULT 0, error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, metadata TEXT); CREATE TABLE IF NOT EXISTS tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, provider TEXT NOT NULL, tool_name TEXT NOT NULL, success INTEGER NOT NULL, error TEXT, timestamp INTEGER NOT NULL, conversation_id TEXT, tool_call_id TEXT); CREATE TABLE IF NOT EXISTS hitl_audit_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, approved BOOLEAN NOT NULL, feedback TEXT, modified_value TEXT, response_time_ms INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, metadata TEXT);";

const idx = content.lastIndexOf(schemaEnd + '`;');
if (idx >= 0) {
  const before = content.slice(0, idx + schemaEnd.length);
  const after = content.slice(idx + schemaEnd.length);
  content = before + loggingTables + after;
  console.log('Fixed MOCK_SCHEMA at position ' + idx);
} else {
  console.log('ERROR: schema end marker not found');
  process.exit(1);
}

// FIX 2: Add logging tables to the tables object
const tablesClose = 'email_provider_quotas: [],\n      };';
const tablesFixed = 'email_provider_quotas: [],\n        // Logging tables (for chat-request-logger tests)\n        chat_request_logs: [],\n        tool_calls: [],\n        hitl_audit_logs: [],\n      };';

if (content.includes(tablesClose)) {
  content = content.replace(tablesClose, tablesFixed);
  console.log('Fixed tables object');
} else {
  console.log('ERROR: tables close not found');
  process.exit(1);
}

fs.writeFileSync('lib/database/connection.ts', content);
console.log('Written connection.ts');
