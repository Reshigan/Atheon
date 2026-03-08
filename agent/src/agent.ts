/**
 * Atheon Agent Sidecar
 * Runs alongside the customer's on-premise Atheon deployment.
 * Responsibilities:
 *  1. Heartbeat — sends health/resource data to GONXT control plane every N seconds
 *  2. Config sync — receives config updates from heartbeat response
 *  3. Self-update — pulls new Docker images when targetVersion is set
 *  4. Error reporting — sends errors to control plane
 */

import { execSync } from 'child_process';
import * as os from 'os';

// ── Environment Variables ────────────────────────────────────────────────
const CONTROL_PLANE_URL = process.env.ATHEON_CONTROL_PLANE_URL || 'https://atheon-api.vantax.co.za';
const LICENCE_KEY = process.env.ATHEON_LICENCE_KEY || '';
const DEPLOYMENT_ID = process.env.ATHEON_DEPLOYMENT_ID || '';
const HEARTBEAT_INTERVAL = parseInt(process.env.ATHEON_HEARTBEAT_INTERVAL || '60', 10) * 1000;
const LOCAL_API_URL = process.env.ATHEON_LOCAL_API_URL || 'http://localhost:3000';
const AGENT_VERSION = '1.0.0';

if (!LICENCE_KEY) {
  console.error('[AGENT] ATHEON_LICENCE_KEY is required');
  process.exit(1);
}
if (!DEPLOYMENT_ID) {
  console.error('[AGENT] ATHEON_DEPLOYMENT_ID is required');
  process.exit(1);
}

// ── Current config (updated from control plane) ─────────────────────────
// Assigned from heartbeat response; will be used by future config-driven features
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let currentConfig: Record<string, unknown> = {};

// ── Resource Usage Collection ────────────────────────────────────────────
function getResourceUsage(): Record<string, unknown> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const uptime = os.uptime();

  // CPU usage approximation
  let cpuPct = 0;
  if (cpus.length > 0) {
    const cpu = cpus[0];
    const total = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    const idle = cpu.times.idle;
    cpuPct = Math.round(((total - idle) / total) * 100);
  }

  return {
    cpuPct,
    memMb: Math.round((totalMem - freeMem) / 1024 / 1024),
    memTotalMb: Math.round(totalMem / 1024 / 1024),
    diskGb: 0, // would need df -h parsing
    uptimeSeconds: uptime,
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    nodeVersion: process.version,
  };
}

// ── Local Health Check ──────────────────────────────────────────────────
async function checkLocalHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${LOCAL_API_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - start;
    const data = await res.json() as { status?: string };
    return { healthy: data.status === 'healthy' || res.ok, latencyMs };
  } catch {
    return { healthy: false, latencyMs: Date.now() - start };
  }
}

// ── Self-Update ─────────────────────────────────────────────────────────
async function selfUpdate(targetVersion: string): Promise<void> {
  console.log(`[AGENT] Self-update triggered: target version ${targetVersion}`);
  try {
    execSync('docker compose pull', { stdio: 'inherit', timeout: 300000 });
    execSync('docker compose up -d', { stdio: 'inherit', timeout: 120000 });
    console.log(`[AGENT] Self-update to ${targetVersion} complete`);
  } catch (err) {
    console.error('[AGENT] Self-update failed:', err);
    await reportError(`Self-update to ${targetVersion} failed: ${(err as Error).message}`, 'UPDATE_FAILED', 'critical');
  }
}

// ── Error Reporting ─────────────────────────────────────────────────────
async function reportError(message: string, code?: string, severity?: string): Promise<void> {
  try {
    await fetch(`${CONTROL_PLANE_URL}/api/agent/error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Licence-Key': LICENCE_KEY,
      },
      body: JSON.stringify({ message, code, severity: severity || 'error' }),
    });
  } catch (err) {
    console.error('[AGENT] Failed to report error to control plane:', err);
  }
}

// ── Heartbeat ───────────────────────────────────────────────────────────
async function sendHeartbeat(): Promise<void> {
  try {
    const localHealth = await checkLocalHealth();
    const resourceUsage = getResourceUsage();
    const healthScore = localHealth.healthy ? 100 : 0;

    const response = await fetch(`${CONTROL_PLANE_URL}/api/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Licence-Key': LICENCE_KEY,
      },
      body: JSON.stringify({
        agentVersion: AGENT_VERSION,
        apiVersion: '4.0.0',
        healthScore,
        resourceUsage: {
          ...resourceUsage,
          localApiHealthy: localHealth.healthy,
          localApiLatencyMs: localHealth.latencyMs,
        },
        status: localHealth.healthy ? 'active' : 'degraded',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[AGENT] Heartbeat rejected (${response.status}): ${text}`);
      if (response.status === 403) {
        console.error('[AGENT] Licence revoked or suspended. Shutting down.');
        process.exit(1);
      }
      return;
    }

    const data = await response.json() as {
      ok: boolean;
      config?: Record<string, unknown>;
      targetVersion?: string | null;
    };

    // Apply config updates
    if (data.config) {
      currentConfig = data.config;
      console.log('[AGENT] Config updated from control plane');
    }

    // Check for pending version update
    if (data.targetVersion && data.targetVersion !== AGENT_VERSION) {
      await selfUpdate(data.targetVersion);
    }

    console.log(`[AGENT] Heartbeat OK — health=${healthScore} cpu=${resourceUsage.cpuPct}% mem=${resourceUsage.memMb}MB`);

  } catch (err) {
    console.error('[AGENT] Heartbeat failed:', err);
    // Don't report error to control plane if we can't reach it
  }
}

// ── Main Loop ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Atheon Agent Sidecar v' + AGENT_VERSION);
  console.log(`  Deployment: ${DEPLOYMENT_ID}`);
  console.log(`  Control Plane: ${CONTROL_PLANE_URL}`);
  console.log(`  Heartbeat Interval: ${HEARTBEAT_INTERVAL / 1000}s`);
  console.log('═══════════════════════════════════════════════════');

  // Initial heartbeat
  await sendHeartbeat();

  // Schedule recurring heartbeats
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

main().catch((err) => {
  console.error('[AGENT] Fatal error:', err);
  process.exit(1);
});
