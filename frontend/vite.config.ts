import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Цель прокси для /api: в docker — backend:8000, локально (без docker) — localhost:8000.
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

// ИБ-13 (SEC-06): заголовки безопасности для страниц фронта. Дублируют политику бэкенда
// (app/infrastructure/security_headers.py) — без них браузер получал их только на ответах API.
// 'unsafe-inline' в script-src — вынужденно для dev-сервера (преамбула React Refresh вставляется
// inline); стили antd (CSS-in-JS) — inline всегда. Прямые вызовы API с явным VITE_API_BASE_URL
// (по умолчанию http://localhost:8000) разрешены в connect-src; ws: — HMR.
const apiOrigin = (() => {
  try { return new URL(process.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').origin } catch { return '' }
})()
const securityHeaders: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws: wss: ${apiOrigin}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  preview: {
    headers: securityHeaders,
  },
  server: {
    port: 3000,
    host: true,
    headers: securityHeaders,
    // Разрешённые хосты: ваш домен asokis.ai (+ поддомены), локалка и резервные туннели.
    // Ведущая точка матчит и сам домен, и его поддомены (asok.asokis.ai и т.п.).
    allowedHosts: ['localhost', '127.0.0.1', '.asokis.ai', '.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    watch: {
      usePolling: false,
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
