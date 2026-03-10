#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "=== Docker Images ==="
docker images | grep bing
echo ""
echo "=== Docker Containers (all) ==="
docker ps -a | grep bing
echo ""
echo "=== Docker Compose Status ==="
docker-compose -f docker-compose.v2.yml ps -a
echo ""
echo "=== Last Build Logs ==="
docker-compose -f docker-compose.v2.yml logs --tail=20
