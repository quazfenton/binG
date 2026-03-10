#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Removing .next folder..."
rm -rf .next
echo "Stopping containers..."
docker-compose -f docker-compose.v2.yml down
echo "Starting fresh..."
docker-compose -f docker-compose.v2.yml up -d
echo "Waiting 45 seconds for Next.js to compile..."
sleep 45
echo "Checking status..."
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "App logs:"
docker-compose -f docker-compose.v2.yml logs --tail=50 app
