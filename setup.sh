#!/usr/bin/env bash
# =============================================================================
#  Blood Health Monitor — автоматичне розгортання
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

[[ "$(uname -m)" =~ ^(aarch64|armv7l|x86_64)$ ]] || warn "Незнайома архітектура — продовжуємо"
[[ $EUID -eq 0 ]] || err "Запустіть з sudo: sudo bash setup.sh"

ok "Запущено як root на $(uname -m)"

# =============================================================================
#  Крок 1 — Системні пакети
# =============================================================================
step "Крок 1 — Системні пакети"

info "Оновлення списку пакетів..."
apt-get update -qq

info "Встановлення базових утиліт (git, curl, ...)..."
apt-get install -y git curl ca-certificates gnupg &>/dev/null
ok "git $(git --version | awk '{print $3}')"

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

info "Встановлення бібліотек, потрібних Chromium/Puppeteer..."
apt-get install -y \
  libgbm1 libxkbcommon0 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 libasound2 libnss3 libxshmfence1 fonts-liberation &>/dev/null || true
ok "Бібліотеки Chromium встановлено"

# Chromium купуємо в кроці 2 (після npm) — Puppeteer керує власним бінарником.
CHROMIUM_PATH=""
detect_chromium() {
  command -v chromium 2>/dev/null || command -v chromium-browser 2>/dev/null \
    || { [[ -x /snap/bin/chromium ]] && echo /snap/bin/chromium; } || true
}

# =============================================================================
#  Крок 2 — npm залежності
# =============================================================================
step "Крок 2 — npm залежності"

cd "$APP_DIR"

# ── Chromium для Puppeteer ────────────────────────────────────────────────────
# Портативний підхід: на x86_64 Puppeteer завантажує й керує ВЛАСНИМ браузером
# (той самий білд, що очікує puppeteer.launch(); працює однаково на будь-якому
# сервері, без проблем snap-confinement). Кеш — у фіксованій теці в проєкті,
# щоб бінарник знаходився і при встановленні, і під час роботи служби (незалежно
# від HOME користувача). CHROMIUM_PATH лишається порожнім → pdf.js бере власний.
# Виняток — arm64/armv7 (Raspberry Pi): збірки немає, тож там системний Chromium.
PUPPETEER_CACHE_DIR="${APP_DIR}/.puppeteer-cache"
export PUPPETEER_CACHE_DIR
mkdir -p "$PUPPETEER_CACHE_DIR"

ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
  info "npm install (з власним Chromium Puppeteer)..."
  npm install
  # Явно докачуємо браузер (ідемпотентно) — потрібно й для повторних запусків,
  # де node_modules уже є і postinstall Puppeteer не спрацьовує.
  npx --yes puppeteer browsers install chrome >/tmp/pptr_chromium.log 2>&1 \
    || warn "Не вдалося докачати Chromium — див. /tmp/pptr_chromium.log"
  CHROMIUM_PATH=""
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$PUPPETEER_CACHE_DIR" 2>/dev/null || true
  ok "Залежності + Chromium (керований Puppeteer) → $PUPPETEER_CACHE_DIR"
else
  info "npm install (arm — системний Chromium)..."
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install
  info "Встановлення системного Chromium..."
  apt-get install -y chromium &>/dev/null || apt-get install -y chromium-browser &>/dev/null || true
  if [[ -z "$(detect_chromium)" ]]; then
    command -v snap &>/dev/null || apt-get install -y snapd &>/dev/null || true
    command -v snap &>/dev/null && snap install chromium &>/dev/null || true
  fi
  CHROMIUM_PATH=$(detect_chromium)
  [[ -n "$CHROMIUM_PATH" ]] || err "Chromium не встановлено. Спробуйте: sudo apt install chromium"
  ok "Залежності встановлено · системний Chromium → $CHROMIUM_PATH"
fi

# =============================================================================
#  Крок 3 — PostgreSQL: база даних
# =============================================================================
step "Крок 3 — База даних PostgreSQL"

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
#  Крок 4 — Режим доступу
# =============================================================================
step "Крок 4 — Режим доступу"

echo ""
echo -e "  Оберіть спосіб доступу до застосунку:\n"
echo -e "  ${BOLD}1)${NC} По IP-адресі          — локальна мережа, HTTP, без домену"
echo -e "                             Для тестування. Push-нотифікації не працюють (HTTP)."
echo ""
echo -e "  ${BOLD}2)${NC} Cloudflare Quick Tunnel — тимчасовий HTTPS без домену"
echo -e "                             URL вигляду *.trycloudflare.com, змінюється при рестарті."
echo ""
echo -e "  ${BOLD}3)${NC} Cloudflare Tunnel + домен — постійний HTTPS, виробництво"
echo -e "                             Потрібен власний домен, підключений до Cloudflare."
echo ""
ask "Ваш вибір [1/2/3]:"
read -r ACCESS_MODE

case "$ACCESS_MODE" in
  1)
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    BASE_URL="http://${LOCAL_IP}:3000"
    USE_TUNNEL=false
    QUICK_TUNNEL=false
    APP_DOMAIN="${LOCAL_IP}:3000"
    PROTOCOL="http"
    ok "Режим: По IP → ${BASE_URL}"
    warn "Google OAuth та Push-нотифікації потребують HTTPS — в цьому режимі недоступні"
    ;;
  2)
    BASE_URL=""   # визначиться після запуску cloudflared
    USE_TUNNEL=true
    QUICK_TUNNEL=true
    APP_DOMAIN=""
    PROTOCOL="https"
    ok "Режим: Cloudflare Quick Tunnel (тимчасовий URL)"
    warn "URL змінюється при кожному рестарті сервісу"
    warn "Google OAuth потрібно переналаштовувати при кожній зміні URL"
    ;;
  3)
    USE_TUNNEL=true
    QUICK_TUNNEL=false
    echo ""
    ask "Введіть ваш домен (наприклад: health.example.com):"
    read -r APP_DOMAIN
    [[ -n "$APP_DOMAIN" ]] || err "Домен не може бути порожнім"
    BASE_URL="https://${APP_DOMAIN}"
    PROTOCOL="https"
    ok "Режим: Cloudflare Tunnel → ${BASE_URL}"
    ;;
  *)
    err "Невірний вибір. Запустіть скрипт знову та оберіть 1, 2 або 3"
    ;;
esac

# =============================================================================
#  Крок 5 — Google OAuth
# =============================================================================
step "Крок 5 — Google OAuth"

if [[ "$PROTOCOL" == "http" ]]; then
  echo ""
  warn "Google OAuth вимагає HTTPS. В режимі по IP він не буде працювати."
  warn "Авторизація через локальний email/пароль залишається доступною."
  echo ""
  ask "Все одно налаштувати Google OAuth? (для майбутнього переходу на HTTPS) [y/N]:"
  read -r SETUP_OAUTH
  SETUP_OAUTH="${SETUP_OAUTH,,}"
else
  SETUP_OAUTH="y"
fi

if [[ "$SETUP_OAUTH" == "y" ]]; then
  echo ""
  if [[ "$QUICK_TUNNEL" == "true" ]]; then
    warn "Quick Tunnel змінює URL при рестарті — OAuth потрібно буде переналаштовувати."
    warn "Після першого запуску знайдіть URL: journalctl -u cloudflared | grep trycloudflare"
    warn "І вкажіть його в Google Console як Authorized origin та redirect URI"
    echo ""
    CALLBACK_PLACEHOLDER="https://YOUR-SUBDOMAIN.trycloudflare.com/api/auth/google/callback"
    echo -e "  ${CYAN}https://console.cloud.google.com${NC} → Credentials → OAuth 2.0 Client ID"
    echo    "  Authorized origins:      https://YOUR-SUBDOMAIN.trycloudflare.com"
    echo    "  Authorized redirect URI: ${CALLBACK_PLACEHOLDER}"
  else
    echo -e "  Відкрийте: ${CYAN}https://console.cloud.google.com${NC}"
    echo    "  APIs & Services → Credentials → Create → OAuth 2.0 Client ID → Web application"
    echo    "  Authorized origins:      ${BASE_URL}"
    echo    "  Authorized redirect URI: ${BASE_URL}/api/auth/google/callback"
  fi
  echo ""
  ask "Введіть GOOGLE_CLIENT_ID:"
  read -r GOOGLE_CLIENT_ID
  ask "Введіть GOOGLE_CLIENT_SECRET:"
  read -r -s GOOGLE_CLIENT_SECRET
  echo ""
  [[ -n "$GOOGLE_CLIENT_ID" && -n "$GOOGLE_CLIENT_SECRET" ]] || err "Обидва поля обов'язкові"
  ok "Google OAuth налаштовано"
else
  GOOGLE_CLIENT_ID="REPLACE_ME"
  GOOGLE_CLIENT_SECRET="REPLACE_ME"
  warn "Google OAuth пропущено. Відредагуйте .env пізніше при переході на HTTPS"
fi

CALLBACK_URL="${BASE_URL}/api/auth/google/callback"

# =============================================================================
#  Крок 5b — Email для відновлення пароля (Resend, опційно)
# =============================================================================
step "Крок 5b — Email для відновлення пароля (опційно)"

echo ""
info "Для надсилання листів «Відновлення пароля» використовується Resend (https://resend.com)."
warn "Без цього кроку посилання для відновлення пароля лише пишеться в лог сервера,"
warn "а не надсилається користувачу поштою."
echo ""
ask "Налаштувати Resend зараз? [y/N]:"
read -r SETUP_RESEND
SETUP_RESEND="${SETUP_RESEND,,}"

if [[ "$SETUP_RESEND" == "y" ]]; then
  ask "Введіть RESEND_API_KEY:"
  read -r -s RESEND_API_KEY
  echo ""
  ask "Введіть адресу відправника (наприклад: BP & BMI <no-reply@ваш-домен>):"
  read -r RESEND_FROM
  ok "Resend налаштовано"
else
  RESEND_API_KEY=""
  RESEND_FROM=""
  warn "Resend пропущено. Листи відновлення пароля лише логуватимуться на сервері"
fi

# =============================================================================
#  Крок 6 — VAPID ключі
# =============================================================================
step "Крок 6 — VAPID ключі для Web Push"

if [[ "$PROTOCOL" == "http" ]]; then
  warn "Push-нотифікації потребують HTTPS — в режимі по IP не будуть працювати"
  warn "Ключі згенеруємо зараз, щоб не повторювати при переході на HTTPS"
fi

ask "Введіть ваш email (для VAPID):"
read -r VAPID_EMAIL

info "Генерація VAPID ключів..."
VAPID_KEYS=$(node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k.publicKey+'|'+k.privateKey)")
VAPID_PUBLIC_KEY="${VAPID_KEYS%|*}"
VAPID_PRIVATE_KEY="${VAPID_KEYS#*|}"
ok "VAPID ключі згенеровано"

# =============================================================================
#  Крок 7 — Файл .env
# =============================================================================
step "Крок 7 — Файл .env"

JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

# Для Quick Tunnel BASE_URL поки невідомий — ставимо заглушку
EFFECTIVE_BASE_URL="${BASE_URL:-https://YOUR-SUBDOMAIN.trycloudflare.com}"
EFFECTIVE_CALLBACK="${EFFECTIVE_BASE_URL}/api/auth/google/callback"
EFFECTIVE_DRIVE_CALLBACK="${EFFECTIVE_BASE_URL}/api/auth/google/drive/callback"

cat > "$ENV_FILE" <<EOF
DATABASE_URL=${DATABASE_URL}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_CALLBACK_URL=${EFFECTIVE_CALLBACK}
GOOGLE_DRIVE_CALLBACK_URL=${EFFECTIVE_DRIVE_CALLBACK}
JWT_SECRET=${JWT_SECRET}
VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_EMAIL=mailto:${VAPID_EMAIL}
NODE_ENV=production
PORT=3000
BASE_URL=${EFFECTIVE_BASE_URL}
APP_URL=${EFFECTIVE_BASE_URL}
CHROMIUM_PATH=${CHROMIUM_PATH}
PUPPETEER_CACHE_DIR=${APP_DIR}/.puppeteer-cache
RESEND_API_KEY=${RESEND_API_KEY}
RESEND_FROM=${RESEND_FROM}
EOF

chmod 600 "$ENV_FILE"
chown "${SERVICE_USER}:${SERVICE_USER}" "$ENV_FILE"
ok ".env створено (права 600)"

if [[ "$QUICK_TUNNEL" == "true" ]]; then
  warn "Після отримання URL Quick Tunnel оновіть BASE_URL, APP_URL,"
  warn "GOOGLE_CALLBACK_URL та GOOGLE_DRIVE_CALLBACK_URL в .env:"
  warn "  sudo nano ${ENV_FILE}"
  warn "  sudo systemctl restart blood"
fi

# =============================================================================
#  Крок 8 — systemd сервіс
# =============================================================================
step "Крок 8 — systemd сервіс"

cat > /etc/systemd/system/blood.service <<EOF
[Unit]
Description=Blood Health Monitor
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
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
#  Крок 9 — Cloudflare Tunnel (за потребою)
# =============================================================================
if [[ "$USE_TUNNEL" == "true" ]]; then
  step "Крок 9 — Cloudflare Tunnel"

  # Встановлення cloudflared
  if ! command -v cloudflared &>/dev/null; then
    info "Встановлення cloudflared..."
    ARCH=$(uname -m)
    case "$ARCH" in
      aarch64) CF_ARCH="arm64" ;;
      armv7l)  CF_ARCH="arm"   ;;
      x86_64)  CF_ARCH="amd64" ;;
      *)        CF_ARCH="amd64" ;;
    esac
    curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
      -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
  fi
  ok "cloudflared $(cloudflared --version | head -1)"

  if [[ "$QUICK_TUNNEL" == "true" ]]; then
    # ── Quick Tunnel: без акаунту, без домену ─────────────────────────────────
    info "Налаштування Quick Tunnel (без авторизації)..."

    cat > /etc/systemd/system/cloudflared.service <<EOF
[Unit]
Description=Cloudflare Quick Tunnel
After=network.target blood.service
Wants=blood.service

[Service]
Type=simple
User=${SERVICE_USER}
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:3000 --no-autoupdate
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable cloudflared &>/dev/null
    systemctl start cloudflared

    echo ""
    info "Чекаємо на отримання URL (до 15 сек)..."
    sleep 10

    QUICK_URL=$(journalctl -u cloudflared -n 50 --no-pager 2>/dev/null \
      | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || echo "")

    if [[ -n "$QUICK_URL" ]]; then
      ok "Quick Tunnel URL: ${QUICK_URL}"
      # Оновити .env з реальним URL
      sed -i "s|^BASE_URL=.*|BASE_URL=${QUICK_URL}|" "$ENV_FILE"
      sed -i "s|^APP_URL=.*|APP_URL=${QUICK_URL}|" "$ENV_FILE"
      sed -i "s|^GOOGLE_CALLBACK_URL=.*|GOOGLE_CALLBACK_URL=${QUICK_URL}/api/auth/google/callback|" "$ENV_FILE"
      sed -i "s|^GOOGLE_DRIVE_CALLBACK_URL=.*|GOOGLE_DRIVE_CALLBACK_URL=${QUICK_URL}/api/auth/google/drive/callback|" "$ENV_FILE"
      systemctl restart blood
      ok ".env оновлено з реальним URL"
    else
      warn "URL ще не з'явився. Знайдіть його вручну:"
      warn "  journalctl -u cloudflared -n 50 | grep trycloudflare"
      warn "  Потім оновіть .env: sudo nano ${ENV_FILE}"
    fi

  else
    # ── Повний Tunnel з доменом ───────────────────────────────────────────────
    # Усе виконуємо від root: cloudflared тримає cert/креденшали в /root/.cloudflared,
    # а для системної служби копіюємо конфіг+креденшали в /etc/cloudflared
    # (єдина тека → жодних конфліктів /root vs /etc при `service install`).
    CF_HOME="/root/.cloudflared"
    CF_SYS="/etc/cloudflared"
    TUNNEL_NAME="blood-health"
    mkdir -p "$CF_HOME" "$CF_SYS"

    echo ""
    if [[ ! -f "$CF_HOME/cert.pem" ]]; then
      info "Авторизація в Cloudflare (відкриється посилання)..."
      cloudflared tunnel login
    else
      ok "Cloudflare авторизація вже є ($CF_HOME/cert.pem)"
    fi

    # UUID наявного тунелю (точний збіг по імені в колонці NAME)
    TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n{print $1; exit}' || true)

    # Тунель існує, але локальних креденшалів нема → його неможливо запустити, перестворюємо
    if [[ -n "$TUNNEL_ID" && ! -f "$CF_HOME/${TUNNEL_ID}.json" ]]; then
      warn "Тунель '$TUNNEL_NAME' існує ($TUNNEL_ID), але креденшалів немає локально — перестворюю."
      cloudflared tunnel delete -f "$TUNNEL_NAME" &>/dev/null || true
      TUNNEL_ID=""
    fi

    if [[ -z "$TUNNEL_ID" ]]; then
      info "Створення тунелю '$TUNNEL_NAME'..."
      cloudflared tunnel create "$TUNNEL_NAME" >/dev/null 2>&1 || true
      TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n{print $1; exit}' || true)
    fi
    [[ -n "$TUNNEL_ID" ]] || err "Не вдалось отримати UUID тунелю"
    [[ -f "$CF_HOME/${TUNNEL_ID}.json" ]] || err "Немає файлу креденшалів $CF_HOME/${TUNNEL_ID}.json"
    ok "Тунель: $TUNNEL_NAME ($TUNNEL_ID)"

    # Креденшали + config у системну теку
    cp -f "$CF_HOME/${TUNNEL_ID}.json" "$CF_SYS/${TUNNEL_ID}.json"
    cat > "$CF_SYS/config.yml" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CF_SYS}/${TUNNEL_ID}.json

ingress:
  - hostname: ${APP_DOMAIN}
    service: http://localhost:3000
  - service: http_status:404
EOF
    rm -f "$CF_HOME/config.yml"   # прибрати можливий конфлікт-конфіг
    ok "config.yml → $CF_SYS/config.yml"

    # DNS-маршрут (ідемпотентно)
    info "DNS запис для ${APP_DOMAIN}..."
    DNS_OUT=$(cloudflared tunnel route dns "$TUNNEL_ID" "$APP_DOMAIN" 2>&1 || true)
    if echo "$DNS_OUT" | grep -qi "already"; then
      if echo "$DNS_OUT" | grep -q "$TUNNEL_ID"; then
        ok "DNS вже вказує на цей тунель"
      else
        warn "DNS ${APP_DOMAIN} указує на ІНШИЙ тунель — онови CNAME у Cloudflare → ${TUNNEL_ID}.cfargotunnel.com"
      fi
    else
      ok "DNS запис створено"
    fi

    # Служба systemd — чисто перевстановлюємо на наш конфіг
    systemctl stop cloudflared &>/dev/null || true
    cloudflared service uninstall &>/dev/null || true
    rm -f /etc/systemd/system/cloudflared.service
    systemctl daemon-reload
    cloudflared --config "$CF_SYS/config.yml" service install
    systemctl enable cloudflared &>/dev/null
    systemctl restart cloudflared

    sleep 4
    systemctl is-active cloudflared &>/dev/null && ok "Cloudflare Tunnel запущено" \
      || warn "Тунель не запустився. Перевірте: journalctl -u cloudflared -n 30"
  fi

else
  step "Крок 9 — Cloudflare Tunnel"
  info "Пропущено (обрано режим по IP)"
  ok "Застосунок доступний в локальній мережі: ${BASE_URL}"
fi

# =============================================================================
#  Крок 10 — Автоматичний бекап БД
# =============================================================================
step "Крок 10 — Автоматичний бекап БД"

mkdir -p "/home/${SERVICE_USER}/backups"
chown "${SERVICE_USER}:${SERVICE_USER}" "/home/${SERVICE_USER}/backups"

CRON_CMD="0 3 * * * pg_dump -U health health > /home/${SERVICE_USER}/backups/health_\$(date +\\%Y\\%m\\%d).sql 2>/dev/null"
(crontab -u "$SERVICE_USER" -l 2>/dev/null | grep -v "pg_dump.*health" || true; echo "$CRON_CMD") \
  | crontab -u "$SERVICE_USER" -
ok "Бекап щодня о 03:00 → /home/${SERVICE_USER}/backups/"

# =============================================================================
#  Підсумок
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Розгортання завершено успішно!${NC}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo ""

case "$ACCESS_MODE" in
  1)
    echo -e "  ${BOLD}Застосунок:${NC}  ${CYAN}${BASE_URL}${NC}"
    echo ""
    echo -e "  ${YELLOW}Відкрийте цей URL в браузері на будь-якому${NC}"
    echo -e "  ${YELLOW}пристрої в тій самій мережі Wi-Fi.${NC}"
    ;;
  2)
    if [[ -n "${QUICK_URL:-}" ]]; then
      echo -e "  ${BOLD}Застосунок:${NC}  ${CYAN}${QUICK_URL}${NC}"
    else
      echo -e "  ${BOLD}Застосунок:${NC}  знайдіть URL:"
      echo -e "  ${CYAN}journalctl -u cloudflared -n 50 | grep trycloudflare${NC}"
    fi
    echo ""
    warn "URL зміниться при рестарті cloudflared"
    ;;
  3)
    echo -e "  ${BOLD}Застосунок:${NC}  ${CYAN}${BASE_URL}${NC}"
    ;;
esac

echo ""
echo -e "  ${BOLD}Статус сервісів:${NC}"
echo -e "  blood:       $(systemctl is-active blood)"
[[ "$USE_TUNNEL" == "true" ]] && \
  echo -e "  cloudflared: $(systemctl is-active cloudflared)"
echo -e "  postgresql:  $(systemctl is-active postgresql)"
echo ""
echo -e "  ${BOLD}Корисні команди:${NC}"
echo -e "  Логи застосунку:  ${CYAN}journalctl -u blood -f${NC}"
[[ "$USE_TUNNEL" == "true" ]] && \
  echo -e "  Логи тунелю:      ${CYAN}journalctl -u cloudflared -f${NC}"
echo -e "  Перезапуск:       ${CYAN}sudo systemctl restart blood${NC}"
echo -e "  Редагувати .env:  ${CYAN}sudo nano ${ENV_FILE}${NC}"
echo ""
warn "Перший хто увійде через Google або реєстрацію — стає адміністратором."
echo ""
