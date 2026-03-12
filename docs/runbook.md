# Atheon Operations Runbook

## 1. Deployment

### 1.1 API Worker (Cloudflare Workers)

```bash
# Deploy to production
cd workers/api
npx wrangler deploy --env production

# Deploy to staging
npx wrangler deploy --env staging
```

### 1.2 Frontend (Cloudflare Pages)

Frontend deploys automatically via GitHub Actions on push to `main`.

Manual deploy:
```bash
npm run build
npx wrangler pages deploy dist --project-name=atheon-33b
```

### 1.3 Rollback

```bash
# List recent deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback
```

## 2. Database Management (D1)

### 2.1 Run Migrations

Migrations run automatically on first request via `ensureMigrated()`.
To force a migration bump, increment `CURRENT_VERSION` in `workers/api/src/services/migrate.ts`.

### 2.2 Manual Queries

```bash
# Production
npx wrangler d1 execute atheon-db --command "SELECT COUNT(*) FROM tenants"

# List tables
npx wrangler d1 execute atheon-db --command ".tables"
```

### 2.3 Backup

```bash
npx wrangler d1 backup create atheon-db
npx wrangler d1 backup list atheon-db
npx wrangler d1 backup download atheon-db <backup-id>
```

## 3. Tenant Management

### 3.1 Create New Tenant

```bash
npx wrangler d1 execute atheon-db --command \
  "INSERT INTO tenants (id, name, slug, industry, status, plan, created_at) \
   VALUES ('$(uuidgen)', 'Company Name', 'company-slug', 'manufacturing', 'active', 'enterprise', datetime('now'))"
```

### 3.2 Disable Tenant

```bash
npx wrangler d1 execute atheon-db --command \
  "UPDATE tenants SET status = 'suspended' WHERE slug = 'company-slug'"
```

### 3.3 Reset Tenant Data

Use the API endpoint:
```bash
curl -X POST https://atheon-api.vantax.co.za/api/tenants/reset \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

## 4. Monitoring

### 4.1 Health Check

```bash
curl https://atheon-api.vantax.co.za/api/healthz
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "db": "connected",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### 4.2 Worker Logs

```bash
npx wrangler tail --format pretty
```

### 4.3 AI Cost Monitoring

```bash
curl https://atheon-api.vantax.co.za/api/ai-costs \
  -H "Authorization: Bearer <token>"
```

### 4.4 Key Metrics to Watch

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| API Latency (p95) | > 2s | > 5s |
| Error Rate | > 1% | > 5% |
| AI Cost (monthly) | > $50/tenant | > $100/tenant |
| D1 Row Count | > 500K | > 1M |
| Cache Hit Rate | < 50% | < 20% |

## 5. ERP Sync

### 5.1 Trigger Manual Sync

```bash
curl -X POST https://atheon-api.vantax.co.za/api/erp/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"connectionId": "<connection-id>"}'
```

### 5.2 Check Sync Status

```bash
curl https://atheon-api.vantax.co.za/api/erp/connections \
  -H "Authorization: Bearer <token>"
```

### 5.3 Token Refresh Issues

If an ERP connection shows `token_expired`:
1. Check the connection config for valid `refresh_token`
2. Verify the ERP provider's OAuth app is still active
3. Invalidate the cached token and trigger a manual sync
4. If refresh fails, the user must re-authenticate via OAuth flow

## 6. Emergency Procedures

### 6.1 API Down

1. Check Cloudflare dashboard for Worker errors
2. Run `npx wrangler tail` to see live errors
3. Check D1 database connectivity
4. If needed, rollback: `npx wrangler rollback`

### 6.2 Database Corruption

1. Stop all writes: set `MAINTENANCE_MODE=true` in Worker secrets
2. Create a backup: `npx wrangler d1 backup create atheon-db`
3. Identify corrupted tables via `.schema` and `PRAGMA integrity_check`
4. Restore from last known good backup if needed

### 6.3 Security Incident

1. Rotate all secrets immediately:
   - `JWT_SECRET`
   - `ENCRYPTION_KEY`
   - `OLLAMA_API_KEY`
   - `MS_GRAPH_CLIENT_SECRET`
2. Invalidate all active sessions by changing `JWT_SECRET`
3. Review audit logs: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100`
4. Check for unauthorized tenant access in logs
5. Notify affected users

### 6.4 AI Budget Exceeded

1. Check current spend: `GET /api/ai-costs/budget`
2. If critical, flush cache: `POST /api/ai-costs/cache/flush`
3. Review query patterns for abuse
4. Adjust per-tenant budget limits in KV

## 7. Secrets Reference

| Secret | Purpose | Rotation Frequency |
|--------|---------|-------------------|
| `JWT_SECRET` | Auth token signing | Quarterly |
| `ENCRYPTION_KEY` | ERP credential encryption | Annually |
| `OLLAMA_API_KEY` | Ollama Cloud AI access | As needed |
| `MS_GRAPH_CLIENT_ID` | Microsoft Graph email | Annually |
| `MS_GRAPH_CLIENT_SECRET` | Microsoft Graph email | Annually |
| `MS_GRAPH_TENANT_ID` | Microsoft Graph tenant | Static |

## 8. KV Namespaces

| Namespace | Purpose | TTL |
|-----------|---------|-----|
| `CACHE` | AI response cache, rate limits, tokens | Varies (5min–24hr) |

## 9. Cron Schedule

Configured in `wrangler.toml`:

| Schedule | Task |
|----------|------|
| Every 15 minutes | Health recalculation, briefings, memory sync, process mining |
| Every 15 minutes | Agent lifecycle checks, sub-catalyst execution |
| Every 15 minutes | Email queue processing with retry |
