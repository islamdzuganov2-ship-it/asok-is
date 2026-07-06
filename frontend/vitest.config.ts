/**
 * vitest.config.ts — юнит-тесты чистой логики фронтенда (без DOM):
 * аномалии динамики, интегральный ряд качества ИС, аудит правок мер.
 * Запуск: npm test (в контейнере: docker exec -w /app asok_frontend npm test).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
