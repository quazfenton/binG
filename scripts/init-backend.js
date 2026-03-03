#!/usr/bin/env node
/**
 * Backend Initialization Script
 * Starts all backend services (WebSocket terminal, metrics, etc.)
 * 
 * Usage:
 *   npm run backend:init
 *   or
 *   node scripts/init-backend.js
 */

const { WebSocketTerminalServer, sandboxMetrics, metricsEndpoint } = require('../.next/server/app/api/backend/route.js');

async function main() {
  console.log('🚀 Initializing backend services...');
  
  try {
    // Start WebSocket terminal server
    const wsPort = process.env.WEBSOCKET_PORT || 8080;
    const wsServer = new WebSocketTerminalServer(wsPort);
    await wsServer.start();
    console.log(`✅ WebSocket terminal server started on port ${wsPort}`);
    console.log(`   Connect via: ws://localhost:${wsPort}/sandboxes/{sandboxId}/terminal`);
    
    // Start metrics endpoint (handled by Next.js at /api/metrics)
    console.log(`✅ Metrics endpoint available at: http://localhost:3000/api/metrics`);
    console.log(`   Prometheus scrape: curl http://localhost:3000/api/metrics`);
    
    // Log available metrics
    console.log('\n📊 Available metrics:');
    const samples = sandboxMetrics.registry.getSamples();
    samples.forEach(sample => {
      console.log(`   - ${sample.name} (${sample.type})`);
    });
    
    console.log('\n✅ Backend initialization complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Start Next.js dev server: npm run dev');
    console.log('   2. Test WebSocket: ws://localhost:8080/sandboxes/test123/terminal');
    console.log('   3. Check metrics: curl http://localhost:3000/api/metrics');
    console.log('   4. Create sandbox: POST /api/backend/sandbox/create');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down backend services...');
      await wsServer.stop();
      console.log('✅ Backend services stopped');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Backend initialization failed:', error.message);
    process.exit(1);
  }
}

main();
