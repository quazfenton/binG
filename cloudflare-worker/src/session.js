/**
 * Durable Object for session management
 */

import { parallelExplorers } from './orchestration/parallelExplorers.js';
import { chainRefiner } from './orchestration/chainRefiner.js';
import { reflectCritic } from './orchestration/reflectCritic.js';
import { evaluateMultiMetric } from './evaluator.js';
import { loadConfig, PLACEHOLDER_MESSAGES } from './config.js';
import { verifyHmac } from './core.js';

export class Session {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    
    if (req.method === 'POST' && url.pathname === '/start') {
      return this.start(req);
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      return this.status(req);
    }
    if (req.method === 'POST' && url.pathname === '/callback') {
      return this.callback(req);
    }
    if (req.method === 'POST' && url.pathname === '/cancel') {
      return this.cancel(req);
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      return this.stream(req);
    }
    
    return new Response('Not found', { status: 404 });
  }

  async start(req) {
    try {
      const body = await req.json();
      const { prompt, mode, options } = body;
      
      const id = crypto.randomUUID();
      const config = await loadConfig(this.env, options);
      
      const meta = {
        id,
        prompt,
        mode: mode || 'quality',
        config,
        status: 'running',
        createdAt: Date.now(),
        chain: [],
        events: []
      };
      
      await this.state.storage.put('meta', meta);
      
      // Start orchestration asynchronously
      this.orchestrate(meta).catch(err => {
        this.pushEvent({ level: 'error', msg: String(err) });
        this.updateStatus('failed');
      });
      
      return new Response(JSON.stringify({ id }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async status(req) {
    const meta = await this.state.storage.get('meta');
    const events = await this.state.storage.get('events') || [];
    
    return new Response(JSON.stringify({ meta, events }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async callback(req) {
    try {
      const secret = this.env.N8N_SECRET;
      
      if (secret) {
        const signature = req.headers.get('x-n8n-signature');
        const bodyText = await req.text();
        const valid = await verifyHmac(bodyText, signature, secret);
        
        if (!valid) {
          return new Response('Invalid signature', { status: 403 });
        }
        
        const json = JSON.parse(bodyText);
        return this.handleCallback(json);
      } else {
        const json = await req.json();
        return this.handleCallback(json);
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500
      });
    }
  }

  async cancel(req) {
    await this.updateStatus('cancelled');
    await this.pushEvent({ level: 'info', msg: 'Cancelled by user' });
    return new Response('cancelled');
  }

  async stream(req) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    
    // Start streaming events
    this.streamEvents(writer, encoder).catch(console.error);
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  }

  async streamEvents(writer, encoder) {
    let lastEventCount = 0;
    let placeholderIndex = 0;
    let finished = false;
    
    while (!finished) {
      const meta = await this.state.storage.get('meta');
      const events = await this.state.storage.get('events') || [];
      
      // Send new events
      for (let i = lastEventCount; i < events.length; i++) {
        const event = events[i];
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      lastEventCount = events.length;
      
      // Send placeholder if still running
      if (meta?.status === 'running') {
        const placeholder = PLACEHOLDER_MESSAGES[placeholderIndex % PLACEHOLDER_MESSAGES.length];
        await writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: 'placeholder', 
          message: placeholder 
        })}\n\n`));
        placeholderIndex++;
      }
      
      // Check if finished
      if (meta?.status !== 'running') {
        finished = true;
        await writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: 'complete', 
          status: meta.status 
        })}\n\n`));
      }
      
      if (!finished) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    await writer.close();
  }

  async orchestrate(meta) {
    await this.pushEvent({ level: 'info', msg: 'Starting orchestration' });
    
    const config = meta.config;
    const mode = meta.mode;
    
    // Build variants based on mode
    let variants = config.variants;
    if (mode === 'fast') {
      variants = variants.slice(0, 2); // Use fewer variants
    }
    
    const inputs = variants.map(v => ({
      name: v.name,
      prompt: `${meta.prompt}\n\n${v.modifier}`.trim(),
      agentConfig: config.agents[v.agentConfig] || config.agents.draft
    }));
    
    const callAgent = async ({ prompt, agentConfig, attempt }) => {
      return this.callFastAgent(prompt, agentConfig, attempt);
    };
    
    const scoreFn = async (res) => {
      const text = res.text || (typeof res === 'string' ? res : JSON.stringify(res));
      const evaluation = await evaluateMultiMetric(text, config, this.env);
      return evaluation.totalScore;
    };
    
    // Phase 1: Parallel exploration
    await this.pushEvent({ level: 'info', msg: 'Exploring parallel variants' });
    
    const { candidates, winner, polished } = await parallelExplorers({
      inputs,
      callAgent,
      scoreFn,
      concurrency: config.orchestration.parallelConcurrency,
      finalPolish: config.agents.polish
    });
    
    meta.candidates = candidates;
    meta.winner = winner;
    meta.polished = polished;
    await this.state.storage.put('meta', meta);
    
    await this.pushEvent({ 
      level: 'info', 
      msg: `Winner selected: ${winner?.name}`, 
      data: { score: winner?.score } 
    });
    
    // Phase 2: Iterative refinement (if needed)
    const polishedText = polished ? (polished.text || polished) : (winner.res.text || winner.res);
    const polishedScore = await scoreFn({ text: polishedText });
    
    if (polishedScore < config.quality.threshold) {
      await this.pushEvent({ 
        level: 'info', 
        msg: `Score ${polishedScore.toFixed(3)} below threshold, refining...` 
      });
      
      const final = await chainRefiner({
        initialPrompt: polishedText,
        callAgent,
        evaluate: scoreFn,
        maxAttempts: config.orchestration.maxIterations,
        qualityThreshold: config.quality.threshold
      });
      
      meta.final = final;
      meta.status = final.ok ? 'succeeded' : 'needs_review';
    } else {
      meta.final = { ok: true, best: { text: polishedText }, score: polishedScore };
      meta.status = 'succeeded';
    }
    
    await this.state.storage.put('meta', meta);
    await this.pushEvent({ 
      level: 'info', 
      msg: 'Orchestration complete', 
      data: { status: meta.status } 
    });
  }

  async callFastAgent(prompt, agentConfig, attempt = 0) {
    const payload = {
      prompt,
      agentConfig,
      meta: { attempt }
    };
    
    const response = await fetch(this.env.FAST_AGENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.FAST_AGENT_KEY}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Fast-Agent responded with ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    
    return { text: await response.text() };
  }

  async handleCallback(json) {
    const meta = await this.state.storage.get('meta') || {};
    const chain = meta.chain || [];
    
    chain.push({ from: 'n8n', time: Date.now(), payload: json });
    meta.chain = chain;
    await this.state.storage.put('meta', meta);
    
    await this.pushEvent({ 
      level: 'info', 
      msg: 'Callback received', 
      data: json 
    });
    
    return new Response('ok');
  }

  async pushEvent(evt) {
    const events = await this.state.storage.get('events') || [];
    events.push({ time: Date.now(), ...evt });
    
    if (events.length > 100) {
      events.splice(0, events.length - 100);
    }
    
    await this.state.storage.put('events', events);
  }

  async updateStatus(status) {
    const meta = await this.state.storage.get('meta') || {};
    meta.status = status;
    await this.state.storage.put('meta', meta);
  }
}
