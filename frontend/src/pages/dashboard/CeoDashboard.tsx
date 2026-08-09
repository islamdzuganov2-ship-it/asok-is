/**
 * CeoDashboard.tsx (BL-008) — основной дашборд роли CEO.
 * Пока стартует как общий управленческий дашборд; конкретный состав виджетов CEO будет
 * описан и наполнен отдельно (в т.ч. через персональную настройку виджетов, Фаза 4).
 */
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';

const CeoDashboard: React.FC = () => <ExecutiveDashboard />;

export default CeoDashboard;
