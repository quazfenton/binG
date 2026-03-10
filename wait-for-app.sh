#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Waiting for Next.js compilation..."
for i in {1..60}; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5555 2>/dev/null || echo "000")
  if [ "$RESPONSE" != "000" ]; then
    echo "✓ Frontend is UP! HTTP Status: $RESPONSE"
    echo ""
    echo "Access at: http://localhost:5555"
    exit 0
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "Still waiting... ($i seconds)"
    docker-compose -f docker-compose.v2.yml logs --tail=5 app 2>/dev/null
  fi
  sleep 1
done
echo ""
echo "Timeout after 60 seconds. Checking logs..."
docker-compose -f docker-compose.v2.yml logs --tail=50 app
