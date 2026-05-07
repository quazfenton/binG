/**
 * Quick debug test for mock DB UPDATE behavior
 */
import { describe, it, expect, beforeEach } from 'vitest';

process.env.SKIP_DB_INIT = 'true';
process.env.SKIP_DB_INIT_TEMP = 'true';

import { resetMockDatabase, default as getDatabase } from '@/lib/database/connection';

describe('MockDB UPDATE debug', () => {
  beforeEach(() => {
    resetMockDatabase();
  });

  it('should parse SET clause with COALESCE correctly', () => {
    const db = getDatabase();
    
    // Insert a row
    db.prepare('INSERT OR REPLACE INTO chat_request_logs (id, user_id, provider, model, message_count, request_size, streaming, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run('debug-001', 'user-123', 'openai', 'gpt-4o', 0, 0, 1, 'mock-callback');

    const before = db.prepare('SELECT * FROM chat_request_logs WHERE id = ?').get('debug-001');
    console.log('Before UPDATE:', JSON.stringify(before));

    // The exact SQL from logRequestComplete
    const sql = `UPDATE chat_request_logs SET provider = COALESCE(?, provider), model = COALESCE(?, model), success = ?, error = ?, latency_ms = ?, logging_extension = ? WHERE id = ? AND created_at IS NOT NULL`;
    console.log('SQL:', sql);
    console.log('Params:', 'mistral', 'mistral-small-latest', 0, 'Rate limited', 5000, null, 'debug-001');

    const result = db.prepare(sql).run(
      'mistral',           // COALESCE(?, provider)
      'mistral-small-latest', // COALESCE(?, model)
      0,                   // success
      'Rate limited',      // error
      5000,                // latency_ms
      null,                // logging_extension
      'debug-001'          // WHERE id = ?
    );
    console.log('UPDATE result:', JSON.stringify(result));

    const after = db.prepare('SELECT * FROM chat_request_logs WHERE id = ?').get('debug-001');
    console.log('After UPDATE:', JSON.stringify(after));

    expect(after.provider).toBe('mistral');
    expect(after.model).toBe('mistral-small-latest');
    expect(after.latency_ms).toBe(5000);
  });
});