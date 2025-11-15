# Fast-Agent Subdomain Setup Guide

## Overview

This guide explains how to configure Fast-Agent on a subdomain of your main application domain.

## Architecture

```
Main App:      https://yourdomain.com
Fast-Agent:    https://fast-agent.yourdomain.com
               or
               https://agent.yourdomain.com
```

## DNS Configuration

### Option 1: Subdomain (Recommended)

Add an A record or CNAME:

```
Type: A
Name: fast-agent
Value: Your Fast-Agent server IP
TTL: 3600
```

Or CNAME:

```
Type: CNAME
Name: fast-agent
Value: your-fast-agent-server.example.com
TTL: 3600
```

### Option 2: Different Port

```
Main App:      https://yourdomain.com
Fast-Agent:    https://yourdomain.com:8080
```

## SSL/TLS Configuration

### Using Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate for subdomain
sudo certbot --nginx -d fast-agent.yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

### Using Cloudflare

1. Add subdomain to Cloudflare
2. Set SSL/TLS mode to "Full"
3. Enable "Always Use HTTPS"
4. Optional: Enable "Automatic HTTPS Rewrites"

## Nginx Configuration

```nginx
# /etc/nginx/sites-available/fast-agent

server {
    listen 80;
    server_name fast-agent.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name fast-agent.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/fast-agent.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fast-agent.yourdomain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # CORS for main domain
    add_header Access-Control-Allow-Origin "https://yourdomain.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/fast-agent /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Application Configuration

### Update .env

```env
# Development
FAST_AGENT_ENDPOINT=http://localhost:8080/api/chat

# Production - Subdomain
FAST_AGENT_ENDPOINT=https://fast-agent.yourdomain.com/api/chat

# Production - Same domain, different port
FAST_AGENT_ENDPOINT=https://yourdomain.com:8080/api/chat
```

### Update Fast-Agent Service

The service automatically detects subdomain configuration:

```typescript
// lib/api/fast-agent-service.ts
const endpoint = process.env.FAST_AGENT_ENDPOINT;
const isSubdomain = endpoint.includes('fast-agent.') || endpoint.includes('//agent.');

if (isSubdomain) {
  console.log('[FastAgent] Using subdomain configuration');
}
```

## Testing

### 1. Test DNS Resolution

```bash
nslookup fast-agent.yourdomain.com
dig fast-agent.yourdomain.com
```

### 2. Test SSL Certificate

```bash
curl -I https://fast-agent.yourdomain.com
openssl s_client -connect fast-agent.yourdomain.com:443
```

### 3. Test Fast-Agent Health

```bash
curl https://fast-agent.yourdomain.com/health
```

### 4. Test API Endpoint

```bash
curl -X POST https://fast-agent.yourdomain.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

### 5. Test from Main App

```bash
# From your Next.js app
npm run dev

# Check console for:
# [FastAgent] Using subdomain configuration: https://fast-agent.yourdomain.com/api/chat
```

## Security Considerations

### 1. CORS Configuration

Only allow requests from your main domain:

```nginx
add_header Access-Control-Allow-Origin "https://yourdomain.com" always;
```

### 2. API Key Authentication

```nginx
# Require API key
location / {
    if ($http_x_api_key != "your-secret-key") {
        return 401;
    }
    proxy_pass http://localhost:8080;
}
```

### 3. Rate Limiting

```nginx
limit_req_zone $binary_remote_addr zone=fastgent:10m rate=10r/s;

server {
    location / {
        limit_req zone=fastagent burst=20 nodelay;
        proxy_pass http://localhost:8080;
    }
}
```

### 4. IP Whitelist (Optional)

```nginx
# Only allow main app server
allow 1.2.3.4;  # Your main app server IP
deny all;
```

## Monitoring

### 1. Nginx Access Logs

```bash
tail -f /var/log/nginx/access.log | grep fast-agent
```

### 2. Fast-Agent Logs

```bash
# Check Fast-Agent application logs
journalctl -u fast-agent -f
```

### 3. SSL Certificate Expiry

```bash
# Check certificate expiry
echo | openssl s_client -servername fast-agent.yourdomain.com \
  -connect fast-agent.yourdomain.com:443 2>/dev/null | \
  openssl x509 -noout -dates
```

## Troubleshooting

### DNS Not Resolving

```bash
# Check DNS propagation
https://dnschecker.org

# Flush local DNS
sudo systemd-resolve --flush-caches
```

### SSL Certificate Issues

```bash
# Renew certificate
sudo certbot renew --force-renewal

# Check nginx configuration
sudo nginx -t
```

### CORS Errors

Check browser console and add:

```nginx
add_header Access-Control-Allow-Credentials true always;
```

### Connection Timeout

Increase proxy timeout:

```nginx
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
```

## Production Checklist

- [ ] DNS A/CNAME record configured
- [ ] SSL certificate installed and valid
- [ ] Nginx configuration tested
- [ ] CORS headers configured
- [ ] Rate limiting enabled
- [ ] API key authentication (optional)
- [ ] Monitoring and logging enabled
- [ ] Auto-renewal for SSL certificate
- [ ] Firewall rules configured
- [ ] Backup configuration files
- [ ] Test from main application
- [ ] Load testing completed

## Maintenance

### Certificate Renewal

Automatic with certbot:

```bash
# Check auto-renewal
sudo certbot renew --dry-run

# Manual renewal if needed
sudo certbot renew
sudo systemctl reload nginx
```

### Update DNS

If changing servers:

```bash
# Update A record to new IP
# Wait for DNS propagation (up to 48 hours)
# Test with: dig fast-agent.yourdomain.com
```

## Alternative: Docker Deployment

### docker-compose.yml

```yaml
version: '3.8'

services:
  fast-agent:
    image: your-fast-agent-image
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - HOST=0.0.0.0
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - fast-agent
    restart: unless-stopped
```

## Summary

✅ DNS configured for subdomain  
✅ SSL/TLS certificate installed  
✅ Nginx reverse proxy configured  
✅ CORS and security headers set  
✅ Application updated to use subdomain  
✅ Testing completed  
✅ Monitoring enabled  

Your Fast-Agent is now accessible at `https://fast-agent.yourdomain.com`!
