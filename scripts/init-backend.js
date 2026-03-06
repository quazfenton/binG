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

// Use the backend service module instead of importing from Next.js build
const { initializeBackend, getBackendStatus } = require('../lib/backend/backend-service');

async function main() {
  console.log('🚀 Initializing backend services...');

  try {
    // Initialize backend services (includes WebSocket terminal server)
    const wsPort = process.env.WEBSOCKET_PORT || 8080;
    const status = await initializeBackend({ websocketPort: wsPort });
    
    console.log(`✅ Backend services initialized`);
    console.log(`   WebSocket: ${status.websocket.running ? 'Running' : 'Failed'}`);
    console.log(`   Storage: ${status.storage.healthy ? 'Healthy' : 'Unhealthy'}`);
    console.log(`   Runtime: ${status.runtime.available ? 'Available' : 'Unavailable'}`);
    
    if (status.websocket.running) {
      console.log(`\n✅ WebSocket terminal server started on port ${wsPort}`);
      console.log(`   Connect via: ws://localhost:${wsPort}/sandboxes/{sandboxId}/terminal`);
    } else if (status.websocket.error) {
      console.log(`\n⚠️  WebSocket server unavailable: ${status.websocket.error}`);
      console.log(`   Terminal will use command-mode fallback`);
    }

    // Start metrics endpoint (handled by Next.js at /api/metrics)
    console.log(`\n✅ Metrics endpoint available at: http://localhost:3000/api/metrics`);
    console.log(`   Prometheus scrape: curl http://localhost:3000/api/metrics`);

    console.log('\n✅ Backend initialization complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Start Next.js dev server: npm run dev');
    console.log('   2. Test WebSocket: ws://localhost:8080/sandboxes/test123/terminal');
    console.log('   3. Check metrics: curl http://localhost:3000/api/metrics');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down backend services...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Backend initialization failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
