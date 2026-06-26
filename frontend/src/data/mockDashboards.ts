/**
 * mockDashboards.ts — демо-данные для ролевых дашбордов (по макетам ТЗ v9).
 * Используются как fallback, пока бэкенд-эндпоинты /dashboard/{role} не готовы.
 * Структура совместима с будущими ответами API.
 */

export interface ExecSystemInsight {
  id: string;
  name: string;
  score: number;                 // RAG-процент качества ИС
  criticality: 'MISSION CRITICAL' | 'BUSINESS CRITICAL' | 'BUSINESS OPERATIONAL';
  aiSummary: string;             // AI-резюме проблемы (R1.2)
  recommendation: string;        // одна рекомендация к действию (R1.2)
  owner: string;                 // «кто виноват» — владелец/ответственный (R1.5)
  escalateTo: string;            // «с кого спрашивать» — эскалация (R1.5)
  weakCharacteristic: string;    // наиболее просевшая характеристика
  actions: string[];             // рекомендуемые действия (R1.5)
}

export interface HeatCell {
  score: number;                 // 0..100, <0 = не измерено
}

export interface ExecutiveDashboardData {
  globalIndex: number;           // общий индекс ИТ-ландшафта (R1.1)
  systems: ExecSystemInsight[];  // топ-проблемные ИС (R1.2)
  heatmap: {
    characteristics: string[];   // столбцы
    rows: { system: string; cells: HeatCell[] }[];
  };
  techDebt: { resolvedPct: number; period: string; note: string }; // R1.4
}

export const EXECUTIVE_MOCK: ExecutiveDashboardData = {
  globalIndex: 68,
  systems: [
    {
      id: 'sys-radius',
      name: 'Systematica Radius',
      score: 33,
      criticality: 'MISSION CRITICAL',
      weakCharacteristic: 'Надёжность',
      aiSummary:
        'Качество ИС на критически низком уровне: просадка по надёжности и сопровождаемости. Растёт частота инцидентов в пиковые окна.',
      recommendation: 'Заморозить релизы и запустить программу стабилизации.',
      owner: 'Иванов И.И. (владелец ИС)',
      escalateTo: 'Директор по ИТ-эксплуатации',
      actions: [
        'Назначить владельца программы стабилизации в течение 3 дней',
        'Провести root-cause по топ-5 инцидентам надёжности',
        'Ввести регресс-тестирование критических сценариев',
      ],
    },
    {
      id: 'sys-crm-opk',
      name: 'CRM ОПК',
      score: 41,
      criticality: 'BUSINESS CRITICAL',
      weakCharacteristic: 'Сопровождаемость',
      aiSummary:
        'Качество ниже целевого: разрозненная архитектура, низкая тестируемость, технический долг растёт быстрее, чем устраняется.',
      recommendation: 'Утвердить план снижения техдолга на квартал.',
      owner: 'Петров П.П. (владелец ИС)',
      escalateTo: 'CTO',
      actions: [
        'Согласовать бюджет рефакторинга модуля интеграций',
        'Внедрить автоматизацию регрессионного тестирования',
        'Зафиксировать SLA по сопровождению',
      ],
    },
    {
      id: 'sys-ehd',
      name: 'Единое Хранилище Данных (ЕХД)',
      score: 46,
      criticality: 'BUSINESS CRITICAL',
      weakCharacteristic: 'Тестируемость',
      aiSummary:
        'Тестируемость на низком уровне (25%): не хватает ресурсов автоматизации тест-кейсов, риск необнаруженных дефектов в данных.',
      recommendation: 'Выделить ресурс на автоматизацию тест-кейсов.',
      owner: 'Сидоров С.С. (владелец ИС)',
      escalateTo: 'Менеджер по качеству → CTO',
      actions: [
        'Утвердить найм/перевод 1 QA-автоматизатора',
        'Приоритизировать покрытие критических витрин данных',
        'Включить контроль качества данных в релизный гейт',
      ],
    },
  ],
  heatmap: {
    characteristics: ['Функц.', 'Произв.', 'Надёжн.', 'Сопров.', 'Безоп.'],
    rows: [
      { system: 'ЕХД',                cells: [{ score: 30 }, { score: 35 }, { score: 55 }, { score: 72 }, { score: 80 }] },
      { system: 'Единое Хранилище',   cells: [{ score: 28 }, { score: 60 }, { score: 75 }, { score: 52 }, { score: 78 }] },
      { system: 'Systematica Radius', cells: [{ score: 25 }, { score: 33 }, { score: 30 }, { score: 70 }, { score: 82 }] },
      { system: 'CRM ОПК',            cells: [{ score: 40 }, { score: 45 }, { score: 58 }, { score: 35 }, { score: 76 }] },
      { system: 'СЭД',                cells: [{ score: 62 }, { score: 70 }, { score: 80 }, { score: 66 }, { score: 85 }] },
    ],
  },
  techDebt: {
    resolvedPct: 65,
    period: 'Q1',
    note: 'устранено задач по плану обеспечения качества',
  },
};

// --- Дашборд Менеджера по качеству ---

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

export const MANAGER_MOCK: ManagerSystem = {
  id: 'sys-ehd',
  name: 'Единое Хранилище Данных (ЕХД)',
  characteristics: [
    {
      key: 'testability',
      title: 'Тестируемость',
      score: 25,
      metrics: [
        { id: 'm1', name: 'Покрытие автотестами регресса', score: 16, formula: 'Sₓ = автоматизировано / всего тест-кейсов' },
        { id: 'm2', name: 'Доля воспроизводимых дефектов',  score: 25, formula: 'Sₓ = воспроизводимые / зарегистрированные' },
        { id: 'm3', name: 'Готовность тестовых данных',     score: 15, formula: 'Sₓ = готовые наборы / требуемые' },
        { id: 'm4', name: 'Стабильность тестовой среды',    score: 40, formula: 'Sₓ = 1 − простой среды / окно тестирования' },
      ],
    },
    {
      key: 'maintainability',
      title: 'Сопровождаемость',
      score: 48,
      metrics: [
        { id: 'm5', name: 'Модульность',          score: 52, formula: 'экспертно по архитектуре' },
        { id: 'm6', name: 'Анализируемость логов', score: 44, formula: 'Sₓ = структурир. логи / всего' },
      ],
    },
    {
      key: 'reliability',
      title: 'Надёжность',
      score: 55,
      metrics: [
        { id: 'm7', name: 'Доступность (uptime)',   score: 78, formula: 'Sₓ = uptime / план' },
        { id: 'm8', name: 'Зрелость (плотность дефектов)', score: 32, formula: 'Sₓ = 1 − дефекты / объём' },
      ],
    },
  ],
};
