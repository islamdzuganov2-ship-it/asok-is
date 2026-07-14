/**
 * mockIncidents.ts — демо-набор технических сбоев для режима «Демо» (mock) вкладки
 * «Аналитика сбоев» (T-21). Соответствует сценарному сиду backend (seed_incidents.py):
 * 4 демо-ИС, все 5 первопричин, часть открыта. Аналитика вычисляется тем же способом,
 * что и на бэкенде (computeIncidentAnalytics), чтобы Демо и LLM выглядели одинаково.
 */
import type { IncidentAnalytics, TechIncidentDto } from '../store/api/apiSlice';

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
