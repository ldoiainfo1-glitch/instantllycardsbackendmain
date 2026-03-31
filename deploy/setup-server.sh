#!/bin/bash
# ============================================
# Instantlly Backend - EC2 Server Setup
# Run as: sudo ./setup-server.sh
# Tested on: Ubuntu 24.04 LTS
# ============================================

set -euo pipefail

echo "=========================================="
echo "  Instantlly Backend - Server Setup"
echo "=========================================="

# Update system
echo ">>> Updating system packages..."
apt-get update && apt-get upgrade -y

# Install essentials
echo ">>> Installing essential packages..."
apt-get install -y curl wget git build-essential nginx certbot python3-certbot-nginx ufw

# Install Node.js 22 LTS
echo ">>> Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# Install PM2 globally
echo ">>> Installing PM2..."
npm install -g pm2

# Create app directory
echo ">>> Creating app directory..."
mkdir -p /home/ubuntu/instantlly-backend
chown -R ubuntu:ubuntu /home/ubuntu/instantlly-backend

# Configure UFW firewall
echo ">>> Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Configure Nginx
echo ">>> Configuring Nginx..."
cp /home/ubuntu/nginx-instantlly.conf /etc/nginx/sites-available/instantlly 2>/dev/null || echo "Nginx config will be set up during deploy"
if [ -f /etc/nginx/sites-available/instantlly ]; then
    ln -sf /etc/nginx/sites-available/instantlly /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
fi

# Set up PM2 to auto-start on boot
echo ">>> Setting up PM2 startup..."
env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
systemctl enable pm2-ubuntu

# Increase file limits for production
echo ">>> Tuning system limits..."
cat >> /etc/security/limits.conf <<'LIMITS'
ubuntu soft nofile 65536
ubuntu hard nofile 65536
LIMITS

# Sysctl tuning for high connections
cat >> /etc/sysctl.conf <<'SYSCTL'
net.core.somaxconn = 65536
net.ipv4.tcp_max_syn_backlog = 65536
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
SYSCTL
sysctl -p

echo ""
echo "=========================================="
echo "  Server setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Upload your app code with deploy.sh"
echo "  2. Set up SSL: sudo certbot --nginx -d backend.instantllycards.com"
echo ""
