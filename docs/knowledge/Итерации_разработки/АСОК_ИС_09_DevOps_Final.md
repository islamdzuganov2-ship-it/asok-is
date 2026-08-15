---
tags:
  - бэк
---

# АСОК ИС — DevOps: Dockerfiles, Nginx, requirements, package.json, GitLab CI
**Дата:** 2026-05-17 | **Итерация:** 3 (финальная)

## backend/Dockerfile
Multi-stage build (python:3.11-slim):
- Stage builder: gcc + libpq-dev, pip install --prefix=/install
- Stage runtime: libpq5 только, непривилегированный user appuser
- HEALTHCHECK: urllib.request к /health каждые 15с
- CMD: uvicorn --workers 2 (prod)
- Директория /app/uploads с chmod 755

## frontend/Dockerfile
Multi-stage build:
- Stage builder: node:20-alpine, npm ci + npm run build
- Stage runtime: nginx:1.25-alpine + nginx.conf + /app/build → /usr/share/nginx/html
- ARG REACT_APP_API_BASE_URL для подстановки при сборке
- HEALTHCHECK: wget /health

## frontend/nginx.conf
- try_files $uri $uri/ /index.html (React Router SPA)
- location /api/ → proxy_pass http://backend:8000
- proxy_read_timeout 120s (для Excel upload и AI генерации)
- gzip on для js/css/json
- Static assets: expires 1y, Cache-Control: immutable
- /health endpoint: return 200 "ok"

## backend/requirements.txt (зафиксированные версии)
```
fastapi==0.111.0
uvicorn[standard]==0.29.0
pydantic==2.7.1
pydantic-settings==2.2.1
sqlalchemy==2.0.30
asyncpg==0.29.0
alembic==1.13.1
psycopg2-binary==2.9.9
passlib[bcrypt]==1.7.4
python-jose[cryptography]==3.3.0
celery==5.3.6
redis==5.0.4
kombu==5.3.4
openpyxl==3.1.2
httpx==0.27.0
slowapi==0.1.9
prometheus-fastapi-instrumentator==6.1.0
python-multipart==0.0.9
pytest==8.2.0
pytest-asyncio==0.23.6
```

## frontend/package.json (ключевые зависимости)
```json
{
  "@reduxjs/toolkit": "^2.2.3",
  "antd": "^5.17.0",
  "axios": "^1.7.0",
  "echarts": "^5.5.0",
  "react": "^18.3.1",
  "react-redux": "^9.1.2",
  "react-router-dom": "^6.23.0",
  "typescript": "^5.4.5"
}
```

## .gitlab-ci.yml
Стадии: lint → test → build → deploy

### lint
- lint:backend — flake8, max-line-length=100
- lint:frontend — eslint --max-warnings 0
- Запускаются только при изменениях в backend/**/* / frontend/**/*

### test
- test:backend — PostgreSQL 14 service, alembic upgrade head, seed_metrics, pytest --cov --cov-fail-under=80
- test:frontend — npm test --coverage
- Артефакты: cobertura coverage.xml (expire 7d)

### build
- build:backend / build:frontend — docker build + push в GitLab Registry
- Теги: $CI_COMMIT_SHA + latest
- Только на ветке main

### deploy
- deploy:staging — SSH + docker compose pull + up -d + alembic upgrade head (auto, при merge в main)
- deploy:production — то же самое, when: manual (ручное подтверждение в GitLab)
- Env переменные в GitLab CI: STAGING_SSH_KEY, STAGING_HOST, PRODUCTION_SSH_KEY и т.д.

## .env.example (финальный)
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/asok_is
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=change_me_in_prod_min_32_chars
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
OLLAMA_API_URL=http://ollama:11434/api/generate
OLLAMA_MODEL=llama3:8b
DEMO_MODE=true
LOG_LEVEL=INFO
CORS_ORIGINS=["http://localhost:3000"]
POSTGRES_USER=asok_user
POSTGRES_PASSWORD=change_in_prod
UPLOAD_DIR=/app/uploads
```
