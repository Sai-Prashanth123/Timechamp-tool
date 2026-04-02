#!/bin/bash
# chmod +x infra/oracle/setup-vm2.sh before running
set -euo pipefail

echo "=== Time Champ VM2 Setup ==="

# Node.js 20
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# PostgreSQL 15
if ! command -v psql &>/dev/null; then
  sudo apt-get install -y postgresql-15
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
fi

# Valkey (Redis-compatible, self-hosted)
if ! command -v valkey-server &>/dev/null; then
  # Valkey is available in apt for Ubuntu 22.04+
  sudo apt-get install -y valkey
  sudo systemctl enable valkey
  sudo systemctl start valkey
fi

# NGINX
if ! command -v nginx &>/dev/null; then
  sudo apt-get install -y nginx
  sudo mkdir -p /etc/nginx/ssl
fi

sudo cp /home/ubuntu/timechamp/infra/nginx/timechamp.conf /etc/nginx/sites-available/timechamp
sudo ln -sf /etc/nginx/sites-available/timechamp /etc/nginx/sites-enabled/timechamp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo mkdir -p /var/log/timechamp

echo "=== VM2 setup complete ==="
echo "Next steps:"
echo "  1. sudo -u postgres createdb timechamp"
echo "  2. sudo -u postgres createuser timechamp -P"
echo "  3. Install Cloudflare origin cert to /etc/nginx/ssl/"
echo "  4. Replace VM1_INTERNAL_IP in nginx config with actual Oracle private IP"
