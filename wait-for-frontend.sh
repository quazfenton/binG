#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Waiting for Next.js to compile..."
for i in {1..30}; do
  STATUS=$(docker-compose -f docker-compose.v2.yml logs --tail=5 app | grep -c "Ready in" || echo "0")
  if [ "$STATUS" -gt 0 ]; then
    echo "✓ Next.js ready!"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 2
done
echo ""
echo "Testing frontend..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:5555
echo ""
echo "Last 20 app logs:"
docker-compose -f docker-compose.v2.yml logs --tail=20 app
