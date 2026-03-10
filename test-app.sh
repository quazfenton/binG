#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "=== App Logs (last 50 lines) ==="
docker-compose -f docker-compose.v2.yml logs --tail=50 app
echo ""
echo "=== Testing Frontend ==="
echo "Trying curl..."
curl -v http://localhost:5555 2>&1
echo ""
echo "=== Container Status ==="
docker-compose -f docker-compose.v2.yml ps
