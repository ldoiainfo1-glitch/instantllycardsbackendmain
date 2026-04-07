#!/bin/bash
# ============================================
# Instantlly Backend - Deploy to EC2
# Usage: bash deploy/deploy.sh <EC2_IP> <PEM_PATH>
# Example: bash deploy/deploy.sh 13.232.100.50 ~/.ssh/instantlly.pem
# ============================================

set -euo pipefail

EC2_IP="${1:?Usage: deploy.sh <EC2_IP> <PEM_PATH>}"
PEM_PATH="${2:?Usage: deploy.sh <EC2_IP> <PEM_PATH>}"
USER="ubuntu"
APP_DIR="/home/ubuntu/instantlly-backend"
SSH_CMD=(ssh -i "$PEM_PATH" -o StrictHostKeyChecking=no "$USER@$EC2_IP")

echo "=========================================="
echo "  Deploying Instantlly Backend to EC2"
echo "  Server: $EC2_IP"
echo "=========================================="

# Step 1: Build locally
echo ""
echo ">>> Step 1: Building TypeScript..."
npm run build
echo "Build complete."

# Step 2: Create directories on server
echo ""
echo ">>> Step 2: Preparing server directories..."
"${SSH_CMD[@]}" "mkdir -p $APP_DIR/prisma/migrations $APP_DIR/dist /home/ubuntu/logs"

# Step 3: Sync files to EC2
echo ""
echo ">>> Step 3: Uploading files..."

# Upload dist (compiled JS)
"${SSH_CMD[@]}" "rm -rf $APP_DIR/dist"
scp -i "$PEM_PATH" -o StrictHostKeyChecking=no -r dist $USER@$EC2_IP:$APP_DIR/

# Upload package files
scp -i "$PEM_PATH" -o StrictHostKeyChecking=no \
  package.json package-lock.json ecosystem.config.js tsconfig.json \
  $USER@$EC2_IP:$APP_DIR/

# Upload Prisma schema and migrations
"${SSH_CMD[@]}" "rm -rf $APP_DIR/prisma"
scp -i "$PEM_PATH" -o StrictHostKeyChecking=no -r prisma $USER@$EC2_IP:$APP_DIR/

# Upload prisma.config.ts (needed for prisma generate)
scp -i "$PEM_PATH" -o StrictHostKeyChecking=no \
  prisma.config.ts $USER@$EC2_IP:$APP_DIR/

# Upload Nginx config
scp -i "$PEM_PATH" -o StrictHostKeyChecking=no \
  deploy/nginx-instantlly.conf $USER@$EC2_IP:~/nginx-instantlly.conf

# Upload .env (only if it doesn't exist on server — won't overwrite)
"${SSH_CMD[@]}" "test -f $APP_DIR/.env" || scp -i "$PEM_PATH" -o StrictHostKeyChecking=no \
  .env $USER@$EC2_IP:$APP_DIR/.env

echo "Files uploaded."

# Step 4: Install dependencies and generate Prisma client on server
echo ""
echo ">>> Step 4: Installing dependencies on server..."
"${SSH_CMD[@]}" << 'REMOTE'
cd /home/ubuntu/instantlly-backend

# Install production dependencies
npm ci --omit=dev

# Generate Prisma client
npx prisma generate

# Run Prisma migrations
npx prisma migrate deploy

echo "Dependencies installed and migrations applied."
REMOTE

# Step 5: Set up Nginx (if not already done)
echo ""
echo ">>> Step 5: Configuring Nginx..."
"${SSH_CMD[@]}" << 'REMOTE'
if [ ! -f /etc/nginx/sites-available/instantlly ]; then
    sudo cp ~/nginx-instantlly.conf /etc/nginx/sites-available/instantlly
    sudo ln -sf /etc/nginx/sites-available/instantlly /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t && sudo systemctl reload nginx
    echo "Nginx configured."
else
    sudo cp ~/nginx-instantlly.conf /etc/nginx/sites-available/instantlly
    sudo nginx -t && sudo systemctl reload nginx
    echo "Nginx config updated."
fi
REMOTE

# Step 6: Start/Restart PM2
echo ""
echo ">>> Step 6: Starting application with PM2..."
"${SSH_CMD[@]}" << 'REMOTE'
cd /home/ubuntu/instantlly-backend

# Check if app is already running
if pm2 describe instantlly-backend > /dev/null 2>&1; then
    pm2 reload ecosystem.config.js --update-env
    echo "App reloaded."
else
    pm2 start ecosystem.config.js
    echo "App started."
fi

# Save PM2 process list (so it restarts on reboot)
pm2 save

# Show status
pm2 status
REMOTE

echo ""
echo "=========================================="
echo "  Deployment complete!"
echo "=========================================="
echo ""
echo "  Server: http://$EC2_IP:8080"
echo "  Health: curl http://$EC2_IP:8080/"
echo ""
echo "  Next: Set up SSL with certbot if not done:"
echo "  ssh -i $PEM_PATH $USER@$EC2_IP"
echo "  sudo certbot --nginx -d backend.instantllycards.com"
echo ""
