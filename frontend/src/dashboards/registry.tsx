/**
 * registry.tsx — штатные дашборды: право, заголовок и ДЕФОЛТНАЯ раскладка карточек.
 *
 * Дефолт повторяет исходную вёрстку каждой страницы — пока пользователь ничего не настраивал,
 * дашборд выглядит ровно как до конструктора. Сам каталог карточек — в catalog.ts.
 */
import { CARD_REGISTRY } from './catalog';
import { GRID_COLS, type CardDef, type DashboardDef, type DashboardKey } from './types';

export { CARD_REGISTRY };

const BY_ID = new Map(CARD_REGISTRY.map((c) => [c.id, c]));

export const cardById = (id: string): CardDef | undefined => BY_ID.get(id);

/** Раскладка «столбиком во всю ширину» — большинство штатных дашбордов выглядели именно так. */
function stack(ids: string[]): { i: string; x: number; y: number; w: number; h: number }[] {
  let y = 0;
  return ids.map((i) => {
    const def = BY_ID.get(i)!;
    const row = { i, x: 0, y, w: GRID_COLS, h: def.h };
    y += def.h;
    return row;
  });
}

/** Раскладка с явными координатами — там, где карточки стояли в два столбца. */
function at(rows: Array<[string, number, number, number, number]>) {
  return rows.map(([i, x, y, w, h]) => ({ i, x, y, w, h }));
}

export const DASHBOARDS: Record<DashboardKey, DashboardDef> = {
  exec: {
    key: 'exec', label: 'Управленческий дашборд', perm: 'view.dashboard.cto',
    // Порядок и ширины повторяют исходную страницу: индекс → AI-резюме → AI-меры → топ-3 →
    // (теплокарта 8 | техдолг 4) → сотрудники → реестр.
    defaultLayout: at([
      ['exec.index', 0, 0, 12, 7],
      ['exec.aiSummary', 0, 7, 12, 5],
      ['exec.measuresAi', 0, 12, 12, 11],
      ['exec.topSystems', 0, 23, 12, 11],
      ['exec.heatmap', 0, 34, 8, 17],
      ['exec.techDebt', 8, 34, 4, 17],
      ['exec.employees', 0, 51, 12, 11],
      ['exec.registry', 0, 62, 12, 13],
    ]),
  },
  manager: {
    key: 'manager', label: 'Основное', perm: 'view.dashboard.manager',
    defaultLayout: stack(['manager.profile', 'manager.metrics', 'manager.measureDev', 'manager.measures', 'manager.judgments']),
  },
  analytics: {
    key: 'analytics', label: 'Аналитический дашборд', perm: 'view.dashboard.analytics',
    defaultLayout: at([
      ['analytics.kpi', 0, 0, 12, 5],
      ['analytics.levels', 0, 5, 5, 12],
      ['analytics.problemSystems', 5, 5, 7, 12],
      ['analytics.heatmap', 0, 17, 12, 15],
    ]),
  },
  dynamics: {
    key: 'dynamics', label: 'Динамика качества', perm: 'view.dashboard.dynamics',
    defaultLayout: stack(['dynamics.system', 'dynamics.chars', 'dynamics.subs']),
  },
  incidents: {
    key: 'incidents', label: 'Аналитика сбоев', perm: 'view.dashboard.incidents',
    defaultLayout: at([
      ['incidents.sourceNote', 0, 0, 12, 5],
      ['incidents.kpi', 0, 5, 12, 5],
      ['incidents.ttr', 0, 10, 12, 5],
      ['incidents.donut', 0, 15, 5, 12],
      ['incidents.categoryTable', 5, 15, 7, 12],
      ['incidents.registry', 0, 27, 12, 15],
    ]),
  },
  taskplan: {
    key: 'taskplan', label: 'План задач', perm: 'view.dashboard.taskplan',
    defaultLayout: stack(['taskplan.employees', 'taskplan.gantt', 'taskplan.bubbles']),
  },
  risk: {
    key: 'risk', label: 'Основное — риск', perm: 'view.dashboard.risk',
    // До конструктора здесь уже был выбор состава (BL-008): по умолчанию включались все, кроме
    // «Нестабильных ИС» — сохраняем ровно это.
    defaultLayout: at([
      ['risk.kpi', 0, 0, 12, 5],
      ['risk.triggers', 0, 5, 6, 11],
      ['risk.economicImpact', 6, 5, 6, 11],
      ['risk.byCategory', 0, 16, 12, 11],
    ]),
  },
  radar: {
    key: 'radar', label: 'Риск-радар', perm: 'view.dashboard.risk_radar',
    defaultLayout: stack(['radar.note', 'radar.triggers']),
  },
  econ: {
    key: 'econ', label: 'Риск-экономика', perm: 'view.risk_economics',
    // Порядок вкладки «Дашборд стоимости»: KPI → решения/ALE по ИС → теплокарта → топ рисков →
    // портфельный итог → цепочка риск-мера-эффект → кривая эффекта.
    defaultLayout: at([
      ['econ.kpi', 0, 0, 12, 5],
      ['econ.nonconformity', 0, 5, 6, 9],
      ['econ.aleBySystem', 6, 5, 6, 9],
      ['econ.heatmap', 0, 14, 12, 13],
      ['econ.topRisks', 0, 27, 12, 12],
      ['econ.portfolio', 0, 39, 12, 6],
      ['econ.riskMeasureEffect', 0, 45, 12, 12],
      ['econ.quarterlyEffect', 0, 57, 12, 11],
    ]),
  },
  mytasks: {
    key: 'mytasks', label: 'Мои задачи', perm: 'view.my_tasks',
    defaultLayout: stack(['mytasks.kpi', 'mytasks.table']),
  },
  my: {
    key: 'my', label: 'Мой дашборд', perm: 'view.my_dashboard',
    // Личный дашборд специально пуст: его смысл — собрать состав самому.
    defaultLayout: [],
  },
};

/** Подпись группы в каталоге — «откуда карточка». */
export const sourceLabel = (key: DashboardKey): string => DASHBOARDS[key].label;
