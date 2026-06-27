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
      usePolling: false,
    },
    // Относительный /api проксируется на бэкенд → один источник (same-origin),
    // поэтому приложение работает одинаково и на localhost, и по публичной ссылке,
    // без отдельной настройки CORS.
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
})
