/**
 * roles.ts — единый источник человеко-читаемых подписей ролей (ТЗ v12).
 * Внутренние коды ролей НЕ меняем (стабильность токенов/БД), показываем подписи.
 * Легаси-коды верхнего уровня (CTO/CEO/CIO/EXECUTIVE) приравнены к «Топ-менеджмент».
 */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Супер-администратор',
  ADMIN: 'Администратор',
  CTO: 'CTO',
  CEO: 'CEO',
  CIO: 'Топ-менеджмент',
  EXECUTIVE: 'Топ-менеджмент',
  QUALITY_MANAGER: 'Менеджер по качеству',
  TEST_ANALYST: 'Аналитик',
  RISK_MANAGER: 'Владелец риска',
  AUDITOR: 'Аудитор',
  GUEST: 'Гость',
};

export const roleLabel = (role?: string | null): string =>
  (role && ROLE_LABELS[role]) || role || 'Гость';
