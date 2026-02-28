# Deployment Guide

**Date:** February 27, 2026  
**Version:** 1.0

This guide covers deployment of the binG platform with all integrations.

---

## Prerequisites

- Node.js 18+
- PostgreSQL database
- pnpm package manager
- API keys for desired providers

---

## Environment Configuration

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bing

# Authentication
JWT_SECRET=your-32-char-secret-key-here

# Sandbox Providers (choose at least one)
DAYTONA_API_KEY=your_daytona_api_key
E2B_API_KEY=your_e2b_api_key
BLAXEL_API_KEY=your_blaxel_api_key
BLAXEL_WORKSPACE=your_workspace

# Tool Providers (optional)
COMPOSIO_API_KEY=your_composio_api_key
ARCADE_API_KEY=your_arcade_api_key
NANGO_SECRET_KEY=your_nango_secret_key
SMITHERY_API_KEY=your_smithery_api_key

# AI/LLM Providers
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_API_KEY=your_google_api_key

# Tambo (Generative UI)
NEXT_PUBLIC_TAMBO_API_KEY=your_tambo_api_key
NEXT_PUBLIC_TAMBO_ENABLED=true

# Mastra
MASTRA_TELEMETRY_ENABLED=true
MASTRA_MEMORY_ENABLED=true
MASTRA_EVALS_ENABLED=true

# Logging
LOG_LEVEL=info
```

---

## Docker Deployment

### 1. Build Image

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Expose port
EXPOSE 3000

# Start
CMD ["pnpm", "start"]
```

### 2. Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/bing
      - JWT_SECRET=${JWT_SECRET}
      - DAYTONA_API_KEY=${DAYTONA_API_KEY}
      - COMPOSIO_API_KEY=${COMPOSIO_API_KEY}
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=bing
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 3. Deploy

```bash
# Build and run
docker-compose up -d

# Check logs
docker-compose logs -f app

# Stop
docker-compose down
```

---

## Kubernetes Deployment

### 1. Create Namespace

```bash
kubectl create namespace bing
```

### 2. Create Secrets

```bash
kubectl create secret generic bing-secrets \
  --from-literal=DATABASE_URL=postgresql://... \
  --from-literal=JWT_SECRET=your-secret \
  --from-literal=DAYTONA_API_KEY=your-key \
  -n bing
```

### 3. Deploy Application

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bing-app
  namespace: bing
spec:
  replicas: 3
  selector:
    matchLabels:
      app: bing
  template:
    metadata:
      labels:
        app: bing
    spec:
      containers:
      - name: app
        image: your-registry/bing:latest
        ports:
        - containerPort: 3000
        envFrom:
        - secretRef:
            name: bing-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
```

### 4. Create Service

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: bing-service
  namespace: bing
spec:
  selector:
    app: bing
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### 5. Deploy

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Check status
kubectl get pods -n bing
kubectl get services -n bing
```

---

## Vercel Deployment

### 1. Connect Repository

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link project
vercel link
```

### 2. Configure Environment

Add all environment variables in Vercel dashboard:
- Settings → Environment Variables

### 3. Deploy

```bash
# Preview
vercel

# Production
vercel --prod
```

---

## Railway Deployment

### 1. Connect Repository

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Init project
railway init
```

### 2. Add Variables

```bash
# Add environment variables
railway variables set DATABASE_URL=...
railway variables set JWT_SECRET=...
```

### 3. Deploy

```bash
railway up
```

---

## Health Checks

### API Health

```bash
curl https://your-domain.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Provider Health

```bash
# Check sandbox providers
curl https://your-domain.com/api/sandbox/health

# Check tool providers
curl https://your-domain.com/api/tools/health
```

---

## Monitoring

### Logs

```bash
# Docker
docker-compose logs -f app

# Kubernetes
kubectl logs -f deployment/bing-app -n bing

# Vercel
vercel logs
```

### Metrics

Key metrics to monitor:
- API response times
- Sandbox creation times
- Tool execution success rates
- Error rates by provider
- Memory usage
- CPU usage

### Alerts

Set up alerts for:
- Error rate > 5%
- Response time > 5s
- Memory usage > 80%
- Sandbox creation failures

---

## Scaling

### Horizontal Scaling

```yaml
# Kubernetes HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: bing-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: bing-app
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Database Scaling

- Use connection pooling
- Enable read replicas
- Implement query caching
- Monitor slow queries

---

## Security

### Best Practices

1. **Never commit secrets**
   - Use environment variables
   - Use secret management services

2. **Enable HTTPS**
   - Use Let's Encrypt or similar
   - Force HTTPS redirects

3. **Rate Limiting**
   - Already implemented in API routes
   - Configure based on your needs

4. **Input Validation**
   - All inputs validated with Zod
   - Command injection prevention
   - Path traversal prevention

5. **Audit Logging**
   - Enable Mastra telemetry
   - Log all tool executions
   - Monitor for anomalies

---

## Backup & Recovery

### Database Backup

```bash
# PostgreSQL backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

### Automated Backups

```yaml
# k8s/backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15
            command:
            - /bin/sh
            - -c
            - pg_dump $DATABASE_URL > /backups/backup-$(date +%Y%m%d).sql
            envFrom:
            - secretRef:
                name: bing-secrets
            volumeMounts:
            - name: backups
              mountPath: /backups
          volumes:
          - name: backups
            persistentVolumeClaim:
              claimName: backups-pvc
          restartPolicy: OnFailure
```

---

## Troubleshooting

### Common Issues

**Issue:** Sandbox creation fails  
**Solution:** Check provider API key and quota

**Issue:** Tool execution timeout  
**Solution:** Increase timeout in provider config

**Issue:** Memory limit exceeded  
**Solution:** Scale horizontally or increase limits

**Issue:** Database connection errors  
**Solution:** Check connection string and pool settings

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug pnpm start

# Check provider status
curl https://your-domain.com/api/providers/status
```

---

## Support

For issues:
1. Check logs
2. Review error messages
3. Check provider status pages
4. Contact support

Documentation: `/docs`  
API Reference: `/api/docs`
