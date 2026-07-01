# Встановлення на Raspberry Pi

## Вимоги

- Raspberry Pi 4 або 5 (рекомендовано 4GB+)
- Raspberry Pi OS **Bookworm** 64-bit (перевірено на Lite і Desktop)
- Доступ по SSH або безпосередньо
- Власний домен, прив'язаний до **Cloudflare** (для тунелю)
- Google Cloud проєкт для OAuth

---

## Автоматичне встановлення (рекомендовано)

```bash
git clone https://github.com/MaanAndrii/blood.git
cd blood
sudo bash setup.sh
```

Візард проведе через всі кроки інтерактивно (системні пакети, БД, режим доступу, Google OAuth, email для відновлення пароля, VAPID, `.env`, systemd, Cloudflare Tunnel, автоматичний бекап). Якщо щось пішло не так — читайте ручне встановлення нижче.

---

## Ручне встановлення (покроково)

### Крок 1 — Оновлення системи

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

---

### Крок 2 — Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # має бути v20.x.x
```

---

### Крок 3 — PostgreSQL

```bash
sudo apt install -y postgresql postgresql-client
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

Створити базу і користувача:

```bash
sudo -u postgres psql
```

```sql
CREATE USER health WITH PASSWORD 'ВАШ_НАДІЙНИЙ_ПАРОЛЬ';
CREATE DATABASE health OWNER health;
GRANT ALL PRIVILEGES ON DATABASE health TO health;
\q
```

---

### Крок 4 — Chromium для Puppeteer

> **Важливо:** На RPi OS Bookworm (Debian 12) пакет називається `chromium`, а **не** `chromium-browser`. Якщо встановити `chromium-browser` — отримаєте помилку `Package not found`.

```bash
sudo apt install -y chromium \
  libgbm1 libxkbcommon0 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 libasound2

which chromium
# /usr/bin/chromium
```

---

### Крок 5 — Клонування проєкту

```bash
cd ~
git clone https://github.com/MaanAndrii/blood.git
cd blood
```

---

### Крок 6 — npm залежності

> **Важливо:** Встановіть змінну `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1` **перед** `npm install`. Без цього Puppeteer спробує завантажити власний Chromium (~300MB для ARM64) і `npm install` зависне на 30+ хвилин або впаде з помилкою мережі.

```bash
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install
```

Вказати системний Chromium у `server/services/pdf.js`:

```bash
nano server/services/pdf.js
```

Знайти `puppeteer.launch({` і додати `executablePath`:

```javascript
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
```

---

### Крок 7 — VAPID ключі для Web Push

```bash
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log('Public: '+k.publicKey+'\nPrivate: '+k.privateKey)"
```

Збережіть обидва ключі — знадобляться в `.env`.

---

### Крок 8 — Файл .env

```bash
cp .env.example .env
nano .env
```

Заповнити всі значення:

```env
DATABASE_URL=postgresql://health:ВАШ_НАДІЙНИЙ_ПАРОЛЬ@localhost:5432/health
GOOGLE_CLIENT_ID=          # з кроку 9
GOOGLE_CLIENT_SECRET=      # з кроку 9
GOOGLE_CALLBACK_URL=https://ВАШ_ДОМЕН/api/auth/google/callback
GOOGLE_DRIVE_CALLBACK_URL=https://ВАШ_ДОМЕН/api/auth/google/drive/callback
JWT_SECRET=                # генерується нижче
VAPID_PUBLIC_KEY=          # з кроку 7
VAPID_PRIVATE_KEY=         # з кроку 7
VAPID_EMAIL=mailto:ваш@email.com
NODE_ENV=production
PORT=3000
BASE_URL=https://ВАШ_ДОМЕН
APP_URL=https://ВАШ_ДОМЕН   # має збігатися з BASE_URL; використовується для CSRF-перевірки та посилань у листах відновлення пароля
RESEND_API_KEY=            # опційно, https://resend.com — без нього лист відновлення пароля лише пишеться в лог сервера
RESEND_FROM=BP & BMI <no-reply@ВАШ_ДОМЕН>
```

> **Важливо:** Якщо `APP_URL` не задано, сервер підставляє запасний домен за замовчуванням — посилання у листах відновлення пароля вестимуть на чужий домен. Завжди явно задавайте `APP_URL` рівним `BASE_URL`.

Генерація JWT_SECRET:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Важливо:** Файл `.env` повинен належати вашому користувачу (не root), інакше systemd-сервіс не зможе його прочитати і застосунок не запуститься з помилкою `OAuth2Strategy requires a clientID`.

```bash
chmod 600 .env
sudo chown $USER:$USER .env
```

---

### Крок 9 — Google OAuth

1. Відкрити [console.cloud.google.com](https://console.cloud.google.com)
2. Створити проєкт або вибрати існуючий
3. **APIs & Services → Enable APIs → Google People API** (увімкнути)
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Тип: **Web application**
6. Authorized JavaScript origins:
   ```
   https://ВАШ_ДОМЕН
   ```
7. Authorized redirect URIs:
   ```
   https://ВАШ_ДОМЕН/api/auth/google/callback
   ```
8. Скопіювати Client ID і Client Secret → вставити в `.env`

> OAuth consent screen → External → додати свій email як тестового користувача (поки додаток не верифіковано Google).

---

### Крок 10 — Тест запуску

```bash
node server/index.js
```

Очікуваний вивід:
```
[db] Database initialized
[server] Listening on port 3000
[server] NODE_ENV=production
```

Якщо помилка БД — перевірте `DATABASE_URL` і що PostgreSQL запущено.

Зупинити: `Ctrl+C`

---

### Крок 11 — systemd сервіс

```bash
sudo nano /etc/systemd/system/blood.service
```

Вміст (замініть `maan` на ваш логін і шлях до проєкту):

```ini
[Unit]
Description=Blood Health Monitor
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=maan
WorkingDirectory=/home/maan/blood
EnvironmentFile=/home/maan/blood/.env
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

Якщо статус `failed` — дивіться логи:

```bash
journalctl -u blood -n 30 --no-pager
```

Найпоширеніші причини збою:

| Помилка в логах | Причина | Рішення |
|---|---|---|
| `OAuth2Strategy requires a clientID` | `.env` не читається сервісом | `sudo chown $USER:$USER .env` |
| `password authentication failed` | Неправильний пароль в `DATABASE_URL` | Перевірте пароль у `.env` |
| `Cannot find module` | `node_modules` не встановлено | `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install` |
| `EACCES permission denied` | Файли належать root | `sudo chown -R $USER:$USER ~/blood` |

---

### Крок 12 — Cloudflare Tunnel

#### Встановлення cloudflared (ARM64)

```bash
sudo curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" \
  -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

#### Авторизація

```bash
cloudflared tunnel login
```

Відкриється посилання — перейдіть в браузері, виберіть домен, авторизуйтесь. Сертифікат збережеться в `~/.cloudflared/cert.pem`.

#### Створення тунелю

```bash
cloudflared tunnel create blood-health
```

Запишіть UUID з виводу, наприклад: `9292be0a-900c-4803-b0df-9c218027b0be`

#### DNS запис

```bash
cloudflared tunnel route dns blood-health ВАШ_ДОМЕН
```

Якщо отримали `Error 1016` в браузері — DNS запис не додано. Виконайте команду вище і зачекайте 1-2 хвилини.

#### Конфігурація тунелю

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Вміст (замініть UUID і домен):

```yaml
tunnel: blood-health
credentials-file: /home/maan/.cloudflared/ВАШ_UUID.json

ingress:
  - hostname: ВАШ_ДОМЕН
    service: http://localhost:3000
  - service: http_status:404
```

#### Тест тунелю

```bash
cloudflared tunnel run blood-health
```

Відкрийте `https://ВАШ_ДОМЕН` в браузері. Якщо все ок — `Ctrl+C`.

#### systemd сервіс для cloudflared

> **Важливо:** `sudo cloudflared service install` **без** `--config` не знаходить конфіг, бо `sudo` змінює `HOME` на `/root`. Потрібно вказати шлях явно.

```bash
sudo cloudflared --config ~/.cloudflared/config.yml service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

### Крок 13 — Перевірка

```bash
# Статус усіх сервісів
sudo systemctl status blood
sudo systemctl status cloudflared
sudo systemctl status postgresql

# Порт слухається локально
ss -tlnp | grep 3000

# HTTP тест
curl -s http://localhost:3000/api/auth/me
# Має повернути: {"error":"Unauthorized"}
```

Відкрийте `https://ВАШ_ДОМЕН` — має з'явитись лендінг з формою входу/реєстрації.

---

### Крок 14 — Перший вхід і адміністратор

Перший хто увійде через Google — автоматично отримує права адміністратора.

Для додавання членів сім'ї: натисніть на своє ім'я у правому верхньому куті → **⚙️ Адмін** → введіть email → **Додати**.

Після цього людина зможе увійти зі своїм Google акаунтом (її email має бути в системі заздалегідь).

---

## Оновлення застосунку

```bash
cd ~/blood
git pull origin main
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install
sudo systemctl restart blood
```

---

## Резервне копіювання

Налаштовується автоматично через візард (крок 9) або вручну:

```bash
mkdir -p ~/backups
crontab -e
```

Додати рядок:

```cron
0 3 * * * pg_dump -U health health > /home/maan/backups/health_$(date +\%Y\%m\%d).sql
```

Ручний бекап:

```bash
pg_dump -U health health > ~/backups/health_manual.sql
```

Відновлення:

```bash
psql -U health health < ~/backups/health_20260619.sql
```

---

## Вирішення типових проблем

**Застосунок не запускається**
```bash
journalctl -u blood -n 50 --no-pager
# або запустити вручну для детальної помилки:
cd ~/blood && node server/index.js
```

**OAuth2Strategy requires a clientID (сервіс не стартує)**
```bash
ls -la ~/blood/.env          # перевірте що файл існує і належить вашому юзеру
sudo chown $USER:$USER ~/blood/.env
sudo systemctl restart blood
```

**npm install зависає на 30+ хвилин**
```bash
# Зупиніть Ctrl+C і запустіть правильно:
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install
```

**Chromium не знайдено (помилка PDF)**
```bash
which chromium          # має бути /usr/bin/chromium
sudo apt install -y chromium
```

**Error 1016 — Origin DNS error (Cloudflare)**
```bash
# DNS запис не створено:
cloudflared tunnel route dns blood-health ВАШ_ДОМЕН
# Зачекайте 1-2 хвилини і оновіть сторінку
```

**cloudflared.service could not be found**
```bash
# Сервіс не встановлено або встановлено без конфігу:
sudo cloudflared --config ~/.cloudflared/config.yml service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

**PostgreSQL: password authentication failed**
```bash
sudo -u postgres psql -c "ALTER USER health WITH PASSWORD 'новий_пароль';"
# Оновити DATABASE_URL в .env і перезапустити
sudo systemctl restart blood
```

**VAPID помилка при push-нагадуваннях**
```bash
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log('Public: '+k.publicKey+'\nPrivate: '+k.privateKey)"
# Оновити VAPID_PUBLIC_KEY і VAPID_PRIVATE_KEY в .env
sudo systemctl restart blood
```

**Лист «Відновлення пароля» не приходить**
```bash
# Без RESEND_API_KEY посилання лише пишеться в лог, не надсилається поштою:
grep "email.*not sent" ~/blood/logs/app.log
# Додайте RESEND_API_KEY і RESEND_FROM у .env (https://resend.com), потім:
sudo systemctl restart blood
```

**Посилання відновлення пароля веде на чужий домен**
```bash
# APP_URL не задано — сервер підставив запасний домен за замовчуванням
grep "^APP_URL=" ~/blood/.env || echo "APP_URL відсутній у .env"
# Додати рядок APP_URL=https://ВАШ_ДОМЕН (має збігатися з BASE_URL)
sudo systemctl restart blood
```
