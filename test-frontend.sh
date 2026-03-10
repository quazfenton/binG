#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
echo "Waiting for app to start..."
sleep 15
echo "Testing frontend..."
curl -s -o /dev/null -w "%{http_code}" http://localhost:5555
echo ""
echo "Checking app logs..."
docker-compose -f docker-compose.v2.yml logs --tail=30 app
