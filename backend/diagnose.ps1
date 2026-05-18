# backend/diagnose.ps1
Write-Host "🔍 АСОК ИС — Диагностика системы" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Контейнеры
Write-Host "`n[1/6] Проверка контейнеров..." -ForegroundColor Yellow
$containers = docker compose ps --format "table {{.Name}}\t{{.Status}}" | Select-Object -Skip 1
if ($containers -match "unhealthy") {
    Write-Host "❌ Есть unhealthy контейнеры" -ForegroundColor Red
    docker compose logs backend --tail=20
} else {
    Write-Host "✅ Все контейнеры в норме" -ForegroundColor Green
}

# 2. Health endpoint
Write-Host "`n[2/6] Health check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 5
    if ($health.status -eq "ok") {
        Write-Host "✅ Backend отвечает: $($health.service) v$($health.version)" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Backend не отвечает: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. БД подключение
Write-Host "`n[3/6] Подключение к БД..." -ForegroundColor Yellow
docker compose exec backend python -c "
import asyncio, sys
from sqlalchemy.ext.asyncio import create_async_engine
async def test():
    try:
        engine = create_async_engine('postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is')
        async with engine.connect() as conn:
            await conn.execute('SELECT 1')
            print('✅ DB OK')
            await engine.dispose()
            sys.exit(0)
    except Exception as e:
        print(f'❌ DB Error: {e}')
        sys.exit(1)
asyncio.run(test())
" 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "✅ БД доступна" -ForegroundColor Green }

# 4. Расчетное ядро
Write-Host "`n[4/6] Тест calculation_engine..." -ForegroundColor Yellow
docker compose exec backend python -c "
from app.services.calculation_engine import calculate_metric_value
tests = [(95,100,'DIRECT',0.95,'Высокий уровень'), (5,100,'INVERSE',0.95,'Высокий уровень'), (10,0,'DIRECT',0.0,'Невозможно измерить')]
for a,b,f,ex,el in tests:
    x,l = calculate_metric_value(a,b,f)
    assert x==ex and l==el, f'Failed: {a}/{b} {f}'
print('✅ Расчеты работают')
" 2>$null

# 5. Справочник метрик
Write-Host "`n[5/6] Справочник метрик..." -ForegroundColor Yellow
$metricCount = docker compose exec backend python -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, select
from app.models.metric_catalog import MetricCatalog
async def c():
    e = create_async_engine('postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is')
    async with e.connect() as conn:
        r = await conn.execute(select(MetricCatalog))
        print(len(r.fetchall()))
    await e.dispose()
asyncio.run(c())
" 2>$null
if ([int]$metricCount -ge 24) { Write-Host "✅ Метрик: $metricCount" -ForegroundColor Green } else { Write-Host "❌ Метрик мало: $metricCount" -ForegroundColor Red }

# 6. API контракты
Write-Host "`n[6/6] API контракты..." -ForegroundColor Yellow
$swagger = Invoke-RestMethod -Uri "http://localhost:8000/openapi.json" -ErrorAction SilentlyContinue
if ($swagger.paths) {
    $endpoints = ($swagger.paths.PSObject.Properties | Measure-Object).Count
    Write-Host "✅ Swagger: $endpoints эндпоинтов" -ForegroundColor Green
} else {
    Write-Host "❌ Swagger не доступен" -ForegroundColor Red
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "🎯 Диагностика завершена" -ForegroundColor Cyan