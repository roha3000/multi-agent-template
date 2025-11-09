# Docker Deployment Guide

Complete guide for deploying applications with Docker including Dockerfile creation, Docker Compose, and best practices.

## Dockerfile Basics

### Simple Node.js Application

```dockerfile
# Use official Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server.js"]
```

### Multi-stage Build (Optimized)

```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

## Docker Commands

### Building Images

```bash
# Build image
docker build -t myapp:latest .

# Build with specific Dockerfile
docker build -f Dockerfile.prod -t myapp:prod .

# Build with build args
docker build --build-arg NODE_ENV=production -t myapp:latest .

# Build without cache
docker build --no-cache -t myapp:latest .
```

### Running Containers

```bash
# Run container
docker run -d -p 3000:3000 --name myapp myapp:latest

# Run with environment variables
docker run -d -p 3000:3000 -e NODE_ENV=production myapp:latest

# Run with volume mount
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data myapp:latest

# Run with custom network
docker run -d --network mynetwork --name myapp myapp:latest
```

### Managing Containers

```bash
# List running containers
docker ps

# List all containers
docker ps -a

# Stop container
docker stop myapp

# Start container
docker start myapp

# Restart container
docker restart myapp

# Remove container
docker rm myapp

# View logs
docker logs myapp

# Follow logs
docker logs -f myapp

# Execute command in container
docker exec -it myapp sh

# View container stats
docker stats myapp
```

### Managing Images

```bash
# List images
docker images

# Remove image
docker rmi myapp:latest

# Tag image
docker tag myapp:latest myapp:v1.0.0

# Push to registry
docker push username/myapp:latest

# Pull from registry
docker pull username/myapp:latest

# Remove unused images
docker image prune

# Remove all unused resources
docker system prune -a
```

## Docker Compose

### Basic docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/mydb
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=mydb
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  db-data:
```

### Advanced docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db:5432/mydb
      - REDIS_URL=redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=mydb
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    networks:
      - app-network
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    networks:
      - app-network
    restart: unless-stopped

networks:
  app-network:
    driver: bridge

volumes:
  db-data:
```

### Docker Compose Commands

```bash
# Start services
docker-compose up

# Start in detached mode
docker-compose up -d

# Build and start
docker-compose up --build

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# View logs
docker-compose logs

# Follow logs for specific service
docker-compose logs -f app

# List services
docker-compose ps

# Execute command
docker-compose exec app sh

# Restart service
docker-compose restart app

# Scale service
docker-compose up -d --scale app=3
```

## Best Practices

### 1. Use .dockerignore

```
# .dockerignore
node_modules
npm-debug.log
.env
.git
.gitignore
README.md
.DS_Store
coverage
.vscode
.idea
```

### 2. Minimize Layers

```dockerfile
# Bad - Multiple RUN commands
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y git

# Good - Combined into one layer
RUN apt-get update && \
    apt-get install -y curl git && \
    rm -rf /var/lib/apt/lists/*
```

### 3. Leverage Build Cache

```dockerfile
# Copy package files first (changes less frequently)
COPY package*.json ./
RUN npm ci

# Copy application files last (changes more frequently)
COPY . .
```

### 4. Use Specific Image Tags

```dockerfile
# Bad - can break unexpectedly
FROM node:latest

# Good - specific version
FROM node:18.17.0-alpine
```

### 5. Don't Run as Root

```dockerfile
# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
COPY --chown=nodejs:nodejs . .

# Switch to non-root user
USER nodejs
```

### 6. Use Health Checks

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```

### 7. Set Environment Variables

```dockerfile
# Build-time variables
ARG NODE_ENV=production

# Runtime environment variables
ENV NODE_ENV=${NODE_ENV} \
    PORT=3000 \
    LOG_LEVEL=info
```

## Security Best Practices

### 1. Scan for Vulnerabilities

```bash
# Scan image with Docker
docker scan myapp:latest

# Scan with Trivy
trivy image myapp:latest
```

### 2. Use Secrets Management

```bash
# Use Docker secrets (Swarm mode)
docker secret create db_password ./password.txt
docker service create --secret db_password myapp

# Use environment file
docker run --env-file .env myapp:latest
```

### 3. Limit Container Resources

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs myapp

# Inspect container
docker inspect myapp

# Check exit code
docker ps -a | grep myapp
```

### Connection Issues

```bash
# Check networks
docker network ls
docker network inspect mynetwork

# Test connectivity
docker exec myapp ping db
```

### Performance Issues

```bash
# View resource usage
docker stats

# Inspect processes
docker top myapp
```

### Clean Up

```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Remove all unused resources
docker system prune -a
```

## Production Deployment

### Using Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml myapp

# List services
docker service ls

# Scale service
docker service scale myapp_app=5

# View logs
docker service logs myapp_app

# Remove stack
docker stack rm myapp
```

### Using Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: myapp:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
          requests:
            memory: "256Mi"
            cpu: "250m"
```

## Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Docker Security](https://docs.docker.com/engine/security/)
