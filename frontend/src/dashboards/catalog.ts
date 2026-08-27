/**
 * catalog.ts — ЕДИНЫЙ каталог карточек всей системы (ТЗ v22, БТ-500).
 *
 * Это то место, ради которого затевался конструктор: раньше состав дашборда был зашит в его
 * компонент, и «взять карточку сбоев на дашборд менеджера» означало правку кода. Теперь любой
 * дашборд — это список id из одного каталога, а пользователь собирает свой набор сам.
 *
 * Правила:
 *  • id — `<источник>.<имя>`, стабильный: он лежит в сохранённых prefs пользователей.
 *    Переименование id = потеря карточки у всех, кто её поставил (она молча исчезнет
 *    при sanitize в useDashboardLayout).
 *  • perm — право дашборда-источника. RBAC остаётся верхней границей персонализации.
 *
 * Дефолтные раскладки штатных дашбордов лежат рядом, в registry.tsx.
 */
import { lazy, type FC } from 'react';
import { RISK_CARDS } from './cards/riskCards';
import type { CardDef } from './types';

/**
 * Карточка каталога грузится лениво, своим чанком на модуль-источник.
 *
 * Иначе открытие ЛЮБОГО дашборда тянуло бы весь каталог разом: каталог по построению ссылается
 * на все карточки системы, а бандлер видит в этом один общий граф (проверено сборкой — общий
 * чанк вырастал до ~440 КБ gzip). Теперь дашборд подтягивает только те модули, чьи карточки на
 * нём реально стоят; Suspense вокруг ячейки живёт в GridDashboard.
 *
 * Карточки «Владельца риска» (RISK_CARDS) остаются статическими: они самодостаточны и лежат в
 * одном небольшом модуле, дробить его нечего.
 */
const lazyCard = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(async () => ({ default: (await loader())[name] as FC }));

/** Права управленческого дашборда: он открыт и CTO, и CEO. */
const EXEC_PERM = ['view.dashboard.cto', 'view.dashboard.ceo'];

export const CARD_REGISTRY: CardDef[] = [
  // ─── Управленческий (CEO/CTO) ───
  { id: 'exec.index', title: 'Общий индекс качества', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 12, h: 7, minW: 4, minH: 5, hint: 'Портфельный балл ИТ-ландшафта, спидометр, меры на одобрение' , Component: lazyCard(() => import('./cards/execCards'), 'ExecIndexCard') },
  { id: 'exec.aiSummary', title: 'AI-резюме по ландшафту', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 12, h: 5, minW: 4, minH: 3, hint: 'Текст встроенной модели (режим LLM)' , Component: lazyCard(() => import('./cards/execCards'), 'ExecAiSummaryCard') },
  { id: 'exec.measuresAi', title: 'AI-аналитика по мерам', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 12, h: 11, minW: 4, minH: 5, hint: 'Предложения модели по характеристикам и переходы в реестр' , Component: lazyCard(() => import('./cards/execCards'), 'ExecMeasuresAiCard') },
  { id: 'exec.topSystems', title: 'Топ проблемных ИС', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 12, h: 11, minW: 4, minH: 7, hint: 'Три худшие системы по взвешенному баллу ГОСТ 25010' , Component: lazyCard(() => import('./cards/execCards'), 'ExecTopSystemsCard') },
  { id: 'exec.heatmap', title: 'Тепловая карта характеристик', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 8, h: 17, minW: 4, minH: 8, hint: 'ИС × характеристики, режимы «балл» и «деньги»' , Component: lazyCard(() => import('./cards/execHeatmapCard'), 'ExecHeatmapCard') },
  { id: 'exec.techDebt', title: 'Технический долг', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 4, h: 17, minW: 3, minH: 8, hint: 'Burndown и счётчики по мерам' , Component: lazyCard(() => import('./cards/execCards'), 'ExecTechDebtCard') },
  { id: 'exec.employees', title: 'Эффективность сотрудников', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 12, h: 11, minW: 4, minH: 6, hint: 'Исполнение мер по ответственным' , Component: lazyCard(() => import('./cards/execCards'), 'ExecEmployeesCard') },
  { id: 'exec.registry', title: 'Реестр мер качества', source: 'exec', perm: EXEC_PERM, scope: 'exec', w: 12, h: 13, minW: 4, minH: 6, hint: 'Полный список мер с фильтрами' , Component: lazyCard(() => import('./cards/execCards'), 'ExecRegistryCard') },

  // ─── Основное (менеджер по качеству) ───
  { id: 'manager.profile', title: 'Профиль качества по характеристикам', source: 'manager', perm: 'view.dashboard.manager', scope: 'manager', w: 12, h: 11, minW: 4, minH: 7, hint: 'Донат-селектор: клик выбирает характеристику для остальных карточек' , Component: lazyCard(() => import('./cards/managerCards'), 'ManagerProfileCard') },
  { id: 'manager.metrics', title: 'Метрики характеристики', source: 'manager', perm: 'view.dashboard.manager', scope: 'manager', w: 12, h: 11, minW: 4, minH: 6, hint: 'Спидометр и таблица подхарактеристик выбранной характеристики' , Component: lazyCard(() => import('./cards/managerCards'), 'ManagerMetricsCard') },
  { id: 'manager.measureDev', title: 'Выработка мер', source: 'manager', perm: 'view.dashboard.manager', scope: 'manager', w: 12, h: 11, minW: 4, minH: 6, hint: 'Зоны систематических проблем по выбранной характеристике' , Component: lazyCard(() => import('./cards/managerCards'), 'ManagerMeasureDevCard') },
  { id: 'manager.measures', title: 'Меры и намерения', source: 'manager', perm: 'view.dashboard.manager', scope: 'manager', w: 12, h: 10, minW: 4, minH: 5, hint: 'Меры по выбранной характеристике или подхарактеристике' , Component: lazyCard(() => import('./cards/managerCards'), 'ManagerMeasuresCard') },
  { id: 'manager.judgments', title: 'Профессиональные суждения', source: 'manager', perm: 'view.dashboard.manager', scope: 'manager', w: 12, h: 10, minW: 4, minH: 5, hint: 'Заполненные суждения по выбранному срезу' , Component: lazyCard(() => import('./cards/managerCards'), 'ManagerJudgmentsCard') },

  // ─── Аналитический дашборд ───
  { id: 'analytics.kpi', title: 'Ключевые показатели ландшафта', source: 'analytics', perm: 'view.dashboard.analytics', scope: 'analytics', w: 12, h: 5, minW: 4, minH: 4, hint: 'Глобальный балл, ИС, метрики, низкие метрики, меры' , Component: lazyCard(() => import('./cards/analyticsCards'), 'AnalyticsKpiCard') },
  { id: 'analytics.levels', title: 'Распределение по уровням качества', source: 'analytics', perm: 'view.dashboard.analytics', scope: 'analytics', w: 5, h: 12, minW: 3, minH: 7, hint: 'Круговая диаграмма уровней ГОСТ 25010' , Component: lazyCard(() => import('./cards/analyticsCards'), 'AnalyticsLevelsCard') },
  { id: 'analytics.problemSystems', title: 'Проблемные ИС', source: 'analytics', perm: 'view.dashboard.analytics', scope: 'analytics', w: 7, h: 12, minW: 4, minH: 7, hint: 'Наибольшее число низких метрик' , Component: lazyCard(() => import('./cards/analyticsCards'), 'AnalyticsProblemSystemsCard') },
  { id: 'analytics.heatmap', title: 'Тепловая карта: характеристики ИС', source: 'analytics', perm: 'view.dashboard.analytics', scope: 'analytics', w: 12, h: 15, minW: 5, minH: 8, hint: 'Детальная карта с выбором системы' , Component: lazyCard(() => import('./cards/analyticsCards'), 'AnalyticsHeatmapCard') },

  // ─── Динамика качества ───
  { id: 'dynamics.system', title: 'Качество ИС по кварталам', source: 'dynamics', perm: 'view.dashboard.dynamics', scope: 'dynamics', w: 12, h: 11, minW: 4, minH: 6, hint: 'Интегральный тренд, аномалии, линия «сегодня»' , Component: lazyCard(() => import('./cards/dynamicsCards'), 'DynamicsSystemCard') },
  { id: 'dynamics.chars', title: 'Качество по характеристикам во времени', source: 'dynamics', perm: 'view.dashboard.dynamics', scope: 'dynamics', w: 12, h: 13, minW: 4, minH: 7, hint: 'Топ-2 по колебаниям с учётом веса ГОСТ 25010' , Component: lazyCard(() => import('./cards/dynamicsCards'), 'DynamicsCharsCard') },
  { id: 'dynamics.subs', title: 'Качество по подхарактеристикам', source: 'dynamics', perm: 'view.dashboard.dynamics', scope: 'dynamics', w: 12, h: 13, minW: 4, minH: 6, hint: 'Плитки-спарклайны с трендом' , Component: lazyCard(() => import('./cards/dynamicsCards'), 'DynamicsSubsCard') },

  // ─── Аналитика сбоев ───
  { id: 'incidents.kpi', title: 'Ключевые показатели сбоев', source: 'incidents', perm: 'view.dashboard.incidents', scope: 'incidents', w: 12, h: 5, minW: 4, minH: 4, hint: 'Всего, открыто, MTTR, доля релизных' , Component: lazyCard(() => import('./cards/incidentsCards'), 'IncidentsKpiCard') },
  { id: 'incidents.ttr', title: 'Тайминги устранения', source: 'incidents', perm: 'view.dashboard.incidents', scope: 'incidents', w: 12, h: 5, minW: 4, minH: 4, hint: 'Реакция, устранение, цель, лаг первопричины' , Component: lazyCard(() => import('./cards/incidentsCards'), 'IncidentsTtrCard') },
  { id: 'incidents.donut', title: 'Распределение по первопричинам', source: 'incidents', perm: 'view.dashboard.incidents', scope: 'incidents', w: 5, h: 12, minW: 3, minH: 7, hint: 'Донат по категориям сбоев' , Component: lazyCard(() => import('./cards/incidentsCards'), 'IncidentsDonutCard') },
  { id: 'incidents.categoryTable', title: 'Первопричины: частота и MTTR', source: 'incidents', perm: 'view.dashboard.incidents', scope: 'incidents', w: 7, h: 12, minW: 4, minH: 7, hint: 'Таблица категорий и топ нестабильных ИС' , Component: lazyCard(() => import('./cards/incidentsCards'), 'IncidentsCategoryTableCard') },
  { id: 'incidents.registry', title: 'Реестр технических сбоев', source: 'incidents', perm: 'view.dashboard.incidents', scope: 'incidents', w: 12, h: 15, minW: 5, minH: 7, hint: 'Полный список с фильтром по первопричине' , Component: lazyCard(() => import('./cards/incidentsCards'), 'IncidentsRegistryCard') },
  { id: 'incidents.sourceNote', title: 'Источник данных о сбоях', source: 'incidents', perm: 'view.dashboard.incidents', scope: 'incidents', w: 12, h: 5, minW: 4, minH: 3, hint: 'Откуда поступают сбои (ITSM, Excel/CSV)' , Component: lazyCard(() => import('./cards/incidentsCards'), 'IncidentsSourceNoteCard') },

  // ─── План задач ───
  { id: 'taskplan.employees', title: 'Эффективность сотрудников (план задач)', source: 'taskplan', perm: 'view.dashboard.taskplan', scope: 'taskplan', w: 12, h: 11, minW: 4, minH: 6, hint: 'По выборке текущих фильтров плана задач' , Component: lazyCard(() => import('./cards/taskPlanCards'), 'TaskPlanEmployeesCard') },
  { id: 'taskplan.gantt', title: 'Временная диаграмма (Ганта)', source: 'taskplan', perm: 'view.dashboard.taskplan', scope: 'taskplan', w: 12, h: 15, minW: 5, minH: 7, hint: 'Сроки и статусы задач по времени' , Component: lazyCard(() => import('./cards/taskPlanCards'), 'TaskPlanGanttCard') },
  { id: 'taskplan.bubbles', title: 'Пузырьковая карта задач', source: 'taskplan', perm: 'view.dashboard.taskplan', scope: 'taskplan', w: 12, h: 15, minW: 5, minH: 7, hint: 'Ответственные × сроки, зоны просрочки' , Component: lazyCard(() => import('./cards/taskPlanCards'), 'TaskPlanBubblesCard') },

  // ─── Владелец риска ───
  ...RISK_CARDS,

  // ─── Риск-радар ───
  { id: 'radar.note', title: 'Зачем нужен риск-радар', source: 'radar', perm: 'view.dashboard.risk_radar', scope: 'none', w: 12, h: 7, minW: 4, minH: 4, hint: 'Как отбираются сработавшие риски' , Component: lazyCard(() => import('./cards/radarCards'), 'RadarNoteCard') },
  { id: 'radar.triggers', title: 'Сработавшие риск-триггеры', source: 'radar', perm: 'view.dashboard.risk_radar', scope: 'none', w: 12, h: 15, minW: 4, minH: 6, hint: 'Риски с признаками скорой реализации' , Component: lazyCard(() => import('./cards/radarCards'), 'RadarTriggersCard') },

  // ─── Мои задачи ───
  { id: 'mytasks.kpi', title: 'Мои поручения — показатели', source: 'mytasks', perm: 'view.my_tasks', scope: 'mytasks', w: 12, h: 5, minW: 4, minH: 4, hint: 'Всего, выполнено, просрочено, личная эффективность' , Component: lazyCard(() => import('./cards/myTasksCards'), 'MyTasksKpiCard') },
  { id: 'mytasks.table', title: 'Мои поручения — список', source: 'mytasks', perm: 'view.my_tasks', scope: 'mytasks', w: 12, h: 15, minW: 4, minH: 6, hint: 'Поручения с карточкой задачи по клику' , Component: lazyCard(() => import('./cards/myTasksCards'), 'MyTasksTableCard') },

  // ─── Риск-экономика ───
  { id: 'econ.kpi', title: 'Ключевые показатели контура', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 5, minW: 4, minH: 4, hint: 'Портфельный ALE, замкнутость, деградация, блокирующие', Component: lazyCard(() => import('./cards/econCards'), 'EconKpiCard') },
  { id: 'econ.portfolio', title: 'Портфельный итог по мерам', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 6, minW: 4, minH: 4, hint: 'Под риском, покрыто, остаточный, вложения, эффект', Component: lazyCard(() => import('./cards/econCards'), 'EconPortfolioSummaryCard') },
  { id: 'econ.nonconformity', title: 'Решения по несоответствиям', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 6, h: 9, minW: 3, minH: 5, hint: 'Счётчики решений по несоответствиям' , Component: lazyCard(() => import('./cards/econCards'), 'EconNonconformityCard') },
  { id: 'econ.aleBySystem', title: 'ALE по системам', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 6, h: 9, minW: 3, minH: 5, hint: 'Ожидаемые годовые потери по ИС' , Component: lazyCard(() => import('./cards/econCards'), 'EconAleBySystemCard') },
  { id: 'econ.heatmap', title: 'Тепловая карта риска (ALE)', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 13, minW: 5, minH: 7, hint: 'ИС × подхарактеристика в деньгах' , Component: lazyCard(() => import('./cards/econCards'), 'EconHeatmapCard') },
  { id: 'econ.topRisks', title: 'Топ рисков по стоимости', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 12, minW: 4, minH: 6, hint: 'Самые дорогие рисковые события' , Component: lazyCard(() => import('./cards/econCards'), 'EconTopRisksCard') },
  { id: 'econ.riskMeasureEffect', title: 'Риск → мера → эффект', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 12, minW: 4, minH: 6, hint: 'Связка события, мер и снимаемого ALE' , Component: lazyCard(() => import('./cards/econCards'), 'EconRiskMeasureEffectCard') },
  { id: 'econ.quarterlyEffect', title: 'Когда придут деньги', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 11, minW: 4, minH: 6, hint: 'Портфельный эффект по кварталам' , Component: lazyCard(() => import('./cards/econCards'), 'EconQuarterlyEffectCard') },
  { id: 'econ.managers', title: 'Эффективность руководителей', source: 'econ', perm: 'view.risk_economics', scope: 'econ', w: 12, h: 13, minW: 4, minH: 6, hint: 'Рейтинг по снятому ALE и исполнению мер' , Component: lazyCard(() => import('./cards/econManagersCard'), 'EconManagersCard') },
];

