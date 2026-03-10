#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "=== Complete Rebuild ==="
docker-compose -f docker-compose.v2.yml down -v
docker system prune -f
echo "Building fresh image..."
docker-compose -f docker-compose.v2.yml build --no-cache
echo "Starting services..."
docker-compose -f docker-compose.v2.yml up -d
echo "Waiting 60 seconds..."
sleep 60
echo "=== Status ==="
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "=== App Logs ==="
docker-compose -f docker-compose.v2.yml logs --tail=100 app
