#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Atheon™ Hybrid / On-Premise Installer
# Usage: curl -sSL https://atheon.vantax.co.za/install.sh | bash -s -- \
#          --licence-key ATH-XXXX-XXXX-XXXX-XXXX \
#          --deployment-id <uuid>
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ── Parse arguments ───────────────────────────────────────────────────────
LICENCE_KEY=""
DEPLOYMENT_ID=""
INSTALL_DIR="${ATHEON_INSTALL_DIR:-/opt/atheon}"
CONTROL_PLANE_URL="${ATHEON_CONTROL_PLANE_URL:-https://atheon-api.vantax.co.za}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --licence-key) LICENCE_KEY="$2"; shift 2 ;;
    --deployment-id) DEPLOYMENT_ID="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --control-plane) CONTROL_PLANE_URL="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -z "$LICENCE_KEY" ]] && fail "Missing --licence-key"
[[ -z "$DEPLOYMENT_ID" ]] && fail "Missing --deployment-id"

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║     Atheon™ Enterprise Intelligence       ║"
echo "  ║     Hybrid Deployment Installer           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""

# ── Pre-flight checks ────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker: https://docs.docker.com/get-docker/"
ok "Docker found: $(docker --version)"

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose found: $(docker compose version --short)"
elif docker-compose version >/dev/null 2>&1; then
  ok "Docker Compose (legacy) found"
  warn "Consider upgrading to Docker Compose v2"
else
  fail "Docker Compose is not installed. Install it: https://docs.docker.com/compose/install/"
fi

# Check Docker daemon is running
docker info >/dev/null 2>&1 || fail "Docker daemon is not running. Start it with: sudo systemctl start docker"
ok "Docker daemon is running"

# ── Create installation directory ─────────────────────────────────────────
info "Creating installation directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ── Download docker-compose.yml ───────────────────────────────────────────
info "Downloading docker-compose.yml..."
curl -sSL "https://atheon.vantax.co.za/docker-compose.yml" -o docker-compose.yml 2>/dev/null || \
  curl -sSL "https://raw.githubusercontent.com/Reshigan/Atheon/main/docker-compose.yml" -o docker-compose.yml
ok "docker-compose.yml downloaded"

# ── Create .env file ──────────────────────────────────────────────────────
info "Creating .env file..."

JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64 | head -1)
ENCRYPTION_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64 | head -1)
POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32 | head -1)
MINIO_SECRET_KEY=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32 | head -1)

cat > .env <<EOF
# Atheon Hybrid Deployment — auto-generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
ATHEON_DEPLOYMENT_ID=${DEPLOYMENT_ID}
ATHEON_LICENCE_KEY=${LICENCE_KEY}
ATHEON_CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
ATHEON_HEARTBEAT_INTERVAL=60

JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
ENVIRONMENT=production

DATABASE_URL=postgresql://atheon:${POSTGRES_PASSWORD}@db:5432/atheon
POSTGRES_USER=atheon
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=atheon

REDIS_URL=redis://redis:6379

MINIO_ENDPOINT=http://minio:9000
MINIO_BUCKET=atheon-storage
MINIO_ACCESS_KEY=atheon
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}

OLLAMA_BASE_URL=http://ollama:11434
ATHEON_API_TAG=latest
EOF

chmod 600 .env
ok ".env file created (secrets auto-generated)"

# ── Pull images ──────────────────────────────────────────────────────────
info "Pulling Docker images (this may take a few minutes)..."
docker compose pull 2>/dev/null || true

# ── Start services ───────────────────────────────────────────────────────
info "Starting Atheon services..."
docker compose up -d

# ── Wait for health ──────────────────────────────────────────────────────
info "Waiting for API to become healthy..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/healthz >/dev/null 2>&1; then
    ok "API is healthy"
    break
  fi
  sleep 2
done

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   Atheon™ Installation Complete!          ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""
echo "  Installation directory: $INSTALL_DIR"
echo "  API endpoint:          http://localhost:3000"
echo "  MinIO console:         http://localhost:9001"
echo "  Ollama:                http://localhost:11434"
echo ""
echo "  Licence key:           ${LICENCE_KEY}"
echo "  Deployment ID:         ${DEPLOYMENT_ID}"
echo ""
echo "  The agent sidecar is now sending heartbeats"
echo "  to ${CONTROL_PLANE_URL} every 60 seconds."
echo ""
info "To view logs: cd $INSTALL_DIR && docker compose logs -f"
info "To stop:      cd $INSTALL_DIR && docker compose down"
echo ""
