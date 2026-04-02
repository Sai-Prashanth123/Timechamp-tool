# Oracle Network Load Balancer Config

## Listener Rules

| Port | Protocol | Backend | Description |
|------|----------|---------|-------------|
| 443 | TCP | VM2:443 | HTTPS web + API (NGINX terminates SSL via CF origin cert) |
| 3001 | TCP | VM1:3001 | Direct WebSocket / agent sync (no NGINX, raw NestJS) |

## Backend Sets

**web-backend:** VM2 private IP, port 443, health check TCP:443
**api-backend:** VM1 private IP, port 3001, health check HTTP GET /health returns 200

## Security List

Allow inbound:
- 0.0.0.0/0 → 443/TCP (web)
- Agent IPs → 3001/TCP (or VPN-only for production)

VM1 <-> VM2 internal: allow all TCP on Oracle VCN private subnet.
