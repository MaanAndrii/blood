#!/usr/bin/env bash
# =============================================================================
#  Blood Health Monitor — автоматичне розгортання на Raspberry Pi
# =============================================================================
set -euo pipefail

# ── Кольори ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${BLUE}→${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}[ $* ]${NC}"; }
ask()  { echo -e "${YELLOW}?${NC}  $*"; }

ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-pi}"

# =============================================================================
#  Перевірка
# =============================================================================
step "Перевірка"

[[ "$(uname -m)" =~ ^(aarch64|armv7l)$ ]] || warn "Не ARM — продовжуємо але можуть бути проблеми"
[[ $EUID -eq 0 ]] || err "Запустіть з sudo: sudo bash setup.sh"

ok "Запущено як root на $(uname -m)"

# =============================================================================
#  Крок 1 — Системні пакети
# =============================================================================
step "Крок 1/9 — Системні пакети"

info "Оновлення списку пакетів..."
apt-get update -qq

info "Встановлення Node.js 20..."
if ! command -v node &>/dev/null || [[ "$(node --version)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
  apt-get install -y nodejs &>/dev/null
fi
ok "Node.js $(node --version)"

info "Встановлення PostgreSQL..."
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-client &>/dev/null
fi
systemctl enable postgresql &>/dev/null
systemctl start postgresql
ok "PostgreSQL $(psql --version | awk '{print $3}')"

info "Встановлення Chromium та залежностей Puppeteer..."
# На RPi OS Bookworm пакет називається 'chromium', на старіших — 'chromium-browser'
CHROMIUM_PKG="chromium"
apt-get install -y "$CHROMIUM_PKG" \
  libgbm1 libxkbcommon0 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 libasound2 2>&1 \
  | grep -E '(Err|error|cannot|already installed|upgraded|newly installed)' || true

CHROMIUM_PATH=$(which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo "")
[[ -n "$CHROMIUM_PATH" ]] || err "Chromium не знайдено після встановлення. Запустіть: sudo apt install chromium"
ok "Chromium → $CHROMIUM_PATH"

# =============================================================================
#  Крок 2 — npm залежності
# =============================================================================
step "Крок 2/9 — npm залежності"

cd "$APP_DIR"
info "npm install (без завантаження Chromium)..."
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install
ok "Залежності встановлено"

info "Patching Puppeteer — системний Chromium..."
PDF_SERVICE="$APP_DIR/server/services/pdf.js"
if grep -q "executablePath" "$PDF_SERVICE"; then
  ok "executablePath вже налаштовано"
else
  sed -i "s|headless: 'new',|headless: 'new',\n    executablePath: '$CHROMIUM_PATH',|" "$PDF_SERVICE"
  ok "executablePath → $CHROMIUM_PATH"
fi

# =============================================================================
#  Крок 3 — PostgreSQL: база даних
# =============================================================================
step "Крок 3/9 — База даних PostgreSQL"

echo ""
ask "Введіть пароль для PostgreSQL користувача 'health':"
read -r -s DB_PASSWORD
echo ""
[[ -n "$DB_PASSWORD" ]] || err "Пароль не може бути порожнім"

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='health'" | grep -q 1 \
  && info "Користувач 'health' вже існує" \
  || sudo -u postgres psql -c "CREATE USER health WITH PASSWORD '$DB_PASSWORD';" &>/dev/null

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='health'" | grep -q 1 \
  && info "База 'health' вже існує" \
  || sudo -u postgres psql -c "CREATE DATABASE health OWNER health;" &>/dev/null

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE health TO health;" &>/dev/null
ok "База даних готова"

DATABASE_URL="postgresql://health:${DB_PASSWORD}@localhost:5432/health"

# =============================================================================
#  Крок 4 — Google OAuth
# =============================================================================
step "Крок 4/9 — Google OAuth"

echo ""
echo -e "  Відкрийте: ${CYAN}https://console.cloud.google.com${NC}"
echo    "  1. APIs & Services → Credentials → Create → OAuth 2.0 Client ID"
echo    "  2. Тип: Web application"
echo    ""
ask "Введіть GOOGLE_CLIENT_ID:"
read -r GOOGLE_CLIENT_ID
ask "Введіть GOOGLE_CLIENT_SECRET:"
read -r -s GOOGLE_CLIENT_SECRET
echo ""
ask "Введіть ваш домен (наприклад: health.example.com):"
read -r APP_DOMAIN

[[ -n "$GOOGLE_CLIENT_ID" && -n "$GOOGLE_CLIENT_SECRET" && -n "$APP_DOMAIN" ]] \
  || err "Всі поля обов'язкові"

CALLBACK_URL="https://${APP_DOMAIN}/api/auth/google/callback"
BASE_URL="https://${APP_DOMAIN}"

echo ""
warn "Переконайтесь що в Google Console вказані:"
echo  "  Authorized origins:      https://${APP_DOMAIN}"
echo  "  Authorized redirect URI: ${CALLBACK_URL}"
echo ""
ask "Натисніть Enter коли готово..."
read -r

ok "Google OAuth налаштовано"

# =============================================================================
#  Крок 5 — VAPID ключі
# =============================================================================
step "Крок 5/9 — VAPID ключі для Web Push"

ask "Введіть ваш email (для VAPID):"
read -r VAPID_EMAIL

info "Генерація VAPID ключів..."
VAPID_KEYS=$(node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k.publicKey+'|'+k.privateKey)")
VAPID_PUBLIC_KEY="${VAPID_KEYS%|*}"
VAPID_PRIVATE_KEY="${VAPID_KEYS#*|}"
ok "VAPID ключі згенеровано"

# =============================================================================
#  Крок 6 — JWT Secret + .env
# =============================================================================
step "Крок 6/9 — Файл .env"

JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

cat > "$ENV_FILE" <<EOF
DATABASE_URL=${DATABASE_URL}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_CALLBACK_URL=${CALLBACK_URL}
JWT_SECRET=${JWT_SECRET}
VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_EMAIL=mailto:${VAPID_EMAIL}
NODE_ENV=production
PORT=3000
BASE_URL=${BASE_URL}
EOF

chmod 600 "$ENV_FILE"
ok ".env створено (права 600)"

# =============================================================================
#  Крок 7 — systemd сервіс
# =============================================================================
step "Крок 7/9 — systemd сервіс"

cat > /etc/systemd/system/blood.service <<EOF
[Unit]
Description=Blood Health Monitor
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable blood &>/dev/null
systemctl start blood

sleep 3
systemctl is-active blood &>/dev/null && ok "Сервіс blood запущено" \
  || err "Сервіс не запустився. Перевірте: journalctl -u blood -n 30"

# =============================================================================
#  Крок 8 — Cloudflare Tunnel
# =============================================================================
step "Крок 8/9 — Cloudflare Tunnel"

if ! command -v cloudflared &>/dev/null; then
  info "Встановлення cloudflared..."
  curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" \
    -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi
ok "cloudflared $(cloudflared --version | head -1)"

echo ""
info "Авторизація в Cloudflare (відкриється посилання)..."
sudo -u "$SERVICE_USER" cloudflared tunnel login

info "Створення тунелю 'blood-health'..."
TUNNEL_OUTPUT=$(sudo -u "$SERVICE_USER" cloudflared tunnel create blood-health 2>&1) || true
TUNNEL_ID=$(echo "$TUNNEL_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

if [[ -z "$TUNNEL_ID" ]]; then
  TUNNEL_ID=$(sudo -u "$SERVICE_USER" cloudflared tunnel list 2>/dev/null \
    | awk '/blood-health/{print $1}')
fi

[[ -n "$TUNNEL_ID" ]] || err "Не вдалось отримати UUID тунелю"
ok "Тунель ID: $TUNNEL_ID"

info "DNS запис для ${APP_DOMAIN}..."
sudo -u "$SERVICE_USER" cloudflared tunnel route dns blood-health "$APP_DOMAIN" 2>/dev/null \
  && ok "DNS запис створено" \
  || warn "DNS запис вже існує або помилка — перевірте вручну"

CRED_FILE="/home/${SERVICE_USER}/.cloudflared/${TUNNEL_ID}.json"
CONFIG_DIR="/home/${SERVICE_USER}/.cloudflared"

cat > "${CONFIG_DIR}/config.yml" <<EOF
tunnel: blood-health
credentials-file: ${CRED_FILE}

ingress:
  - hostname: ${APP_DOMAIN}
    service: http://localhost:3000
  - service: http_status:404
EOF

chown "${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_DIR}/config.yml"
ok "config.yml створено"

info "Встановлення cloudflared як сервісу..."
cloudflared service install 2>/dev/null || true
systemctl enable cloudflared &>/dev/null
systemctl restart cloudflared

sleep 3
systemctl is-active cloudflared &>/dev/null && ok "Cloudflare Tunnel запущено" \
  || warn "Тунель не запустився. Перевірте: journalctl -u cloudflared -n 30"

# =============================================================================
#  Крок 9 — Бекап бази даних
# =============================================================================
step "Крок 9/9 — Автоматичний бекап БД"

mkdir -p /home/"$SERVICE_USER"/backups
chown "${SERVICE_USER}:${SERVICE_USER}" /home/"$SERVICE_USER"/backups

CRON_CMD="0 3 * * * pg_dump -U health health > /home/${SERVICE_USER}/backups/health_\$(date +\\%Y\\%m\\%d).sql 2>/dev/null"
(crontab -u "$SERVICE_USER" -l 2>/dev/null | grep -v "pg_dump.*health"; echo "$CRON_CMD") \
  | crontab -u "$SERVICE_USER" -
ok "Бекап щодня о 03:00 → /home/${SERVICE_USER}/backups/"

# =============================================================================
#  Готово
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Розгортання завершено успішно!${NC}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Застосунок:${NC}  ${CYAN}https://${APP_DOMAIN}${NC}"
echo ""
echo -e "  ${BOLD}Статус сервісів:${NC}"
echo -e "  blood:       $(systemctl is-active blood)"
echo -e "  cloudflared: $(systemctl is-active cloudflared)"
echo -e "  postgresql:  $(systemctl is-active postgresql)"
echo ""
echo -e "  ${BOLD}Корисні команди:${NC}"
echo -e "  Логи застосунку: ${CYAN}journalctl -u blood -f${NC}"
echo -e "  Логи тунелю:     ${CYAN}journalctl -u cloudflared -f${NC}"
echo -e "  Перезапуск:      ${CYAN}sudo systemctl restart blood${NC}"
echo ""
warn "Перший хто увійде через Google — стає адміністратором."
echo ""
