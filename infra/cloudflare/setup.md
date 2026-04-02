# Cloudflare Setup for Time Champ

## DNS Records

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | timechamp.io | VM2_PUBLIC_IP | Proxied (orange) |
| A | www | VM2_PUBLIC_IP | Proxied (orange) |
| CNAME | cdn | timechamp-prod.s3.us-west-004.backblazeb2.com | Proxied (orange) |
| A | api | VM1_PUBLIC_IP | DNS only (grey) — direct WebSocket |

## SSL/TLS Settings

- Mode: **Full (strict)**
- Generate Origin Certificate: SSL/TLS → Origin Server → Create Certificate
  - Install at `/etc/nginx/ssl/origin.crt` and `/etc/nginx/ssl/origin.key` on VM2

## WebSocket Pass-through

Cloudflare proxies WebSocket automatically on ports 80/443. No extra config needed.
For direct WebSocket connections (lower latency), point agent to `api.timechamp.io` (grey-cloud A record above).

## B2 + CDN (Bandwidth Alliance = zero egress)

1. Create B2 bucket: `timechamp-prod` (private)
2. Create B2 application key with write access
3. In Cloudflare: add CNAME `cdn` → `timechamp-prod.s3.us-west-004.backblazeb2.com` (proxied)
4. Add Cloudflare Transform Rule to inject B2 auth header:
   - Match: `http.host eq "cdn.timechamp.io"`
   - Set header: `Authorization: Bearer <B2_DOWNLOAD_TOKEN>`
5. Set env: `B2_CDN_URL=https://cdn.timechamp.io`

## Page Rules / Cache Rules

- Cache `cdn.timechamp.io/*` — Cache Level: Standard, Edge TTL: 1 day
- Bypass cache for `/api/*` and `/socket.io/*`

## Firewall Rules

- Block all traffic to port 3001 (API) except from Cloudflare IPs and Oracle VPC
- Allow 443 from anywhere (Cloudflare handles DDoS)
