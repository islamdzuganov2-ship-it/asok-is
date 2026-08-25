import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Цель прокси для /api: в docker — backend:8000, локально (без docker) — localhost:8000.
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    // Разрешённые хосты: ваш домен asokis.ai (+ поддомены), локалка и резервные туннели.
    // Ведущая точка матчит и сам домен, и его поддомены (asok.asokis.ai и т.п.).
    allowedHosts: ['localhost', '127.0.0.1', '.asokis.ai', '.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    watch: {
      // На Docker Desktop for Windows чейнджи bind-mount не всегда доходят до chokidar через
      // нативные fs-события — HMR тихо перестаёт видеть правки (сервер отдаёт старый
      // трансформированный модуль, хотя файл на диске уже другой). Опция включается только по
      // явному флагу окружения — поведение по умолчанию (Linux-хосты, где нативные события
      // работают) не меняется.
      usePolling: process.env.VITE_WATCH_POLLING === 'true',
    },
    // Относительный /api проксируется на бэкенд → один источник (same-origin),
    // поэтому приложение работает одинаково и на localhost, и по публичной ссылке,
    // без отдельной настройки CORS.
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        // Крупные локальные LLM (12–14B на CPU) считают заключение минутами: конвейер делает
        // 3 прохода модели. Явно поднимаем таймауты прокси, иначе запрос обрывается на середине
        // генерации. NB: публичные туннели (Cloudflare/ngrok) режут запрос на ~100 с независимо
        // от этой настройки — для крупных моделей используйте localhost или GPU (docs/LLM_SETUP.md).
        timeout: 15 * 60 * 1000,
        proxyTimeout: 15 * 60 * 1000,
      },
    },
  },
})
