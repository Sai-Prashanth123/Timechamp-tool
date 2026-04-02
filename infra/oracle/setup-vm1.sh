#!/bin/bash
# chmod +x infra/oracle/setup-vm1.sh before running
set -euo pipefail

echo "=== Time Champ VM1 Setup ==="

# Node.js 20
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
  pm2 startup | tail -1 | sudo bash
fi

# PgBouncer
if ! command -v pgbouncer &>/dev/null; then
  sudo apt-get install -y pgbouncer
fi

sudo mkdir -p /etc/pgbouncer /var/log/timechamp
sudo cp /home/ubuntu/timechamp/infra/pgbouncer/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
sudo systemctl enable pgbouncer
sudo systemctl restart pgbouncer

echo "=== VM1 setup complete ==="
