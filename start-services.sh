#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "=== Starting Services ==="
docker-compose -f docker-compose.v2.yml up -d
echo ""
echo "=== Waiting for startup (checking every 5 seconds for 60 seconds) ==="
for i in {1..12}; do
  echo "Check $i/12..."
  STATUS=$(docker-compose -f docker-compose.v2.yml ps | grep -c "bing-app" || echo "0")
  if [ "$STATUS" -gt 0 ]; then
    echo "✓ Container found!"
    break
  fi
  sleep 5
done
echo ""
echo "=== Container Status ==="
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "=== App Logs ==="
docker-compose -f docker-compose.v2.yml logs --tail=50 app
echo ""
echo "=== Testing Frontend ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:5555 || echo "Not accessible yet"
