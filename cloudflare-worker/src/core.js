/**
 * Core utilities for orchestration
 */

/**
 * Execute functions in parallel with concurrency limit
 */
export async function parallelMap(inputs, workerFn, concurrency = 4) {
  const results = [];
  const queue = [...inputs];
  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        try {
          const result = await workerFn(item);
          results.push(result);
        } catch (err) {
          results.push({ 
            error: err.message || String(err), 
            item,
            failed: true 
          });
        }
      }
    });
  
  await Promise.all(workers);
  return results;
}

/**
 * Execute functions sequentially
 */
export async function sequenceMap(items, fn) {
  const results = [];
  for (const item of items) {
    try {
      const result = await fn(item);
      results.push(result);
    } catch (err) {
      results.push({ 
        error: err.message || String(err), 
        item,
        failed: true 
      });
    }
  }
  return results;
}

/**
 * Pick best result by score function
 */
export function pickBestBy(arr, scoreFn) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((best, cur) => {
    const bestScore = scoreFn(best);
    const curScore = scoreFn(cur);
    return curScore > bestScore ? cur : best;
  }, arr[0]);
}

/**
 * Calculate average score
 */
export function avgScore(scores) {
  if (!scores || scores.length === 0) return 0;
  const sum = scores.reduce((a, b) => a + b, 0);
  return sum / scores.length;
}

/**
 * Hash string (simple FNV-1a)
 */
export function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Verify HMAC signature
 */
export async function verifyHmac(body, signature, secret) {
  if (!signature || !secret) return false;
  
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signatureBuffer = base64ToArrayBuffer(signature);
    const bodyBuffer = encoder.encode(body);
    
    return await crypto.subtle.verify('HMAC', key, signatureBuffer, bodyBuffer);
  } catch (e) {
    console.error('HMAC verification failed:', e);
    return false;
  }
}

/**
 * Generate HMAC signature
 */
export async function generateHmac(body, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return arrayBufferToBase64(signature);
}

/**
 * Base64 utilities
 */
function base64ToArrayBuffer(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = atob(b64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Estimate token count (rough approximation)
 */
export function estimateTokens(text) {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Chunk text into smaller pieces
 */
export function chunkText(text, maxChunkSize = 30) {
  const chunks = [];
  let offset = 0;
  
  while (offset < text.length) {
    let endOffset = Math.min(offset + maxChunkSize, text.length);
    
    // Try to break at word boundaries
    if (endOffset < text.length) {
      const nextSpace = text.indexOf(' ', endOffset);
      const nextNewline = text.indexOf('\n', endOffset);
      
      if (nextSpace !== -1 && nextSpace - endOffset < 20) {
        endOffset = nextSpace;
      } else if (nextNewline !== -1 && nextNewline - endOffset < 30) {
        endOffset = nextNewline + 1;
      }
    }
    
    chunks.push(text.slice(offset, endOffset));
    offset = endOffset;
  }
  
  return chunks;
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}
