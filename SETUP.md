# Встановлення на Raspberry Pi 5

## Вимоги
- Raspberry Pi 5 (4GB / 8GB)
- Raspberry Pi OS Bookworm 64-bit (рекомендується Lite)
- Доступ по SSH або безпосередньо
- Власний домен на Cloudflare
- Google Cloud проєкт для OAuth

---

## Крок 1 — Оновлення системи

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

---

## Крок 2 — Встановлення Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # має бути v20.x.x
npm --version
```

---

## Крок 3 — Встановлення PostgreSQL

```bash
sudo apt install -y postgresql postgresql-client

# Запустити та увімкнути автозапуск
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Перевірити що працює
sudo systemctl status postgresql
```

### Створити базу даних та користувача

```bash
sudo -u postgres psql
```

У psql консолі виконати:

```sql
CREATE USER health WITH PASSWORD 'ВАШ_НАДІЙНИЙ_ПАРОЛЬ';
CREATE DATABASE health OWNER health;
GRANT ALL PRIVILEGES ON DATABASE health TO health;
\q
```

> Замініть `ВАШ_НАДІЙНИЙ_ПАРОЛЬ` на свій. Запишіть — знадобиться в `.env`.

---

## Крок 4 — Встановлення залежностей Puppeteer

Puppeteer потребує системний Chromium на ARM64:

```bash
sudo apt install -y chromium-browser \
  libgbm1 libxkbcommon0 libatk1.0-0 \
  libatk-bridge2.0-0 libcups2 libdrm2 \
  libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 \
  libasound2
```

Перевірити шлях до Chromium:

```bash
which chromium-browser
# /usr/bin/chromium-browser
```

---

## Крок 5 — Клонування проєкту

```bash
cd /home/pi
git clone https://github.com/MaanAndrii/blood.git
cd blood
git checkout claude/dreamy-cannon-p1768u
```

### Встановлення npm залежностей

```bash
npm install

# Повідомити Puppeteer де знаходиться системний Chromium
# (не завантажувати свій — економимо ~300MB)
npm install puppeteer --ignore-scripts
```

---

## Крок 6 — Налаштування Puppeteer на системний Chromium

Відредагувати `server/services/pdf.js` — додати `executablePath`:

```bash
nano server/services/pdf.js
```

Знайти рядок `puppeteer.launch({` і замінити блок:

```javascript
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
```

---

## Крок 7 — Генерація VAPID ключів для Web Push

```bash
npx web-push generate-vapid-keys
```

Збережіть вивід — знадобиться в `.env`:
```
Public Key:  BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxCQ
Private Key: yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

---

## Крок 8 — Створення файлу .env

```bash
cp .env.example .env
nano .env
```

Заповнити всі значення:

```env
DATABASE_URL=postgresql://health:ВАШ_НАДІЙНИЙ_ПАРОЛЬ@localhost:5432/health
GOOGLE_CLIENT_ID=          # з кроку 9
GOOGLE_CLIENT_SECRET=      # з кроку 9
GOOGLE_CALLBACK_URL=https://health.вашдомен.com/api/auth/google/callback
JWT_SECRET=                # будь-який довгий випадковий рядок (мін. 32 символи)
VAPID_PUBLIC_KEY=          # з кроку 7
VAPID_PRIVATE_KEY=         # з кроку 7
VAPID_EMAIL=mailto:ваш@email.com
NODE_ENV=production
PORT=3000
BASE_URL=https://health.вашдомен.com
```

Генерація JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Крок 9 — Налаштування Google OAuth

1. Відкрити [console.cloud.google.com](https://console.cloud.google.com)
2. Створити новий проєкт (або вибрати існуючий)
3. **APIs & Services → Enable APIs → Google People API** (увімкнути)
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Тип застосунку: **Web application**
6. Authorized JavaScript origins:
   ```
   https://health.вашдомен.com
   ```
7. Authorized redirect URIs:
   ```
   https://health.вашдомен.com/api/auth/google/callback
   ```
8. Скопіювати **Client ID** і **Client Secret** → вставити в `.env`

> OAuth consent screen → External → додати свій email як тестового користувача

---

## Крок 10 — Перший тест запуску

```bash
node server/index.js
```

Очікуваний вивід:
```
[db] Database initialized
[push] Reminder scheduler started   (або: VAPID keys not set — якщо ще не заповнили)
[server] Listening on port 3000
[server] NODE_ENV=production
```

Якщо помилка БД — перевірте DATABASE_URL і що PostgreSQL запущено.

Зупинити: `Ctrl+C`

---

## Крок 11 — systemd сервіс (автозапуск)

```bash
sudo nano /etc/systemd/system/blood.service
```

Вміст файлу:

```ini
[Unit]
Description=Blood Health Monitor
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/blood
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Активувати:

```bash
sudo systemctl daemon-reload
sudo systemctl enable blood
sudo systemctl start blood
sudo systemctl status blood
```

Перегляд логів:
```bash
journalctl -u blood -f
```

---

## Крок 12 — Cloudflare Tunnel

### Встановлення cloudflared (ARM64)

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /tmp/cloudflared
sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

### Авторизація в Cloudflare

```bash
cloudflared tunnel login
```

Відкриється посилання — перейдіть в браузері, виберіть свій домен, авторизуйтесь.

### Створення тунелю

```bash
cloudflared tunnel create blood-health
```

Вивід покаже UUID тунелю, наприклад:
```
Created tunnel blood-health with id a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### DNS запис

```bash
cloudflared tunnel route dns blood-health health.вашдомен.com
```

### Конфігурація тунелю

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Вміст:

```yaml
tunnel: blood-health
credentials-file: /home/pi/.cloudflared/a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json

ingress:
  - hostname: health.вашдомен.com
    service: http://localhost:3000
  - service: http_status:404
```

> Замініть UUID на свій з попереднього кроку.

### Тест тунелю

```bash
cloudflared tunnel run blood-health
```

Відкрийте `https://health.вашдомен.com` в браузері — має відкритися застосунок.

`Ctrl+C` щоб зупинити.

### systemd сервіс для cloudflared

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

## Крок 13 — Перевірка всього разом

```bash
# Перевірити статус сервісів
sudo systemctl status blood
sudo systemctl status cloudflared
sudo systemctl status postgresql

# Перевірити що порт 3000 слухається
ss -tlnp | grep 3000

# Переглянути логи застосунку
journalctl -u blood -n 50

# Переглянути логи тунелю
journalctl -u cloudflared -n 20
```

Відкрийте `https://health.вашдомен.com` — має з'явитися екран входу через Google.

---

## Крок 14 — Перший вхід (адміністратор)

Перший хто увійде через Google — автоматично отримує права адміністратора.

Після входу додайте інших членів сім'ї через адмін-панель:

```
Профіль (правий верхній кут) → Адмін → Додати користувача → ввести email
```

Після цього вони зможуть увійти зі своїм Google акаунтом.

---

## Оновлення застосунку

```bash
cd /home/pi/blood
git pull
npm install
sudo systemctl restart blood
```

---

## Резервне копіювання бази даних

Додати в cron щоденний бекап:

```bash
crontab -e
```

```cron
0 3 * * * pg_dump -U health health > /home/pi/backups/health_$(date +\%Y\%m\%d).sql
```

```bash
mkdir -p /home/pi/backups
```

---

## Вирішення типових проблем

**Застосунок не запускається**
```bash
journalctl -u blood -n 100 --no-pager
```

**Помилка PostgreSQL "password authentication failed"**
```bash
sudo -u postgres psql -c "ALTER USER health WITH PASSWORD 'новий_пароль';"
# Оновити DATABASE_URL в .env
sudo systemctl restart blood
```

**Puppeteer "Could not find Chromium"**
```bash
which chromium-browser
# Якщо немає:
sudo apt install -y chromium-browser
```

**Cloudflare tunnel не підключається**
```bash
cloudflared tunnel info blood-health
journalctl -u cloudflared -n 50
```

**VAPID помилка при push**
```bash
# Перегенерувати ключі
npx web-push generate-vapid-keys
# Оновити .env і перезапустити
sudo systemctl restart blood
```
