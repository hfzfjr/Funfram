#!/bin/bash

# FunFram Deployment Script for Debian 13
# This script deploys the entire FunFram application using Docker Compose

set -e

echo "🚀 Starting FunFram deployment..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    usermod -aG docker $USER
    echo "✅ Docker installed successfully"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Installing Docker Compose..."
    curl -SL https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed successfully"
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ .env file created. Please edit it with your configuration before running this script again."
        exit 1
    else
        echo "❌ .env.example not found. Please create .env file manually."
        exit 1
    fi
fi

# Pull latest code from git
echo "📥 Pulling latest code from git..."
git pull origin main

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

# Build and start containers
echo "🔨 Building Docker images..."
docker compose build --no-cache

echo "🚀 Starting containers..."
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 10

# Check container status
echo "📊 Container status:"
docker compose ps

echo "✅ Deployment completed successfully!"
echo ""
echo "🌐 Frontend: http://localhost:3001"
echo "🔌 WebSocket Game: ws://localhost:5001/socket"
echo "🔌 WebRTC Signaling: ws://localhost:5002"
echo ""
echo "To view logs: docker compose logs -f"
echo "To stop: docker compose down"
