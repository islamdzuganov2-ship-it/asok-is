# Полная пошаговая инструкция — публикация через бесплатный статичный домен ngrok

Результат: стабильная публичная ссылка вида `https://ваше-имя.ngrok-free.app`, которая ведёт на
ваш ПК. **Без покупки домена, без проброса портов, без белого IP.** Адрес не меняется между
перезапусками (в отличие от быстрого туннеля).

---

## 0. Предусловия
1. Docker Desktop запущен, вы в папке проекта `C:\Users\adiga\projects\asok-is`.
2. Базовый стенд работает локально:
   ```powershell
   docker compose up -d
   ```
   Открыть `http://localhost:3000` — приложение работает.

---

## 1. Создать бесплатный аккаунт ngrok
1. Откройте `https://dashboard.ngrok.com/signup`.
2. Зарегистрируйтесь (email или вход через Google/GitHub). Карта не нужна, тариф Free.

---

## 2. Скопировать authtoken
1. В дашборде ngrok слева: **Getting Started → Your Authtoken**
   (прямая ссылка: `https://dashboard.ngrok.com/get-started/your-authtoken`).
2. Нажмите **Copy** — это строка вида `2abcD...XYZ` (длинная). Это секрет — никому не показывайте.

---

## 3. Забронировать бесплатный статичный домен
1. В дашборде слева: **Universal Gateway → Domains** (или просто **Domains**).
   Прямая ссылка: `https://dashboard.ngrok.com/domains`.
2. Нажмите **Create Domain** (или **+ New Domain**).
3. На бесплатном тарифе выдаётся **один** статичный домен с авто-сгенерированным именем, например
   `cuddly-firm-grackle.ngrok-free.app`. Имя выбрать нельзя, но оно **постоянное**.
4. Скопируйте выданный домен целиком (без `https://`), например `cuddly-firm-grackle.ngrok-free.app`.

---

## 4. Вписать значения в .env проекта
1. Откройте файл `.env` в корне проекта (НЕ `.env.example`; если нет — создайте копией из `.env.example`).
2. Добавьте/замените строки:
   ```
   NGROK_AUTHTOKEN=вставьте_ваш_authtoken
   NGROK_DOMAIN=cuddly-firm-grackle.ngrok-free.app
   ```
   (домен — ваш из шага 3, без `https://`).
3. Сохраните файл. Не коммитьте `.env` в git.

---

## 5. Запустить
```powershell
docker compose --profile ngrok up -d
docker compose logs -f tunnel-ngrok
```
В логах дождитесь строк вида:
```
msg="started tunnel" ... url=https://cuddly-firm-grackle.ngrok-free.app
```
(Ctrl+C — выйти из логов, контейнер продолжит работать.)

---

## 6. Открыть и проверить
1. Откройте `https://ваше-имя.ngrok-free.app` в браузере.
2. На бесплатном тарифе ngrok при первом заходе показывает **страницу-предупреждение**
   («You are about to visit …») — нажмите **Visit Site**. Это нормальное поведение free-тарифа.
3. Дальше открывается приложение. Вход демо-учёткой: `admin` / `Admin123!` (если DEMO_MODE).

---

## 7. Управление
- Остановить публичную ссылку (локальный `:3000` останется):
  ```powershell
  docker compose stop tunnel-ngrok
  ```
- Снова включить: `docker compose --profile ngrok up -d`
- Полностью убрать контейнер: `docker compose rm -sf tunnel-ngrok`
- Сменить ссылку обратно на свою: домен и токен в `.env` остаются — при следующем запуске тот же адрес.

---

## 8. Диагностика
| Симптом | Причина / решение |
|--------|-------------------|
| В логах `ERR_NGROK_... authentication failed` | Неверный/пустой `NGROK_AUTHTOKEN`. Скопируйте токен заново. |
| `ERR_NGROK_... domain not found / not reserved` | `NGROK_DOMAIN` не совпадает с забронированным в дашборде. Скопируйте точное имя. |
| Открывается `Blocked request. This host ... is not allowed` | Хост не разрешён в Vite. В проекте уже разрешён `.ngrok-free.app`; перезапустите фронтенд: `docker compose up -d --force-recreate frontend`. |
| Страница-предупреждение каждый раз | Особенность free-тарифа ngrok. Жмите **Visit Site** (один раз за сессию браузера). |
| Сайт не грузит данные | Бэкенд/фронтенд не запущены: `docker compose up -d`. |
| `failed to bind` / порт занят | ngrok не биндит локальные порты — проверьте, что запускали именно с `--profile ngrok`. |

---

## 9. Безопасность
Ссылка доступна всем, кому вы её дали. Стенд по умолчанию `DEMO_MODE=true` → вход без пароля = ADMIN.
Перед показом «вживую» с реальными данными: в `.env` `DEMO_MODE=false`, сильный `JWT_SECRET` (≥32 симв.),
реальные пользователи (см. `docs/SECURITY_ANALYSIS.md`). Для закрытого доступа ngrok поддерживает
basic-auth: добавьте в команду `--basic-auth "user:password"` (в `docker-compose.yml`, сервис `tunnel-ngrok`).
