#!/bin/bash
# 9Router VPS Setup Script
# Run this on a fresh VPS to deploy 9Router with Docker

set -e

echo ========================================
echo 9Router Multi-Tenant Fork Setup
echo ========================================

# Check if running as root
if [ '$EUID' -eq 0 ]; then
   echo 'Warning: Running as root. Consider creating a dedicated user.'
fi

# Update system and install prerequisites
echo '[1/6] Updating system and installing prerequisites...'
apt-get update -y
apt-get install -y curl git docker.io docker-compose-v2

# Enable Docker
systemctl enable docker
systemctl start docker

# Create application directory
echo '[2/6] Creating application directory...'
mkdir -p /opt/9router
cd /opt/9router

# Clone the 9Router fork (replace with your fork URL)
echo '[3/6] Cloning 9Router fork...'
echo 'Please clone your 9Router fork into /opt/9router'
echo 'Example: git clone https://github.com/your-org/9router.git .'
echo ''
read -p 'Press Enter when you have cloned the repository...'

# Copy environment template
if [ ! -f .env ]; then
    echo '[4/6] Setting up environment variables...'
    cp .env.example .env
    echo 'Please edit .env and add your OAuth credentials and admin key:'
    echo '  nano /opt/9router/.env'
    echo ''
    read -p 'Press Enter when you have configured .env...'
fi

# Apply database migrations
echo '[5/6] Applying database migrations...'
# Run migrations (adjust based on your migration system)
# For SQLite with migrations folder:
# node src/lib/db/migrate.js

# Pull Docker image and start
echo '[6/6] Building and starting 9Router...'
docker build -t 9router:latest .
docker compose up -d

# Verify deployment
echo ''
echo ========================================
echo Deployment Complete!
echo ========================================
echo ''
echo '9Router is running at: http://your-server-ip:20128'
echo ''
echo 'Useful commands:'
echo '  docker compose logs -f    # View logs'
echo '  docker compose restart    # Restart service'
echo '  docker compose down       # Stop service'
echo '  docker compose exec 9router sh  # Shell into container'
echo ''
echo 'Next steps:'
echo '  1. Configure your OAuth provider credentials in .env'
echo '  2. Set NINEROUTER_ADMIN_KEY (generate with: openssl rand -hex 32)'
echo '  3. Access the 9Router API at http://your-vps-ip:20128'
echo '  4. Configure your binG app to connect to http://your-vps-ip:20128'