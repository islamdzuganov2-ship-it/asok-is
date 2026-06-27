# АСОК ИС — доступ из интернета по ссылке

> Детальные пошаговые инструкции (максимально подробно):
> - **Cloudflare-туннель (рекомендуется):** [SETUP_CLOUDFLARE_TUNNEL.md](SETUP_CLOUDFLARE_TUNNEL.md)
> - **Прямой хост с вашего ПК (без туннеля):** [SETUP_DIRECT_HOST.md](SETUP_DIRECT_HOST.md)
>
> Ниже — краткий обзор всех вариантов.

Публичный доступ реализован отдельным контейнером-туннелем. Принцип:

- **туннель запущен** → приложение доступно извне по ссылке;
- **не запущен** → только локально (`http://localhost:3000`).

Есть три варианта. Все используют один источник (Vite проксирует `/api` на бэкенд), поэтому
ссылка работает «как есть», без настройки CORS.

> Важно: используется протокол **http2** (не QUIC). Это обходит проблемы QUIC/UDP в Docker
> Desktop (предупреждение `failed to increase receive buffer`) и ошибку Cloudflare **1033**.

## Вариант 1 — быстрая случайная ссылка (без аккаунта)
```bash
docker compose --profile tunnel up -d
docker compose logs -f tunnel        # строка вида https://<random>.trycloudflare.com
```
URL меняется при каждом перезапуске. Подходит для разовой демонстрации.

## Вариант 2 — СТАТИЧНАЯ ссылка на домене asokis.ai (Cloudflare named tunnel) ← рекомендуется
Стабильный URL `https://asok.asokis.ai`. Домен `asokis.ai` уже в вашем аккаунте Cloudflare.

**Предусловие:** домен должен стать активным. Сейчас он в статусе ожидания —
смените NS у регистратора на `desi.ns.cloudflare.com` и `patrick.ns.cloudflare.com`
(1–24 часа). Пока статус не Active, туннель-домен работать не будет.

1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, имя напр. `asok`.
2. Вкладка **Public Hostname → Add a public hostname**:
   - Subdomain: `asok`, Domain: `asokis.ai` (итог: `asok.asokis.ai`);
   - Type: `HTTP`, URL/Service: `frontend:3000`.
   (Можно указать и корень `asokis.ai` — бесплатный Universal SSL покрывает корень и поддомены 1-го уровня.)
3. На шаге установки скопировать **токен** туннеля (длинная строка `eyJ...`) → в `.env`:
   `TUNNEL_TOKEN=eyJ...`
4. Запуск:
```bash
docker compose --profile named up -d
docker compose logs -f tunnel-named     # дождаться "Registered tunnel connection"
```
Открыть `https://asok.asokis.ai`. URL не меняется между перезапусками — это и есть «как домен».

> Ингресс (какой хост → какой сервис) хранится в дашборде Cloudflare, локальный конфиг не нужен.
> API-токен аккаунта проекту НЕ требуется — используется только токен самого туннеля.

## Вариант 3 — СТАТИЧНЫЙ домен без своего домена (ngrok)
Бесплатный статический домен `your-name.ngrok-free.app` (1 шт. на бесплатный аккаунт).
1. В дашборде ngrok: скопировать **authtoken**, в разделе **Domains** забронировать бесплатный домен.
2. В `.env`: `NGROK_AUTHTOKEN=...` и `NGROK_DOMAIN=your-name.ngrok-free.app`.
3. Запуск:
```bash
docker compose --profile ngrok up -d
docker compose logs -f tunnel-ngrok
```

## Только локально (без интернета)
```bash
docker compose up -d                 # → http://localhost:3000
```

## Остановить публичный доступ (локальный продолжит работать)
```bash
docker compose stop tunnel tunnel-named tunnel-ngrok
```

## Диагностика Error 1033
- 1033 = edge Cloudflare не может достучаться до коннектора. Признаки в логах: протокол `quic`,
  нет строк `Registered tunnel connection`. Лечится `--protocol http2` (уже включено).
- После старта ссылка может быть недоступна 10–30 секунд («may take some time to be reachable»).
- Проверьте, что в логах появились строки `Registered tunnel connection connIndex=...`.

## Безопасность
Публичная ссылка открывает доступ всем, у кого она есть, а стенд по умолчанию в `DEMO_MODE`
(вход = ADMIN). **Не публикуйте туннель с реальными данными.** Для прода: `DEMO_MODE=false`,
реальные секреты (см. `docs/SECURITY_ANALYSIS.md`), закрытый доступ.
