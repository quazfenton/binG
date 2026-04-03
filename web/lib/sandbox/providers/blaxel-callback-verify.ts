/**
 * Blaxel Callback Verification Utility
 *
 * Verifies webhook callback signatures from Blaxel async executions.
 * Documentation: https://docs.blaxel.ai/Agents/Asynchronous-triggers
 *
 * @example
 * ```typescript
 * import { verifyBlaxelCallback } from './blaxel-callback-verify'
 *
 * app.post('/api/callback', async (req, res) => {
 *   const signature = req.headers['x-blaxel-signature']
 *   const timestamp = req.headers['x-blaxel-timestamp']
 *   const isValid = verifyBlaxelCallback(
 *     JSON.stringify(req.body),
 *     signature,
 *     timestamp,
 *     process.env.BLAXEL_CALLBACK_SECRET
 *   )
 *
 *   if (!isValid) {
 *     return res.status(401).json({ error: 'Invalid signature' })
 *   }
 *
 *   // Process callback
 *   res.json({ received: true })
 * })
 * ```
 */

import { createHmac, timingSafeEqual } from 'crypto'

export interface BlaxelCallbackPayload {
  status_code: number
  response_body: string
  response_length: number
  timestamp: number
}

/**
 * Verify Blaxel webhook callback signature
 *
 * @param payload - Raw JSON payload string
 * @param signature - Signature from X-Blaxel-Signature header
 * @param timestamp - Timestamp from X-Blaxel-Timestamp header
 * @param secret - Callback secret from Blaxel
 * @returns True if signature is valid
 */
export function verifyBlaxelCallback(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  try {
    // Construct signed payload: timestamp.payload
    const signedPayload = `${timestamp}.${payload}`

    // Compute expected signature
    const expectedSignature = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch (error) {
    console.error('[Blaxel] Callback verification error:', error)
    return false
  }
}

/**
 * Verify Blaxel callback from Express request
 *
 * @param req - Express request object
 * @param secret - Callback secret
 * @returns True if signature is valid
 */
export function verifyBlaxelCallbackFromRequest(
  req: {
    body: any
    headers: Record<string, string | undefined>
  },
  secret: string
): boolean {
  const signature = req.headers['x-blaxel-signature']
  const timestamp = req.headers['x-blaxel-timestamp']

  if (!signature || !timestamp) {
    return false
  }

  // Remove 'sha256=' prefix if present
  const cleanSignature = signature.replace(/^sha256=/, '')

  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

  return verifyBlaxelCallback(payload, cleanSignature, timestamp, secret)
}

/**
 * Create Express middleware for Blaxel callback verification
 *
 * @param secret - Callback secret (or function to get secret based on request)
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import { blaxelCallbackMiddleware } from './blaxel-callback-verify'
 *
 * app.post('/api/blaxel/callback',
 *   blaxelCallbackMiddleware(process.env.BLAXEL_CALLBACK_SECRET!),
 *   handleCallback
 * )
 * ```
 */
export function blaxelCallbackMiddleware(secret: string | ((req: any) => string)) {
  return (req: any, res: any, next: any) => {
    try {
      const secretValue = typeof secret === 'function' ? secret(req) : secret

      if (!secretValue) {
        return res.status(500).json({ error: 'Callback secret not configured' })
      }

      const isValid = verifyBlaxelCallbackFromRequest(req, secretValue)

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' })
      }

      next()
    } catch (error: any) {
      console.error('[Blaxel] Callback verification error:', error.message)
      res.status(500).json({ error: 'Verification failed' })
    }
  }
}

/**
 * Parse and validate Blaxel callback payload
 *
 * @param payload - Raw JSON payload string
 * @returns Parsed and validated payload
 */
export function parseBlaxelCallbackPayload(payload: string): BlaxelCallbackPayload | null {
  try {
    const parsed = JSON.parse(payload)

    // Validate required fields
    if (
      typeof parsed.status_code !== 'number' ||
      typeof parsed.response_body !== 'string' ||
      typeof parsed.response_length !== 'number' ||
      typeof parsed.timestamp !== 'number'
    ) {
      console.error('[Blaxel] Invalid callback payload structure')
      return null
    }

    return parsed
  } catch (error) {
    console.error('[Blaxel] Failed to parse callback payload:', error)
    return null
  }
}
