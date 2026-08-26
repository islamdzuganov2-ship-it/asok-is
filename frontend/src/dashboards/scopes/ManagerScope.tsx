/**
 * ManagerScope.tsx — общее состояние карточек дашборда «Основное» (менеджер по качеству).
 *
 * Зачем скоуп. До конструктора эти блоки были одним компонентом на 500 строк: каскад
 * «ИС → характеристика → подхарактеристика» жил в его useState, и карточки читали его напрямую.
 * Как только карточку можно перенести на «Мой дашборд» или на дашборд CEO, состояние обязано
 * ехать вместе с ней — иначе «Метрики характеристики» окажутся без характеристики.
 *
 * Провайдер поднимает ровно то, что было в ManagerDashboard: выбор ИС, загрузку реальных оценок
 * в LLM-режиме, каскад выбора и обе модалки (суждение и решение по мере). Модалки рендерит сам
 * провайдер — иначе на «Моём дашборде» кнопка «Суждение» вела бы в никуда.
 *
 * Логика раскрытия каскада (ТЗ v15, T-27…T-30) сохранена дословно: карточка метрик появляется
 * только по выбранной характеристике, меры — только когда они есть.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Select, Space, Typography, Spin, Alert } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { useSelector, shallowEqual } from 'react-redux';
import type { RootState } from '../../store';
import type { ManagerMetric, ManagerSystem } from '../../data/mockDashboards';
import { MANAGER_SCALE_SYSTEMS as MANAGER_MOCK_SYSTEMS } from '../../data/mockScaleData';
import { ragToken } from '../../theme/ragPalette';
import { useCharacteristicWeights } from '../../hooks/useCharacteristicWeights';
import { ProfessionalJudgmentModal, type JudgmentTarget } from '../../components/ProfessionalJudgmentModal';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';

const { Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

/** Нормализация названий характеристик/подхарактеристик (ё/е, регистр, пробелы) — как в теплокарте. */
const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

interface LiveSub { name: string; score: number }
interface LiveChar { title: string; abbr: string; score: number; subs: LiveSub[] }
interface LiveSystemDetail { name: string; chars: LiveChar[] }

function mapLiveSystems(details: LiveSystemDetail[]): ManagerSystem[] {
  return details.map((s, i) => ({
    id: `live-${i}-${s.name}`,
    name: s.name,
    characteristics: s.chars.map((c) => ({
      key: c.abbr || c.title,
      title: c.title,
      score: c.score,
      metrics: c.subs.map((sub, j): ManagerMetric => ({
        id: `${i}-${c.title}-${j}`, name: sub.name, score: sub.score, formula: '',
      })),
    })),
  }));
}

interface ManagerScopeValue {
  isLive: boolean;
  liveLoading: boolean;
  liveError: string | null;
  activeSystems: ManagerSystem[];
  system?: ManagerSystem;
  systemId: string;
  setSystemId: (id: string) => void;
  charKey?: string;
  subName?: string;
  selectChar: (key: string) => void;
  hideChar: () => void;
  setSubName: (name: string | undefined) => void;
  characteristic?: ManagerSystem['characteristics'][number];
  /** Интегральный балл ИС — взвешенное по весам ГОСТ 25010 среднее измеримых характеристик. */
  integral: number;
  measuresList: Proposal[];
  hasCharMeasures: boolean;
  showMetrics: boolean;
  showMeasures: boolean;
  openJudgment: (t: JudgmentTarget) => void;
  openMeasure: (p: Proposal) => void;
}

const Ctx = createContext<ManagerScopeValue | null>(null);

/** Хук карточки. Бросает осмысленно, а не падает на `null.system`: карточка без провайдера —
 *  это ошибка сборки реестра, и увидеть её надо сразу. */
export function useManagerScope(): ManagerScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка дашборда «Основное» отрисована вне ManagerScope');
  return v;
}

export const ManagerScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';

  const [liveSystems, setLiveSystems] = useState<ManagerSystem[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [systemId, setSystemId] = useState<string>(MANAGER_MOCK_SYSTEMS[0].id);
  // По умолчанию характеристика НЕ выбрана — каскад раскрывается по выбору (T-28/T-29).
  const [charKey, setCharKey] = useState<string | undefined>(undefined);
  const [subName, setSubName] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<JudgmentTarget | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<Proposal | null>(null);

  useEffect(() => {
    if (!isLive) { setLiveError(null); return; }
    let alive = true;
    setLiveLoading(true);
    setLiveError(null);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/assessments/dashboard`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { systemDetails?: LiveSystemDetail[] }) => {
        if (!alive) return;
        const mapped = mapLiveSystems(d.systemDetails ?? []);
        setLiveSystems(mapped);
        if (mapped.length) setSystemId(mapped[0].id);
      })
      .catch((e) => { if (alive) setLiveError(e.message); })
      .finally(() => { if (alive) setLiveLoading(false); });
    return () => { alive = false; };
  }, [isLive]);

  const activeSystems = isLive ? liveSystems : MANAGER_MOCK_SYSTEMS;
  const system = useMemo(
    () => activeSystems.find((s) => s.id === systemId) ?? activeSystems[0],
    [activeSystems, systemId],
  );

  // При смене ИС каскад начинается заново.
  useEffect(() => { setCharKey(undefined); setSubName(undefined); }, [systemId, system?.id]);

  const visibleProposals = useSelector(selectVisibleProposals, shallowEqual);
  const myProposals = useMemo(
    () => (system ? visibleProposals.filter((p) => p.systemName === system.name) : []),
    [visibleProposals, system?.name],
  );

  const characteristic = charKey ? system?.characteristics.find((c) => c.key === charKey) : undefined;
  const { weights: charWeights } = useCharacteristicWeights();

  const charMeasures = useMemo(
    () => (characteristic ? myProposals.filter((p) => norm(p.characteristic) === norm(characteristic.title)) : []),
    [myProposals, characteristic?.title],
  );
  const subMeasures = useMemo(
    () => (subName ? charMeasures.filter((p) => norm(p.metricName) === norm(subName)) : []),
    [charMeasures, subName],
  );
  const hasCharMeasures = charMeasures.length > 0;
  const measuresList = subName && subMeasures.length ? subMeasures : charMeasures;

  const integral = useMemo(() => {
    const meas = system?.characteristics.filter((c) => c.score >= 0) ?? [];
    if (!meas.length) return -1;
    const w = meas.reduce((a, c) => a + (charWeights[c.title] ?? 0), 0);
    return w > 0
      ? Math.round(meas.reduce((a, c) => a + c.score * (charWeights[c.title] ?? 0), 0) / w)
      : Math.round(meas.reduce((a, c) => a + c.score, 0) / meas.length);
  }, [system?.id, charWeights]);

  const value: ManagerScopeValue = {
    isLive, liveLoading, liveError,
    activeSystems, system, systemId, setSystemId,
    charKey, subName,
    selectChar: (key: string) => { setCharKey(key); setSubName(undefined); },
    hideChar: () => { setCharKey(undefined); setSubName(undefined); },
    setSubName,
    characteristic,
    integral,
    measuresList,
    hasCharMeasures,
    showMetrics: !!characteristic,
    showMeasures: !!characteristic && (hasCharMeasures || subMeasures.length > 0),
    openJudgment: setTarget,
    openMeasure: setSelectedMeasure,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <ProfessionalJudgmentModal open={!!target} target={target} onClose={() => setTarget(null)} />
      <MeasureDecisionModal
        open={!!selectedMeasure}
        proposal={selectedMeasure}
        onClose={() => setSelectedMeasure(null)}
      />
    </Ctx.Provider>
  );
};

/** Панель над сеткой: выбор ИС и статус загрузки. Живёт вне сетки, потому что относится ко ВСЕМ
 *  карточкам скоупа сразу — на «Моём дашборде» она появится автоматически, стоит положить туда
 *  хотя бы одну менеджерскую карточку. */
export const ManagerScopeToolbar: React.FC = () => {
  const { activeSystems, systemId, setSystemId, isLive, liveLoading, liveError, system } = useManagerScope();
  return (
    <Space wrap size={12}>
      <Text type="secondary"><DatabaseOutlined /> Система:</Text>
      <Select
        value={system?.id ?? systemId}
        onChange={setSystemId}
        style={{ width: 280, maxWidth: '100%' }}
        showSearch
        optionFilterProp="label"
        options={activeSystems.map((s) => ({ value: s.id, label: s.name }))}
        notFoundContent={isLive ? 'Реальных оценок пока нет' : undefined}
      />
      {isLive && liveLoading && <Spin size="small" />}
      {isLive && liveError && (
        <Alert type="warning" showIcon banner message={`Не удалось загрузить реальные данные: ${liveError}`} />
      )}
    </Space>
  );
};
