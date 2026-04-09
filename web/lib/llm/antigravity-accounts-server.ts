/**
 * Server-only wrapper for antigravity-accounts module.
 * 
 * This file is explicitly server-only (has 'use server' directive).
 * Import this file instead of antigravity-accounts.ts directly
 * from any code that runs on the server.
 * 
 * Purpose: Prevent webpack from bundling better-sqlite3 into
 * client components by creating an explicit server boundary.
 */

import { getAntigravityAccounts } from '@/lib/database/antigravity-accounts';

export { getAntigravityAccounts };
