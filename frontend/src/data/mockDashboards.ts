/**
 * mockDashboards.ts — ТИПЫ ролевых дашбордов.
 *
 * Демо-значения (EXECUTIVE_MOCK / MANAGER_MOCK / MANAGER_MOCK_SYSTEMS) удалены —
 * вытеснены генератором data/mockScaleData.ts (см. архив в Obsidian:
 * Архитектура/Архив/mockDashboards_удалённые_значения). Здесь остались только типы,
 * используемые mockScaleData, ExecutiveDashboard, ManagerDashboard, ActionInsightModal.
 */

export interface ExecSystemInsight {
  id: string;
  name: string;
  score: number;                 // RAG-процент качества ИС
  criticality: 'MISSION CRITICAL' | 'BUSINESS CRITICAL' | 'BUSINESS OPERATIONAL';
  aiSummary: string;             // AI-резюме проблемы
  recommendation: string;        // одна рекомендация к действию
  owner: string;                 // «кто виноват» — владелец/ответственный
  escalateTo: string;            // «с кого спрашивать» — эскалация
  weakCharacteristic: string;    // наиболее просевшая характеристика
  actions: string[];             // рекомендуемые действия
}

export interface HeatCell {
  score: number;                 // 0..100, <0 = не измерено
}

export interface ExecutiveDashboardData {
  globalIndex: number;
  systems: ExecSystemInsight[];
  heatmap: {
    characteristics: string[];
    rows: { system: string; cells: HeatCell[] }[];
  };
  techDebt: { resolvedPct: number; period: string; note: string };
}

export interface ManagerMetric {
  id: string;
  name: string;
  score: number;      // расчётный %
  formula: string;    // как считается (для прозрачности)
}

export interface ManagerCharacteristic {
  key: string;
  title: string;
  score: number;
  metrics: ManagerMetric[];
}

export interface ManagerSystem {
  id: string;
  name: string;
  characteristics: ManagerCharacteristic[];
}
