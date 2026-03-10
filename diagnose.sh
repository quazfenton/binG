#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "=== Docker Build Status ==="
docker-compose -f docker-compose.v2.yml ps -a
echo ""
echo "=== Docker Images ==="
docker images | grep bing
echo ""
echo "=== Starting Services ==="
docker-compose -f docker-compose.v2.yml up -d
echo ""
echo "=== Waiting 30 seconds for startup ==="
sleep 30
echo ""
echo "=== Container Status ==="
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "=== App Logs ==="
docker-compose -f docker-compose.v2.yml logs --tail=100 app
echo ""
echo "=== Frontend Test ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:5555 || echo "Not accessible yet"
