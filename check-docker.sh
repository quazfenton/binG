#!/bin/bash
cd /mnt/c/Users/ceclabs/Downloads/binG
docker-compose -f docker-compose.v2.yml ps
docker-compose -f docker-compose.v2.yml logs --tail=100
