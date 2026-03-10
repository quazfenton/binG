#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Starting build..."
docker-compose -f docker-compose.v2.yml up -d --build 2>&1 | tee /tmp/docker-build.log
echo ""
echo "Build complete. Checking status..."
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "Last 50 app logs:"
docker-compose -f docker-compose.v2.yml logs --tail=50 app
