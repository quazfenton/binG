#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Stopping existing containers..."
docker-compose -f docker-compose.v2.yml down
echo "Starting fresh..."
docker-compose -f docker-compose.v2.yml up -d
echo "Checking status..."
docker-compose -f docker-compose.v2.yml ps
echo ""
echo "Logs (last 50 lines):"
docker-compose -f docker-compose.v2.yml logs --tail=50
