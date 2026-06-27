/**
 * roles.ts — единый источник человеко-читаемых подписей ролей (ТЗ v12).
 * Внутренние коды ролей НЕ меняем (стабильность токенов/БД), показываем подписи.
 * Легаси-коды верхнего уровня (CTO/CEO/CIO/EXECUTIVE) приравнены к «Топ-менеджмент».
 */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Топ-менеджмент',
  CTO: 'Топ-менеджмент',
  CEO: 'Топ-менеджмент',
  CIO: 'Топ-менеджмент',
  EXECUTIVE: 'Топ-менеджмент',
  QUALITY_MANAGER: 'Менеджер по качеству',
  TEST_ANALYST: 'Аналитик',
  GUEST: 'Гость',
};

export const roleLabel = (role?: string | null): string =>
  (role && ROLE_LABELS[role]) || role || 'Гость';
