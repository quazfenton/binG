#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Removing all containers and volumes..."
docker-compose -f docker-compose.v2.yml down -v
echo "Starting fresh build..."
docker-compose -f docker-compose.v2.yml up -d --build
echo "Waiting for app to start..."
sleep 20
echo "Checking status..."
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "App logs:"
docker-compose -f docker-compose.v2.yml logs --tail=50 app
