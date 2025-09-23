/**
 * A small express proxy for Puter requests.
 * - Uses server-side DEFAULT_PUTER_KEY as default authorization
 * - Exposes /api/puter/chat which forwards to api.puter.com/puterai/chat
 * - Adds basic rate-limiting and simple logging
 *
 * Note: run this on a server (separate from client bundle). In dev, you can run it locally and configure Vite to proxy /api/*.
 */

import express from 'express'
import fetch from 'node-fetch'
import rateLimit from 'express-rate-limit'

const app = express()
app.use(express.json({ limit: '1mb' }))

const PORT = Number(process.env.PORT || 8787)
const DEFAULT_PUTER_KEY = process.env.DEFAULT_PUTER_KEY || '' // set in server env

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
})

app.use('/api/puter/', limiter)

app.post('/api/puter/chat', async (req, res) => {
  try {
    const model = req.query.model ? String(req.query.model) : undefined
    const stream = req.query.stream === '1' || req.query.stream === 'true'
    const url = new URL('https://api.puter.com/puterai/chat')
    if (model) url.searchParams.set('model', model)
    if (stream) url.searchParams.set('stream', '1')

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'binG-puter-proxy/1',
    }
    // If client supplied a key in body.meta.apiKey, forward it; otherwise use server default key
    const clientKey = (req.body?.meta?.apiKey as string) || ''
    if (clientKey) {
      headers['Authorization'] = `Bearer ${clientKey}`
    } else if (DEFAULT_PUTER_KEY) {
      headers['Authorization'] = `Bearer ${DEFAULT_PUTER_KEY}`
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body ?? {}),
    })

    // Stream back if streaming
    if (response.body && stream) {
      res.status(response.status)
      response.body.pipe(res as any)
      return
    }

    const json = await response.text()
    res.status(response.status).send(json)
  } catch (err) {
    console.error('proxy error', err)
    res.status(500).send({ error: 'proxy failed' })
  }
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Puter proxy listening on ${PORT}`)
  })
}

export default app