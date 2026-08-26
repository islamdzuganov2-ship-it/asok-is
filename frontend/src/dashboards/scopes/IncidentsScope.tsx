/**
 * IncidentsScope.tsx — общее состояние карточек «Аналитики технических сбоев».
 *
 * Фильтры (ИС — T-39, кварталы — T-40) влияют сразу на все карточки: KPI, диаграммы, реестр.
 * Поэтому они живут в скоупе и выведены в панель над сеткой, а не внутрь одной из карточек:
 * иначе, убрав «свою» карточку с дашборда, пользователь потерял бы управление всеми остальными.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Col, Modal, Row, Select, Space, Tag, Typography } from 'antd';
import { DatabaseOutlined, CalendarOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSelector, shallowEqual } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { RootState } from '../../store';
import { useGetIncidentsQuery, type TechIncidentDto } from '../../store/api/apiSlice';
import { selectVisibleProposals } from '../../store/slices/governanceSlice';
import { MOCK_INCIDENTS, computeIncidentAnalytics } from '../../data/mockIncidents';
import { RAG, ACCENT, solidTagStyle } from '../../theme/ragPalette';
import { fmtMoney } from '../../utils/money';

const { Title, Text, Paragraph } = Typography;

/** Цвет первопричины в ГРАФИКЕ (сектора/столбцы) — ≥3:1 с белым (WCAG 1.4.11). */
export const CATEGORY_COLOR: Record<string, string> = {
  RELEASE: ACCENT.violet.color, INFRASTRUCTURE: ACCENT.slate.color, PERFORMANCE: '#B88E32',
  NETWORK: RAG.good.color, POWER: RAG.bad.color, OTHER: RAG.muted.color,
};
/** Тот же оттенок для ПЛАШКИ с белым текстом — углублён до ≥4.5:1 (T-57). */
export const CATEGORY_TAG_COLOR: Record<string, string> = {
  RELEASE: ACCENT.violet.color, INFRASTRUCTURE: ACCENT.slate.strong, PERFORMANCE: '#947125',
  NETWORK: '#4C8165', POWER: '#C0553F', OTHER: '#667797',
};

export const CATEGORY_LABEL: Record<string, string> = {
  RELEASE: 'Привнесено релизом',
  INFRASTRUCTURE: 'Инфраструктура',
  PERFORMANCE: 'Производительность',
  NETWORK: 'Сеть',
  POWER: 'Электроснабжение',
  OTHER: 'Другое',
};
export const SEVERITY_LABEL: Record<string, string> = { critical: 'критический', high: 'высокий', medium: 'средний', low: 'низкий' };
export const SEVERITY_COLOR: Record<string, string> = { critical: 'red', high: 'volcano', medium: 'gold', low: 'blue' };
export const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export const fmtDate = (s?: string | null) => (s ? dayjs(s).format('DD.MM.YYYY HH:mm') : '—');
export const mttrHours = (r: TechIncidentDto): number | null =>
  r.resolvedAt ? Math.round(((new Date(r.resolvedAt).getTime() - new Date(r.occurredAt).getTime()) / 3600000) * 10) / 10 : null;
/** Пустое значение показываем прочерком: «не измеряли» — не то же самое, что «ноль». */
export const fmtMin = (v?: number | null): string => (v === null || v === undefined ? '—' : v.toFixed(1));

const quarterKeyOf = (iso: string) => {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1}-${d.getUTCFullYear()}`;
};
const quarterOrder = (k: string) => { const [q, y] = k.slice(1).split('-'); return Number(y) * 10 + Number(q); };

type Analytics = ReturnType<typeof computeIncidentAnalytics>;

interface IncidentsScopeValue {
  isLive: boolean;
  loading: boolean;
  canManage: boolean;
  analytics: Analytics;
  filteredIncidents: TechIncidentDto[];
  registryRows: TechIncidentDto[];
  categoryFilter?: string;
  setCategoryFilter: (c?: string) => void;
  openIncident: (r: TechIncidentDto) => void;
  measureTitleById: (id?: string | null) => string | null;
}

const Ctx = createContext<IncidentsScopeValue | null>(null);

export function useIncidentsScope(): IncidentsScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка аналитики сбоев отрисована вне IncidentsScope');
  return v;
}

/** Фильтры вынесены во внешний контекст: панель над сеткой и карточки читают одно состояние. */
interface FiltersValue {
  systemFilter?: string;
  setSystemFilter: (s?: string) => void;
  quarterFilter: string[];
  setQuarterFilter: (q: string[]) => void;
  systemOptions: { value: string; label: string }[];
  availableQuarters: string[];
  isLive: boolean;
  refetch: () => void;
}
const FiltersCtx = createContext<FiltersValue | null>(null);

export const IncidentsScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const isLive = dataMode === 'live';
  const canManage = ['QUALITY_MANAGER', 'ADMIN'].includes(role);

  const liveList = useGetIncidentsQuery(undefined, { skip: !isLive });
  const [searchParams, setSearchParams] = useSearchParams();

  const allIncidents = isLive ? (liveList.data ?? []) : MOCK_INCIDENTS;
  const loading = isLive && liveList.isFetching;

  const [systemFilter, setSystemFilter] = useState<string | undefined>(undefined);
  const [quarterFilter, setQuarterFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [selectedIncident, setSelectedIncident] = useState<TechIncidentDto | null>(null);

  // Переход с дашборда владельца риска (?system=/?category=) — параметры одноразовые.
  useEffect(() => {
    const sys = searchParams.get('system');
    const cat = searchParams.get('category');
    if (!sys && !cat) return;
    if (sys) setSystemFilter(sys);
    if (cat) setCategoryFilter(cat);
    setSearchParams((sp) => { sp.delete('system'); sp.delete('category'); return sp; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const systemOptions = useMemo(
    () => [...new Set(allIncidents.map((r) => r.systemName))].sort().map((s) => ({ value: s, label: s })),
    [allIncidents],
  );
  const availableQuarters = useMemo(
    () => [...new Set(allIncidents.map((r) => quarterKeyOf(r.occurredAt)))].sort((a, b) => quarterOrder(a) - quarterOrder(b)),
    [allIncidents],
  );

  const filteredIncidents = useMemo(
    () => allIncidents.filter((r) =>
      (!systemFilter || r.systemName === systemFilter)
      && (quarterFilter.length === 0 || quarterFilter.includes(quarterKeyOf(r.occurredAt)))),
    [allIncidents, systemFilter, quarterFilter],
  );
  const analytics = useMemo(() => computeIncidentAnalytics(filteredIncidents), [filteredIncidents]);
  const registryRows = useMemo(
    () => (categoryFilter ? filteredIncidents.filter((r) => r.category === categoryFilter) : filteredIncidents),
    [filteredIncidents, categoryFilter],
  );

  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const measureTitleById = (id?: string | null) => {
    if (!id) return null;
    const p = proposals.find((x) => x.id === id);
    return p ? `${p.riskTitle || p.metricName} · ${p.characteristic}` : id;
  };

  const value: IncidentsScopeValue = {
    isLive, loading, canManage, analytics, filteredIncidents, registryRows,
    categoryFilter, setCategoryFilter, openIncident: setSelectedIncident, measureTitleById,
  };
  const filters: FiltersValue = {
    systemFilter, setSystemFilter, quarterFilter, setQuarterFilter,
    systemOptions, availableQuarters, isLive, refetch: () => liveList.refetch(),
  };

  return (
    <FiltersCtx.Provider value={filters}>
      <Ctx.Provider value={value}>
        {children}
        <Modal
          open={!!selectedIncident}
          title="Карточка технического сбоя"
          footer={null}
          onCancel={() => setSelectedIncident(null)}
          width={640}
        >
          {selectedIncident && (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap>
                <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[selectedIncident.category])}>
                  {CATEGORY_LABEL[selectedIncident.category] ?? selectedIncident.category}
                </Tag>
                <Tag color={SEVERITY_COLOR[selectedIncident.severity]}>
                  {SEVERITY_LABEL[selectedIncident.severity] ?? selectedIncident.severity}
                </Tag>
                {selectedIncident.resolvedAt ? <Tag color="green">восстановлен</Tag> : <Tag color="red">открыт</Tag>}
              </Space>
              <Title level={5} style={{ margin: 0 }}>{selectedIncident.title}</Title>
              <Row gutter={[12, 8]}>
                <Col span={12}><Text type="secondary">ИС: </Text><Text strong>{selectedIncident.systemName}</Text></Col>
                <Col span={12}><Text type="secondary">MTTR: </Text><Text strong>{(() => { const m = mttrHours(selectedIncident); return m === null ? '—' : `${m} ч`; })()}</Text></Col>
                <Col span={12}><Text type="secondary">Возник: </Text>{fmtDate(selectedIncident.occurredAt)}</Col>
                <Col span={12}><Text type="secondary">Восстановлен: </Text>{fmtDate(selectedIncident.resolvedAt)}</Col>
                <Col span={12}><Text type="secondary">Стоимость (C_ТС): </Text><Text strong>{fmtMoney(selectedIncident.costTotal)}</Text></Col>
                {selectedIncident.releaseRef && <Col span={24}><Text type="secondary">Релиз/версия: </Text>{selectedIncident.releaseRef}</Col>}
              </Row>
              {selectedIncident.category === 'OTHER' && selectedIncident.categoryCustom && (
                <div><Text type="secondary">Первопричина (уточнение): </Text><Text>{selectedIncident.categoryCustom}</Text></div>
              )}
              <div>
                <Text type="secondary">Корневая причина:</Text>
                <Paragraph style={{ marginBottom: 0 }}>{selectedIncident.rootCause || '—'}</Paragraph>
              </div>
              <div>
                <Text type="secondary">Причина допущения:</Text>
                <Paragraph style={{ marginBottom: 0 }}>{selectedIncident.admissionCause || '—'}</Paragraph>
              </div>
              <Row gutter={[12, 8]}>
                <Col span={12}><Text type="secondary">Виновное направление: </Text><Text>{selectedIncident.responsibleUnit || '—'}</Text></Col>
                <Col span={12}><Text type="secondary">Связанная мера: </Text><Text>{measureTitleById(selectedIncident.linkedMeasureId) || '—'}</Text></Col>
              </Row>
              <div>
                <Text type="secondary">Меры по неповторению:</Text>
                <Paragraph style={{ marginBottom: 0 }}>{selectedIncident.preventiveMeasures || '—'}</Paragraph>
              </div>
            </Space>
          )}
        </Modal>
      </Ctx.Provider>
    </FiltersCtx.Provider>
  );
};

export const IncidentsScopeToolbar: React.FC = () => {
  const f = useContext(FiltersCtx);
  if (!f) return null;
  return (
    <Space wrap size={12} style={{ width: '100%' }}>
      <Text type="secondary"><DatabaseOutlined /> Система:</Text>
      <Select
        allowClear showSearch optionFilterProp="label" style={{ width: 260, maxWidth: '100%' }}
        placeholder="Все системы" value={f.systemFilter} onChange={f.setSystemFilter} options={f.systemOptions}
      />
      <Text type="secondary"><CalendarOutlined /> Период (кварталы):</Text>
      <Select
        mode="multiple" allowClear style={{ width: 320, maxWidth: '100%' }} maxTagCount="responsive"
        placeholder="Все периоды"
        value={f.quarterFilter} onChange={f.setQuarterFilter}
        options={f.availableQuarters.map((q) => ({ value: q, label: q }))}
      />
      {(f.systemFilter || f.quarterFilter.length > 0) && (
        <Button size="small" type="link" onClick={() => { f.setSystemFilter(undefined); f.setQuarterFilter([]); }}>
          Сбросить фильтры
        </Button>
      )}
      {f.isLive && <Button size="small" icon={<ReloadOutlined />} onClick={f.refetch}>Обновить</Button>}
    </Space>
  );
};
