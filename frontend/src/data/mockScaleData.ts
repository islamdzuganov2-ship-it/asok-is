/**
 * mockScaleData.ts — масштабный детерминированный датасет для проверки визуализации
 * «при больших масштабах»: 30 ИС × 8 характеристик × ВСЕ подхарактеристики ISO/IEC 25010.
 *
 * Значения генерируются ТОЛЬКО по формулам методики/ГОСТ:
 *   • DIRECT  : X = A / B
 *   • INVERSE : X = 1 − A / B
 * A и B подобраны под реалистичные диапазоны (объёмы тестов, инцидентов, требований…).
 * Генерация детерминирована (seeded PRNG) — значения стабильны между перезагрузками,
 * поэтому теплокарта, реестр мер и зелёные точки согласованы между собой.
 *
 * На выходе:
 *   EXECUTIVE_SCALE        — данные управленческого дашборда (индекс, топ-проблемные, heatmap, техдолг);
 *   MANAGER_SCALE_SYSTEMS  — 30 систем для дашборда менеджера по качеству;
 *   SCALE_PROPOSALS        — реестр мер качества по всем системам (всё повешено на руководителя).
 */
import { levelLabel } from '../theme/ragPalette';
import { QUALITY_MODEL, type Formula, type QualityCharacteristic, type QualitySub } from '../constants/qualityModel';
import type {
  ExecutiveDashboardData, ExecSystemInsight, ManagerSystem, ManagerMetric,
} from './mockDashboards';
import type { Proposal } from '../store/slices/governanceSlice';

// --- seeded PRNG ---
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngOf = (seed: string) => mulberry32(hashStr(seed));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- Модель качества ISO/IEC 25010 (единый источник: constants/qualityModel.ts) ---
type SubDef = QualitySub;
type CharDef = QualityCharacteristic;
const ISO25010: CharDef[] = QUALITY_MODEL;

// --- 30 информационных систем банка ---
const SYSTEM_NAMES = [
  'АБС «Ядро»', 'ДБО Розница', 'ДБО Корпоратив', 'CRM ОПК', 'Единое хранилище данных (ЕХД)',
  'Systematica Radius', 'СЭД', 'Процессинг карт', 'Антифрод-платформа', 'Кредитный конвейер',
  'Скоринг-движок', 'Витрина отчётности', 'КХД Аналитика', 'Мобильный банк', 'Интернет-эквайринг',
  'Платёжный шлюз', 'АБС Казначейство', 'Депозитарий', 'Биллинг услуг', 'KYC/AML-модуль',
  'Бюро кредитных историй', 'Шина интеграции (ESB)', 'Портал самообслуживания', 'Контакт-центр',
  'HR-платформа', 'Документооборот ВНД', 'Риск-менеджмент', 'Бухгалтерия ГК', 'Архив долговременный',
  'Мониторинг ИТ (NOC)',
];

const CRITICALITY: ExecSystemInsight['criticality'][] = ['MISSION CRITICAL', 'BUSINESS CRITICAL', 'BUSINESS OPERATIONAL'];

// Ролевой подход к данным: ответственный зависит от характеристики (кто реально чинит),
// адресат эскалации — от критичности ИС (кому докладывать: CIO/CTO/руководитель ИТ-блока).
const OWNER_BY_CHAR: Record<string, { fio: string; role: string }> = {
  'Функциональная пригодность': { fio: 'Петрова А.С.', role: 'Руководитель разработки' },
  'Производительность':         { fio: 'Сидоров К.М.', role: 'Руководитель эксплуатации' },
  'Совместимость':              { fio: 'Николаев Д.А.', role: 'Архитектор решений' },
  'Удобство использования':     { fio: 'Петрова А.С.', role: 'Руководитель разработки' },
  'Надёжность':                 { fio: 'Сидоров К.М.', role: 'Руководитель эксплуатации' },
  'Защищённость':               { fio: 'Смирнов В.П.', role: 'Руководитель ИБ' },
  'Сопровождаемость':           { fio: 'Козлова Е.В.', role: 'Руководитель тестирования' },
  'Переносимость':              { fio: 'Николаев Д.А.', role: 'Архитектор решений' },
};
const FALLBACK_OWNER = { fio: 'Иванов И.И.', role: 'Руководитель ИТ-блока' };
const ownerOf = (char: string) => OWNER_BY_CHAR[char] ?? FALLBACK_OWNER;
const ESCALATE_BY_CRIT: Record<ExecSystemInsight['criticality'], string> = {
  'MISSION CRITICAL': 'CIO',
  'BUSINESS CRITICAL': 'CTO',
  'BUSINESS OPERATIONAL': 'Руководитель ИТ-блока',
};

// Рекомендации/обоснования по характеристике (для AI-резюме и реестра мер).
const REC: Record<string, { rationale: string; action: string; risk: string; actions: string[] }> = {
  'Функциональная пригодность': {
    rationale: 'Покрытие требований и корректность ниже целевого уровня.',
    action: 'Закрыть разрывы функционального покрытия по критическим требованиям.',
    risk: 'Невыполнение бизнес-требований',
    actions: ['Приоритизировать непокрытые требования', 'Усилить приёмочное тестирование', 'Зафиксировать дефекты корректности в плане'],
  },
  'Производительность': {
    rationale: 'Время отклика и утилизация ресурсов вне целевых значений в пиковые окна.',
    action: 'Провести нагрузочное профилирование и оптимизацию узких мест.',
    risk: 'Деградация в пиковые окна',
    actions: ['Нагрузочное тестирование пиков', 'Оптимизировать топ-5 запросов/узлов', 'Ввести SLA по времени отклика'],
  },
  'Совместимость': {
    rationale: 'Часть интеграций нестабильна, есть конфликты сосуществования.',
    action: 'Стабилизировать интеграционные контракты и окружения.',
    risk: 'Сбои интеграций',
    actions: ['Ревизия интеграционных контрактов', 'Контрактное тестирование', 'Изоляция конфликтующих компонентов'],
  },
  'Удобство использования': {
    rationale: 'Изучаемость и защита от ошибок пользователя ниже нормы.',
    action: 'Доработать UX критических сценариев и валидацию форм.',
    risk: 'Ошибки пользователей',
    actions: ['UX-аудит ключевых сценариев', 'Усилить валидацию форм', 'Обновить руководство пользователя'],
  },
  'Надёжность': {
    rationale: 'Растёт частота инцидентов, восстановление дольше норматива.',
    action: 'Запустить программу стабилизации и сократить MTTR.',
    risk: 'Нарушение непрерывности',
    actions: ['Root-cause по топ-5 инцидентам', 'Сократить MTTR (runbook)', 'Заморозить рискованные релизы'],
  },
  'Защищённость': {
    rationale: 'Выявлены отклонения по контролю доступа и аудиту событий.',
    action: 'Устранить замечания ИБ и усилить контроль доступа.',
    risk: 'Несанкционированный доступ',
    actions: ['Ревизия ролевой модели', 'Включить аудит критических событий', 'Закрыть замечания пентеста'],
  },
  'Сопровождаемость': {
    rationale: 'Низкая тестируемость и модульность, техдолг растёт быстрее устранения.',
    action: 'Поднять автоматизацию тестирования и снизить техдолг.',
    risk: 'Рост технического долга',
    actions: ['Автоматизация регресса', 'Рефакторинг связности модулей', 'Зафиксировать SLA сопровождения'],
  },
  'Переносимость': {
    rationale: 'Установка релизов длительная, адаптируемость сред ограничена.',
    action: 'Стандартизировать установку и среды (IaC).',
    risk: 'Долгая установка релизов',
    actions: ['Автоматизировать установку (CI/CD)', 'Унифицировать среды (IaC)', 'Проверить заменяемость компонентов'],
  },
};

// --- Генерация ---
interface GenMetric { name: string; formula: Formula; a: number; b: number; x: number }
interface GenChar { def: CharDef; metrics: GenMetric[]; score: number }

// Пары (системаIdx-характеристикаIdx), где характеристика «Невозможно измерить»
// (нет базы B → X = -1). Даёт серые ячейки в теплокарте и меры под них.
const UNMEASURABLE = new Set(['3-7', '7-2', '9-4', '12-5', '18-1', '24-6']);
interface GenSystem {
  name: string; criticality: ExecSystemInsight['criticality'];
  chars: GenChar[]; score: number; weakest: GenChar;
}

function genMetric(seed: string, sub: SubDef, base: number): GenMetric {
  const r = rngOf(seed);
  const x = clamp(base + (r() - 0.5) * 0.5, 0.05, 0.99);
  const b = 20 + Math.floor(r() * 480); // объём 20..500
  const a = sub.formula === 'DIRECT' ? Math.round(b * x) : Math.round(b * (1 - x));
  const realX = sub.formula === 'DIRECT' ? a / b : 1 - a / b;
  return { name: sub.name, formula: sub.formula, a, b, x: clamp(realX, 0.01, 0.999) };
}

const SYSTEMS: GenSystem[] = SYSTEM_NAMES.map((name, idx) => {
  const base = 0.32 + rngOf(name)() * 0.58; // профиль здоровья системы 0.32..0.90
  const chars: GenChar[] = ISO25010.map((def, charIdx) => {
    const unmeasurable = UNMEASURABLE.has(`${idx}-${charIdx}`);
    const metrics: GenMetric[] = def.subs.map((sub) =>
      unmeasurable
        ? { name: sub.name, formula: sub.formula, a: 0, b: 0, x: -1 }   // нет базы B → невозможно измерить
        : genMetric(`${name}|${sub.name}`, sub, base));
    const measurable = metrics.filter((m) => m.x >= 0);
    const score = measurable.length ? measurable.reduce((s, m) => s + m.x, 0) / measurable.length : -1;
    return { def, metrics, score };
  });
  const measChars = chars.filter((c) => c.score >= 0);
  const sysScore = measChars.length ? measChars.reduce((s, c) => s + c.score, 0) / measChars.length : 0;
  // Наиболее просевшая — среди измеримых (чтобы не показывать «-100%» в резюме).
  const weakest = [...measChars].sort((a, b) => a.score - b.score)[0] ?? chars[0];
  return { name, criticality: CRITICALITY[idx % 3], chars, score: sysScore, weakest };
});

const pct = (x: number) => Math.round(x * 100);
const GLOBAL_INDEX = Math.round(SYSTEMS.reduce((s, sys) => s + sys.score, 0) / SYSTEMS.length * 100);

// Системы, отсортированные «худшие сверху» — для карточек и heatmap.
const SORTED = [...SYSTEMS].sort((a, b) => a.score - b.score);

const formulaStr = (m: GenMetric) =>
  m.formula === 'DIRECT' ? `Sₓ = A/B = ${m.a}/${m.b}` : `Sₓ = 1 − A/B = 1 − ${m.a}/${m.b}`;

// --- EXECUTIVE_SCALE ---
const execSystems: ExecSystemInsight[] = SORTED.map((sys) => {
  const rec = REC[sys.weakest.def.title];
  const own = ownerOf(sys.weakest.def.title);
  return {
    id: `sys-${hashStr(sys.name)}`,
    name: sys.name,
    score: pct(sys.score),
    criticality: sys.criticality,
    weakCharacteristic: sys.weakest.def.title,
    aiSummary: `Интегральная оценка качества — ${pct(sys.score)}% (${levelLabel(pct(sys.score)).toLowerCase()}). `
      + `Наиболее просевшая характеристика — ${sys.weakest.def.title} (${pct(sys.weakest.score)}%). ${rec.rationale}`,
    recommendation: rec.action,
    owner: `${own.role} (${own.fio})`,
    escalateTo: ESCALATE_BY_CRIT[sys.criticality],
    actions: rec.actions,
  };
});

export const EXECUTIVE_SCALE: ExecutiveDashboardData = {
  globalIndex: GLOBAL_INDEX,
  systems: execSystems,
  heatmap: {
    characteristics: ISO25010.map((c) => c.abbr),
    rows: SORTED.map((sys) => ({
      system: sys.name,
      cells: sys.chars.map((c) => ({ score: pct(c.score) })),
    })),
  },
  techDebt: {
    resolvedPct: 0, // заполняется ниже после генерации мер
    period: 'Q2-2026',
    note: 'мер устранено по плану обеспечения качества',
  },
};

// --- MANAGER_SCALE_SYSTEMS ---
export const MANAGER_SCALE_SYSTEMS: ManagerSystem[] = SORTED.map((sys) => ({
  id: `sys-${hashStr(sys.name)}`,
  name: sys.name,
  characteristics: sys.chars.map((c) => ({
    key: c.def.abbr,
    title: c.def.title,
    score: pct(c.score),
    metrics: c.metrics.map((m, i): ManagerMetric => ({
      id: `${hashStr(sys.name)}-${i}-${m.name}`,
      name: m.name,
      score: pct(m.x),
      formula: formulaStr(m),
    })),
  })),
}));

// --- SCALE_PROPOSALS: реестр мер качества (всё на руководителя) ---
const DUE_DATES = ['30.06.2026', '15.07.2026', '31.07.2026', '31.08.2026', '30.09.2026'];

function buildProposals(): Proposal[] {
  const items: Proposal[] = [];
  let i = 0;
  for (const sys of SORTED) {
    // самая просевшая подхарактеристика системы + (опц.) ещё одна < 0.40
    const subs = sys.chars
      .flatMap((c) => c.metrics.map((m) => ({ char: c.def.title, m })))
      .sort((a, b) => a.m.x - b.m.x);
    const targets = [subs[0]];
    if (subs[1] && subs[1].m.x < 0.4) targets.push(subs[1]);

    for (const t of targets) {
      const rec = REC[t.char];
      const own = ownerOf(t.char);
      const escalateTo = ESCALATE_BY_CRIT[sys.criticality];
      const unmeasurable = t.m.x < 0;
      const score = unmeasurable ? 0 : pct(t.m.x);
      const level = unmeasurable ? 'Невозможно измерить' : levelLabel(score);
      const metricInfo = unmeasurable
        ? `Метрика «${t.m.name}» — невозможно измерить (нет базы B).`
        : `Метрика «${t.m.name}» = ${score}% (${formulaStr(t.m)}).`;
      // распределение статусов: ~70% ожидают, ~20% одобрено, ~10% отклонено
      const bucket = i % 10;
      const status: Proposal['status'] =
        bucket < 7 ? 'PENDING_APPROVAL' : bucket < 9 ? 'APPROVED' : 'REJECTED';
      const approved = status === 'APPROVED';
      // Контроль выполнения: часть одобренных выполнена, часть сорвана (→ эскалация), часть в работе.
      const execDone = approved && i % 3 === 0;
      const execFailed = approved && i % 3 === 1;
      items.push({
        id: `scale-${hashStr(sys.name)}-${i}`,
        systemName: sys.name,
        characteristic: t.char,
        metricName: t.m.name,
        isDemo: true,
        calculatedScore: score,
        calculatedLevel: level,
        rationale: `${rec.rationale} ${metricInfo}`,
        createRisk: true,
        riskTitle: `${rec.risk}: ${t.char}`,
        owner: own.fio,
        ownerRole: own.role,
        dueDate: DUE_DATES[i % DUE_DATES.length],
        expectation: `Прошу одобрить меру: ${rec.action} Ответственный — ${own.role} (${own.fio}). `
          + `Критичность ИС: ${sys.criticality}; при срыве срока эскалация на уровень ${escalateTo}.`,
        createdBy: 'Менеджер по качеству',
        createdAt: new Date(2026, 5, 1 + (i % 25)).toISOString(),
        status,
        ...(status !== 'PENDING_APPROVAL'
          ? { decidedBy: escalateTo, decidedAt: new Date(2026, 5, 10).toISOString(),
              decisionComment: approved ? 'Согласовано, включить в план квартала.' : 'Отклонено: пересмотреть приоритет и срок.' }
          : {}),
        ...(execDone
          ? { execution: 'DONE' as const, executionComment: 'Выполнено: ресурс выделен, мера закрыта.',
              executedBy: 'Менеджер по качеству', executedAt: new Date(2026, 5, 18).toISOString(),
              suzLink: `SUZ-2026-${1000 + i}` }
          : execFailed
          ? { execution: 'NOT_DONE' as const, executionComment: 'Не выполнено: не выделен бюджет, перенос на следующий квартал.',
              executedBy: 'Менеджер по качеству', executedAt: new Date(2026, 5, 18).toISOString(),
              suzLink: `SUZ-2026-${1000 + i}`,
              // Срыв выполнения по критичной ИС МК эскалирует наверх; часть эскалаций уже решена.
              escalated: true,
              escalationReason: 'Мера не выполнена в срок: бюджет не выделен, ответственный перегружен. Требуется решение по приоритету.',
              ...(i % 6 === 1
                ? { escalationDecision: 'REQUEST_MEASURES' as const,
                    escalationDecisionComment: `Выделить бюджет из резерва блока, срок — следующий квартал. Контроль — ${escalateTo}.`,
                    escalationDecidedBy: escalateTo }
                : {}) }
          : {}),
      });
      i++;
    }
  }
  return items;
}

export const SCALE_PROPOSALS: Proposal[] = buildProposals();

// Полные названия характеристик в порядке колонок heatmap — для ТОЧНОГО сопоставления мер.
export const HEATMAP_CHARS_FULL: string[] = ISO25010.map((c) => c.title);

// --- ANALYTICS_SCALE: данные для аналитического дашборда (форма /assessments/dashboard) ---
function levelBucket(p: number): number {
  if (p < 0) return 0; if (p < 21) return 1; if (p < 41) return 2;
  if (p < 61) return 3; if (p < 81) return 4; return 5;
}
const lowCount = (sys: GenSystem) =>
  sys.chars.reduce((n, c) => n + c.metrics.filter((m) => pct(m.x) < 41).length, 0);

// ЕДИНЫЙ порядок систем для аналитики: по числу низких метрик ↓ (как в «Проблемных ИС»),
// затем по баллу. Один и тот же для теплокарты и списка проблемных ИС → сортировки совпадают.
const ANALYTICS_ORDER = [...SYSTEMS].sort((a, b) => (lowCount(b) - lowCount(a)) || (a.score - b.score));

const levelCounts: Record<string, number> = {};
let totalMetrics = 0;
for (const sys of SYSTEMS) {
  for (const c of sys.chars) {
    for (const m of c.metrics) {
      const lvl = levelLabel(pct(m.x));
      levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;
      totalMetrics++;
    }
  }
}
const heatmapData: [number, number, number][] = [];
ANALYTICS_ORDER.forEach((sys, y) => {
  sys.chars.forEach((c, x) => { heatmapData.push([x, y, levelBucket(pct(c.score))]); });
});
const problematicSystems = ANALYTICS_ORDER.map((sys) => ({
  id: `sys-${hashStr(sys.name)}`,
  name: sys.name,
  criticality: sys.criticality,
  lowMetricsCount: lowCount(sys),
})).slice(0, 10);

// Детали характеристик: средний балл характеристики + по каждой подхарактеристике (среднее
// по всем системам). Количество подхарактеристик одинаково для всех систем (ISO/IEC 25010).
export interface SubDetail { name: string; score: number }      // score: % или -1 (невозможно измерить)
export interface CharDetail { title: string; abbr: string; score: number; subs: SubDetail[] }
const CHAR_DETAILS: CharDetail[] = ISO25010.map((def, charIdx) => {
  const subs: SubDetail[] = def.subs.map((sub, subIdx) => {
    const vals = SYSTEMS.map((s) => s.chars[charIdx].metrics[subIdx].x).filter((x) => x >= 0);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : -1;
    return { name: sub.name, score: avg < 0 ? -1 : pct(avg) };
  });
  const meas = subs.filter((s) => s.score >= 0);
  const score = meas.length ? Math.round(meas.reduce((a, b) => a + b.score, 0) / meas.length) : -1;
  return { title: def.title, abbr: def.abbr, score, subs };
});

// Детали ПО КАЖДОЙ системе: характеристика (балл) + её подхарактеристики (балл).
// Порядок систем и характеристик совпадает с теплокартой (ANALYTICS_ORDER × ISO).
export interface SystemDetail { name: string; chars: CharDetail[] }
const SYSTEM_DETAILS: SystemDetail[] = ANALYTICS_ORDER.map((sys) => ({
  name: sys.name,
  chars: sys.chars.map((c) => ({
    title: c.def.title,
    abbr: c.def.abbr,
    score: c.score < 0 ? -1 : pct(c.score),
    subs: c.metrics.map((m) => ({ name: m.name, score: m.x < 0 ? -1 : pct(m.x) })),
  })),
}));

export const ANALYTICS_SCALE = {
  globalHealthScore: GLOBAL_INDEX / 100,
  levelCounts,
  heatmapData,
  xAxisLabels: ISO25010.map((c) => c.title),   // полные названия характеристик для шапки
  yAxisLabels: ANALYTICS_ORDER.map((s) => s.name),
  problematicSystems,
  totalMetrics,
  characteristics: CHAR_DETAILS,                // средние по характеристике (шапка)
  systemDetails: SYSTEM_DETAILS,                // по каждой системе: характеристики + подхарактеристики
};

// Техдолг = доля одобренных мер от общего числа (реальная связка с реестром).
const approved = SCALE_PROPOSALS.filter((p) => p.status === 'APPROVED').length;
EXECUTIVE_SCALE.techDebt.resolvedPct = SCALE_PROPOSALS.length
  ? Math.round((approved / SCALE_PROPOSALS.length) * 100)
  : 0;
EXECUTIVE_SCALE.techDebt.note = `мер одобрено: ${approved} из ${SCALE_PROPOSALS.length} (план обеспечения качества)`;

// --- DYNAMICS: качество в разрезе времени (по характеристикам и подхарактеристикам) ---
export const QUARTERS = ['Q1-2025', 'Q2-2025', 'Q3-2025', 'Q4-2025', 'Q1-2026', 'Q2-2026'];

// Ряд значений по кварталам: последний квартал = текущее значение, ранние — с дрейфом.
function makeSeries(seed: string, current: number): number[] {
  if (current < 0) return QUARTERS.map(() => -1);   // невозможно измерить — нет ряда
  const r = rngOf(seed);
  return QUARTERS.map((_, q) =>
    q === QUARTERS.length - 1
      ? current
      : Math.round(clamp((current + (r() - 0.5) * 30) / 100, 0.05, 0.99) * 100));
}

export interface DynSeries { key: string; name: string; char: string; series: number[] }
export interface SystemDynamics { name: string; system: DynSeries; chars: DynSeries[]; subs: DynSeries[] }

/** Порог аномалии: изменение к предыдущему кварталу на ≥ 12 п.п. — рост или просадка. */
export const ANOMALY_THRESHOLD = 12;

/** Индексы кварталов с аномальным изменением (|Δ| ≥ порога) относительно предыдущей оценки. */
export function detectAnomalies(series: number[], threshold = ANOMALY_THRESHOLD): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    if (series[i] >= 0 && series[i - 1] >= 0 && Math.abs(series[i] - series[i - 1]) >= threshold) out.push(i);
  }
  return out;
}

// Сценарные аномалии по характеристикам (система, характеристика, квартал, сдвиг в п.п.).
// У части задана причина — она «заполнена менеджером по качеству»; у остальных причины НЕТ,
// и МК получает уведомление о необходимости заполнить её (см. NotificationBell).
const CHAR_ANOMALIES: { sys: string; char: string; q: number; shift: number; reason?: string }[] = [
  { sys: 'АБС «Ядро»', char: 'Надёжность', q: 3, shift: -24,
    reason: 'Инцидент P1: деградация СУБД после релиза 2.14, выполнен откат. RCA закрыт, введён обязательный нагрузочный прогон перед релизом.' },
  { sys: 'АБС «Ядро»', char: 'Производительность', q: 4, shift: 18,
    reason: 'Плановая мера Q4-2025: оптимизация топ-5 запросов и кэширование справочников — время отклика в пиковые окна снижено на 40%.' },
  { sys: 'ДБО Розница', char: 'Защищённость', q: 2, shift: -20 },                 // причина не заполнена
  { sys: 'ДБО Розница', char: 'Надёжность', q: 4, shift: 15,
    reason: 'Программа стабилизации: MTTR сокращён с 4 ч до 40 мин (runbook + выделенные дежурные смены).' },
  { sys: 'Процессинг карт', char: 'Производительность', q: 3, shift: -18 },       // причина не заполнена
  { sys: 'CRM ОПК', char: 'Функциональная пригодность', q: 2, shift: -16,
    reason: 'Выпуск MVP-модуля без полного приёмочного цикла: выросла доля непокрытых требований. План доработок утверждён.' },
  { sys: 'Мобильный банк', char: 'Удобство использования', q: 4, shift: 16 },     // причина не заполнена
  { sys: 'Кредитный конвейер', char: 'Сопровождаемость', q: 3, shift: -15,
    reason: 'Слияние веток legacy-модуля повысило связность кода; рефакторинг запланирован на Q1-2026.' },
];

// Системные аномалии: сдвиг всех характеристик ИС в квартале (массовый инцидент / крупный релиз) —
// аномалия видна и на интегральном ряде «Качество информационной системы».
const SYSTEM_ANOMALIES: { sys: string; q: number; shift: number; reason?: string }[] = [
  { sys: 'СЭД', q: 3, shift: -14,
    reason: 'Мажорное обновление платформы: массовые регрессии по всем характеристикам; стабилизационный релиз вышел в Q1-2026.' },
  { sys: 'Антифрод-платформа', q: 2, shift: 13 },                                  // причина не заполнена
];

const shiftVal = (v: number, shift: number) =>
  v < 0 ? v : Math.round(clamp((v + shift) / 100, 0.02, 0.99) * 100);

export const DYNAMICS: Record<string, SystemDynamics> = {};
SYSTEMS.forEach((sys) => {
  const chars: DynSeries[] = sys.chars.map((c) => ({
    key: `char:${c.def.abbr}`, name: c.def.title, char: c.def.title,
    series: makeSeries(`${sys.name}|c|${c.def.title}`, c.score < 0 ? -1 : pct(c.score)),
  }));
  // сценарные сдвиги: по характеристике и по всей системе (кроме последнего квартала — он «текущий»)
  for (const a of CHAR_ANOMALIES.filter((x) => x.sys === sys.name)) {
    const cs = chars.find((c) => c.name === a.char);
    if (cs) cs.series[a.q] = shiftVal(cs.series[a.q], a.shift);
  }
  for (const a of SYSTEM_ANOMALIES.filter((x) => x.sys === sys.name)) {
    chars.forEach((c) => { c.series[a.q] = shiftVal(c.series[a.q], a.shift); });
  }
  // интегральный ряд системы = среднее измеримых характеристик в каждом квартале
  const sysSeries = QUARTERS.map((_, q) => {
    const vals = chars.map((c) => c.series[q]).filter((v) => v >= 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : -1;
  });
  DYNAMICS[sys.name] = {
    name: sys.name,
    system: { key: 'system', name: 'Качество информационной системы', char: 'Интегральный показатель', series: sysSeries },
    chars,
    subs: sys.chars.flatMap((c) => c.metrics.map((m) => ({
      key: `sub:${m.name}`, name: m.name, char: c.def.title,
      series: makeSeries(`${sys.name}|s|${m.name}`, m.x < 0 ? -1 : pct(m.x)),
    }))),
  };
});

// Предзаполненные причины аномалий (ключ = dynamicsSlice.reasonKey: `система|ключРяда|квартал`).
// Причина проливается и на интегральный ряд системы — сквозная согласованность уровней.
export const DYNAMICS_REASONS: Record<string, string> = {};
const ABBR_OF: Record<string, string> = Object.fromEntries(ISO25010.map((c) => [c.title, c.abbr]));
for (const a of CHAR_ANOMALIES) {
  if (!a.reason) continue;
  DYNAMICS_REASONS[`${a.sys}|char:${ABBR_OF[a.char]}|${QUARTERS[a.q]}`] = a.reason;
  const sysSer = DYNAMICS[a.sys]?.system.series ?? [];
  if (detectAnomalies(sysSer).includes(a.q)) DYNAMICS_REASONS[`${a.sys}|system|${QUARTERS[a.q]}`] = a.reason;
}
for (const a of SYSTEM_ANOMALIES) {
  if (!a.reason) continue;
  DYNAMICS_REASONS[`${a.sys}|system|${QUARTERS[a.q]}`] = a.reason;
  DYNAMICS[a.sys]?.chars.forEach((c) => {
    if (detectAnomalies(c.series).includes(a.q)) DYNAMICS_REASONS[`${a.sys}|${c.key}|${QUARTERS[a.q]}`] = a.reason;
  });
}
