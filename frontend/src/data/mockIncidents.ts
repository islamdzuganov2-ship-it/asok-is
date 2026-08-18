/**
 * mockIncidents.ts — демо-набор технических сбоев для режима «Демо» (mock) вкладки
 * «Аналитика сбоев» (T-21). Соответствует сценарному сиду backend (seed_incidents.py):
 * 4 демо-ИС, все 5 первопричин, часть открыта. Аналитика вычисляется тем же способом,
 * что и на бэкенде (computeIncidentAnalytics), чтобы Демо и LLM выглядели одинаково.
 */
import type { IncidentAnalytics, TechIncidentDto, TriggeredRisk } from '../store/api/apiSlice';

const H = 3600_000;
const iso = (s: string) => new Date(s).toISOString();
const plus = (s: string, hours: number) => new Date(new Date(s).getTime() + hours * H).toISOString();

interface Seed {
    system: string; category: string; severity: string; title: string;
    occurred: string; mttr: number | null; rootCause: string; release?: string;
    // T-36: разбор сбоя — причина допущения, виновное направление, меры по неповторению.
    admission?: string; unit?: string; prevent?: string;
}

const SEEDS: Seed[] = [
    { system: 'АБС Core', category: 'INFRASTRUCTURE', severity: 'critical', title: 'Отказ контроллера СХД — недоступность ядра АБС', occurred: '2025-11-15T03:00:00Z', mttr: 6, rootCause: 'Выход из строя контроллера СХД; задержка автопереключения на резерв', admission: 'Не отработало автопереключение на резервный контроллер — сценарий отказоустойчивости не покрыт регламентным тестом', unit: 'Эксплуатация СХД / ЦОД', prevent: 'Ввести ежеквартальный тест failover СХД; заменить партию контроллеров' },
    { system: 'АБС Core', category: 'POWER', severity: 'high', title: 'Просадка питания в основном ЦОД, переход на ИБП', occurred: '2025-11-15T03:00:00Z', mttr: 1.5, rootCause: 'Кратковременный сбой электроснабжения; ИБП отработал с деградацией', admission: 'ИБП не проходил плановое нагрузочное тестирование под полной нагрузкой', unit: 'Инженерная инфраструктура ЦОД', prevent: 'Регламентный тест ИБП под нагрузкой; расширить ёмкость батарей' },
    { system: 'АБС Core', category: 'NETWORK', severity: 'medium', title: 'Потеря связности с процессинговым узлом', occurred: '2026-03-04T12:00:00Z', mttr: 2, rootCause: 'Обрыв основного канала; маршрутизация ушла на резервный с ростом задержек', admission: 'Резервный канал не мониторился по задержкам — деградация замечена поздно', unit: 'Сетевая инфраструктура', prevent: 'Мониторинг latency резервного канала; SLA на автопереключение' },
    { system: 'CRM ОПК', category: 'RELEASE', severity: 'high', title: 'Регрессия расчёта скидок после релиза 4.2', occurred: '2026-02-10T09:00:00Z', mttr: 20, rootCause: 'Некорректная миграция правил ценообразования; откат и хотфикс', release: 'CRM 4.2.0', admission: 'Миграция правил ценообразования выпущена без полного приёмочного цикла', unit: 'Разработка CRM', prevent: 'Обязательный регресс ценообразования перед релизом; фиче-флаги' },
    { system: 'CRM ОПК', category: 'RELEASE', severity: 'medium', title: 'Падение фонового обмена после релиза 4.3', occurred: '2026-04-18T14:00:00Z', mttr: 8, rootCause: 'Изменён контракт интеграции без версии; сломался коннектор', release: 'CRM 4.3.1', admission: 'Контракт интеграции изменён без версионирования и уведомления смежников', unit: 'Интеграционная команда CRM', prevent: 'Версионирование контрактов; контрактные тесты в CI' },
    { system: 'CRM ОПК', category: 'PERFORMANCE', severity: 'high', title: 'Деградация времени отклика в пиковые часы', occurred: '2026-05-20T11:00:00Z', mttr: null, rootCause: 'Неоптимальные запросы к БД и нехватка пула соединений при росте нагрузки', admission: 'Нагрузочное тестирование пиковых окон не проводилось', unit: 'Эксплуатация CRM', prevent: 'Нагрузочные прогоны пиков; тюнинг пула соединений и топ-запросов' },
    { system: 'HR Portal', category: 'NETWORK', severity: 'low', title: 'Кратковременная недоступность портала (DNS)', occurred: '2026-01-22T16:00:00Z', mttr: 0.5, rootCause: 'Ошибка в записи DNS при плановой смене провайдера', admission: 'Смена провайдера выполнена без предпроверки DNS-записей', unit: 'Сетевая инфраструктура', prevent: 'Чек-лист смены провайдера; предпроверка и валидация DNS' },
    { system: 'HR Portal', category: 'INFRASTRUCTURE', severity: 'medium', title: 'Переполнение диска сервиса вложений', occurred: '2026-04-02T08:00:00Z', mttr: 3, rootCause: 'Не настроена ротация файлов вложений; диск заполнен', admission: 'Отсутствовал мониторинг заполнения диска и ротация', unit: 'Эксплуатация HR-систем', prevent: 'Алерты по заполнению диска; автоматическая ротация вложений' },
    { system: 'Скоринг-ML (СИИ)', category: 'PERFORMANCE', severity: 'high', title: 'Рост задержки инференса модели скоринга', occurred: '2026-05-06T13:00:00Z', mttr: null, rootCause: 'Увеличение признакового пространства без масштабирования узлов', admission: 'Рост признакового пространства без пересмотра ёмкости узлов инференса', unit: 'ML-инженерия (СИИ)', prevent: 'Планирование ёмкости под рост признаков; автоскейл инференса' },
];

export const MOCK_INCIDENTS: TechIncidentDto[] = SEEDS.map((s, i) => ({
    id: `demo-inc-${i + 1}`,
    systemName: s.system,
    category: s.category,
    severity: s.severity,
    title: s.title,
    rootCause: s.rootCause,
    admissionCause: s.admission,
    responsibleUnit: s.unit,
    preventiveMeasures: s.prevent,
    releaseRef: s.release,
    occurredAt: iso(s.occurred),
    resolvedAt: s.mttr === null ? null : plus(s.occurred, s.mttr),
    source: 'manual',
    createdBy: 'seed',
}));

export const INCIDENT_CATEGORIES = ['RELEASE', 'INFRASTRUCTURE', 'PERFORMANCE', 'NETWORK', 'POWER'] as const;

/** Локальная агрегация аналитики (зеркало backend service.analytics) — для Демо-режима. */
export function computeIncidentAnalytics(rows: TechIncidentDto[], system?: string): IncidentAnalytics {
    const items = system ? rows.filter((r) => r.systemName === system) : rows;
    const total = items.length;
    const mttrOf = (r: TechIncidentDto): number | null =>
        r.resolvedAt ? Math.round(((new Date(r.resolvedAt).getTime() - new Date(r.occurredAt).getTime()) / H) * 10) / 10 : null;
    const closed = items.filter((r) => r.resolvedAt);
    const allMttr = closed.map(mttrOf).filter((m): m is number => m !== null);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

    const byCategory = INCIDENT_CATEGORIES.map((cat) => {
        const inCat = items.filter((r) => r.category === cat);
        const mttrs = inCat.filter((r) => r.resolvedAt).map(mttrOf).filter((m): m is number => m !== null);
        return {
            category: cat,
            count: inCat.length,
            share: total ? Math.round((inCat.length / total) * 1000) / 10 : 0,
            openCount: inCat.filter((r) => !r.resolvedAt).length,
            avgMttrHours: avg(mttrs),
        };
    }).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

    const bySys = new Map<string, TechIncidentDto[]>();
    items.forEach((r) => bySys.set(r.systemName, [...(bySys.get(r.systemName) || []), r]));
    const topSystems = [...bySys.entries()]
        .map(([name, rs]) => ({ systemName: name, count: rs.length, openCount: rs.filter((r) => !r.resolvedAt).length }))
        .sort((a, b) => b.count - a.count).slice(0, 10);

    const releaseCount = items.filter((r) => r.category === 'RELEASE').length;
    return {
        total,
        openCount: items.filter((r) => !r.resolvedAt).length,
        resolvedCount: closed.length,
        avgMttrHours: avg(allMttr),
        releaseInducedShare: total ? Math.round((releaseCount / total) * 1000) / 10 : 0,
        byCategory,
        topSystems,
    };
}

/**
 * Риск-триггеры (T-16) для демо-режима — зеркало backend `incidents/models.py`
 * (CATEGORY_TO_CHARACTERISTIC/CATEGORY_LABELS) и `risk/router.py:triggered_risks` +
 * `risk/service.py:triggering_characteristics`. Раньше RiskTriggersWidget/RiskRadarPage
 * всегда ходили в реальную БД, игнорируя переключатель Демо/LLM (как и остальная аналитика
 * сбоев чинилась отдельно) — этот фоллбэк даёт то же поведение, что и остальной Демо-режим.
 */
const CATEGORY_TO_CHARACTERISTIC: Record<string, string> = {
    RELEASE: 'Сопровождаемость',
    INFRASTRUCTURE: 'Надёжность',
    PERFORMANCE: 'Производительность',
    NETWORK: 'Надёжность',
    POWER: 'Надёжность',
    OTHER: 'Надёжность',
};
const CATEGORY_LABELS: Record<string, string> = {
    RELEASE: 'релиз',
    INFRASTRUCTURE: 'инфраструктура',
    PERFORMANCE: 'производительность',
    NETWORK: 'сеть',
    POWER: 'электроснабжение',
    OTHER: 'другое',
};

/**
 * Тот же реальный сид, что backend/app/scripts/seed_risk_base.py — не выдуманные записи:
 * иначе демо-триггеры «находили» бы риски, которых нет в реальной базе, и разошлись бы с
 * live-режимом на той же странице (проект прямо требует не выдавать выдуманное за реальное,
 * см. правило про источник у рыночных бенчмарков в риск-экономике).
 */
const MOCK_RISK_BASE: Omit<TriggeredRisk, 'triggered_by'>[] = [
    { id: 'R-TEST-001', code: 'R-TEST-001', title: 'Низкая автоматизация регрессионного тестирования', category: 'тестируемость', characteristic: 'Тестируемость', severity: 'high', likelihood: 'high', consequence: 'Рост числа необнаруженных дефектов, удлинение релизного цикла.', mitigation: 'Выделить ресурс QA-автоматизации, приоритизировать критические сценарии, включить контроль покрытия в релизный гейт.' },
    { id: 'R-REL-001', code: 'R-REL-001', title: 'Просадка по надёжности и сопровождаемости', category: 'надёжность', characteristic: 'Надежность', severity: 'critical', likelihood: 'medium', consequence: 'Нарушение SLA, репутационные и финансовые потери.', mitigation: 'Заморозить рискованные релизы, запустить программу стабилизации, усилить мониторинг.' },
    { id: 'R-DATA-001', code: 'R-DATA-001', title: 'Недостаточный контроль качества данных', category: 'данные', characteristic: 'Тестируемость', severity: 'high', likelihood: 'medium', consequence: 'Дефекты данных доходят до продуктива, недостоверная отчётность.', mitigation: 'Приоритизировать покрытие критических витрин, включить контроль качества данных в релизный гейт.' },
    { id: 'R-SEC-001', code: 'R-SEC-001', title: 'Неполная реализация ролевой модели (RBAC)', category: 'безопасность', characteristic: 'Безопасность', severity: 'high', likelihood: 'low', consequence: 'Риск несанкционированного доступа, замечания регулятора.', mitigation: 'Провести ревизию ролей, внедрить принцип минимальных привилегий, регулярный аудит доступов.' },
];

const normChar = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();

export function computeTriggeredRisks(incidents: TechIncidentDto[], system?: string): TriggeredRisk[] {
    const items = system ? incidents.filter((r) => r.systemName === system) : incidents;
    const catCount = new Map<string, number>();
    items.forEach((r) => catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1));

    const charTriggers = new Map<string, [string, number][]>();
    [...catCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([cat, cnt]) => {
        const char = CATEGORY_TO_CHARACTERISTIC[cat];
        if (!char) return;
        const list = charTriggers.get(char) ?? [];
        list.push([CATEGORY_LABELS[cat] ?? cat, cnt]);
        charTriggers.set(char, list);
    });
    if (!charTriggers.size) return [];

    const normReasons = new Map<string, string>();
    charTriggers.forEach((cats, char) => {
        normReasons.set(normChar(char), 'техсбои: ' + cats.map(([lbl, cnt]) => `${lbl} (${cnt})`).join(', '));
    });

    return MOCK_RISK_BASE
        .filter((r) => normReasons.has(normChar(r.characteristic ?? '')))
        .slice(0, 20)
        .map((r) => ({ ...r, triggered_by: normReasons.get(normChar(r.characteristic ?? '')) ?? 'связанный риск' }));
}
