#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Checking container status..."
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "Last 30 app logs:"
docker-compose -f docker-compose.v2.yml logs --tail=30 app
echo ""
echo "Testing frontend..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:5555 || echo "Frontend not ready yet"
