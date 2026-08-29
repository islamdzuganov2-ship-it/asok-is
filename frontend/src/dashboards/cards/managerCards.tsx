/**
 * managerCards.tsx — карточки дашборда «Основное» (менеджер по качеству), вынутые из
 * ManagerDashboard в самостоятельные единицы каталога.
 *
 * Единственное содержательное отличие от исходной вёрстки: раньше карточка каскада просто НЕ
 * рендерилась, пока не выбрана характеристика (`{showMetrics && <Card/>}`). В сетке так нельзя —
 * ячейка уже занята местом, и исчезнувшая карточка оставила бы дыру. Поэтому вместо исчезновения
 * карточка показывает подсказку «выберите характеристику»: место сохраняется, смысл — тоже.
 */
import React, { useMemo } from 'react';
import { Button, Empty, List, Space, Table, Tag, Typography } from 'antd';
import {
  EditOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, EyeInvisibleOutlined,
} from '@ant-design/icons';
import type { ManagerMetric } from '../../data/mockDashboards';
import { RAG, ragToken, levelLabel, BRAND, solidTagStyle } from '../../theme/ragPalette';
import { GOLD, PREMIUM, TYPE, SPACE } from '../../theme/premium';
import { useChartTokens } from '../../theme/useThemeTokens';
import { numericColumn, sorterFor } from '../../theme/table';
import MeasureDevelopmentPanel from '../../components/MeasureDevelopmentPanel';
import FilledJudgmentsCard from '../../components/FilledJudgmentsCard';
import type { ProposalStatus } from '../../store/slices/governanceSlice';
import { useManagerScope } from '../scopes/ManagerScope';
import GridCard, { FillCard } from '../GridCard';
import AutoChart from '../AutoChart';

const { Text } = Typography;

const STATUS_META: Record<ProposalStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING_APPROVAL: { label: 'Ожидает одобрения', color: RAG.medium.strong, icon: <ClockCircleOutlined /> },
  APPROVED:         { label: 'Одобрено',          color: RAG.good.strong,   icon: <CheckCircleOutlined /> },
  REJECTED:         { label: 'Отклонено',         color: RAG.bad.strong,    icon: <CloseCircleOutlined /> },
};

const scoreLevel = (s: number) => (s < 0 ? 'Невозможно измерить' : levelLabel(s));
const scoreTok = ragToken;

/** Единая заглушка «нечего показать»: в сетке карточка не исчезает, а объясняет, чего ждёт. */
const Hint: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">{text}</Text>} />
  </div>
);

// ─────────────────── Профиль качества по характеристикам ───────────────────

export const ManagerProfileCard: React.FC = () => {
  const { system, charKey, selectChar, integral } = useManagerScope();
  const chart = useChartTokens();

  const pieOption = useMemo(() => {
    if (!system) return {};
    return {
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: any) => `${p.marker} ${p.name}<br/><b>${p.data.raw < 0 ? 'н/д' : `${p.data.raw}%`}</b>`,
      },
      title: {
        text: integral < 0 ? 'н/д' : `${integral}%`,
        subtext: 'интегральный балл',
        left: 'center', top: '42%',
        textStyle: { color: chart.ink, fontSize: TYPE.metricLg.fontSize, fontWeight: TYPE.metricLg.fontWeight },
        subtextStyle: { color: chart.inkSoft, fontSize: TYPE.micro.fontSize },
      },
      series: [{
        type: 'pie', radius: ['56%', '82%'], center: ['50%', '50%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: BRAND.surface, borderWidth: 3, borderRadius: 6 },
        label: { show: false }, labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(43,58,75,.22)' } },
        data: system.characteristics.map((c) => ({
          name: c.title,
          value: c.score < 0 ? 3 : Math.max(3, c.score),
          raw: c.score,
          itemStyle: { color: scoreTok(c.score).color, opacity: charKey && c.key !== charKey ? 0.42 : 1 },
        })),
      }],
    };
  }, [system?.id, integral, charKey, chart.ink, chart.inkSoft]);

  return (
    <GridCard
      title="Профиль качества по характеристикам"
      accent="gold"
      dotColor={GOLD.base}
      hint="клик по сектору или строке справа — выбрать характеристику"
    >
      {!system ? (
        <Hint text="Нет данных по выбранной системе" />
      ) : (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'stretch', height: '100%', minHeight: 240 }}>
          <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', minHeight: 220 }}>
            <AutoChart
              option={pieOption}
              notMerge
              minHeight={220}
              onEvents={{
                click: (p: any) => {
                  const c = system.characteristics.find((x) => x.title === p?.data?.name);
                  if (c) selectChar(c.key);
                },
              }}
            />
          </div>
          <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.tight }}>
            {system.characteristics.map((c) => {
              const active = c.key === charKey;
              const tok = scoreTok(c.score);
              return (
                <div
                  key={c.key}
                  role="button"
                  tabIndex={0}
                  data-char={c.title}
                  onClick={() => selectChar(c.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectChar(c.key); } }}
                  style={{
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.cozy,
                    padding: `${SPACE.snug}px ${SPACE.cozy}px`, borderRadius: PREMIUM.radiusSm,
                    background: active ? tok.soft : 'transparent',
                    border: `1px solid ${active ? tok.border : 'transparent'}`,
                    transition: 'all .15s ease', userSelect: 'none',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.snug, minWidth: 0 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: tok.color, flex: '0 0 auto', boxShadow: `0 0 0 3px ${tok.soft}` }} />
                    <span style={{ color: BRAND.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: active ? 600 : 400 }}>{c.title}</span>
                  </span>
                  <b style={{ color: tok.strong, flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>{c.score < 0 ? 'н/д' : `${c.score}%`}</b>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </GridCard>
  );
};

// ─────────────────── Метрики выбранной характеристики ───────────────────

export const ManagerMetricsCard: React.FC = () => {
  const { system, characteristic, subName, setSubName, hideChar, openJudgment } = useManagerScope();
  const chart = useChartTokens();
  const charTok = scoreTok(characteristic?.score ?? -1);

  const gaugeOption = useMemo(
    () => ({
      series: [{
        type: 'gauge',
        startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '60%'],
        progress: { show: true, width: 14, itemStyle: { color: charTok.color } },
        axisLine: { lineStyle: { width: 14, color: [[0.4, RAG.bad.color], [0.8, RAG.medium.color], [1, RAG.good.color]] } },
        pointer: { width: 4, length: '60%', itemStyle: { color: chart.ink } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        anchor: { show: true, size: 8, itemStyle: { color: chart.ink } },
        detail: {
          formatter: (characteristic?.score ?? -1) < 0 ? 'н/д' : '{value}%',
          fontSize: TYPE.metricMd.fontSize, fontWeight: TYPE.metricMd.fontWeight,
          color: charTok.strong, offsetCenter: [0, '34%'],
        },
        data: [{ value: Math.max(0, characteristic?.score ?? 0) }],
      }],
    }),
    [characteristic?.score, charTok.color, charTok.strong, chart.ink],
  );

  const columns = [
    { title: 'Метрика (подхарактеристика)', dataIndex: 'name', key: 'name', width: '46%',
      sorter: sorterFor((r: ManagerMetric) => r.name) },
    numericColumn<ManagerMetric>({
      title: 'Расчётный %', dataIndex: 'score', key: 'score', width: '20%',
      render: (v: number) => <Text strong style={{ color: scoreTok(v).strong }}>{v < 0 ? 'н/д' : `${v}%`}</Text>,
      sorter: (a: ManagerMetric, b: ManagerMetric) => a.score - b.score,
    }),
    {
      title: 'Уровень', key: 'level', width: '20%',
      render: (_: unknown, r: ManagerMetric) => {
        const t = scoreTok(r.score);
        return <Tag style={solidTagStyle(t.strong)}>{scoreLevel(r.score)}</Tag>;
      },
    },
    {
      title: '', key: 'action', width: '14%',
      render: (_: unknown, r: ManagerMetric) => (
        <Button
          size="small" type="primary" icon={<EditOutlined />}
          disabled={!system}
          onClick={(e) => {
            e.stopPropagation();
            if (system && characteristic) openJudgment({
              systemName: system.name, characteristic: characteristic.title, metricName: r.name, score: Math.max(0, r.score),
            });
          }}
        >
          Суждение
        </Button>
      ),
    },
  ];

  return (
    <GridCard
      accent="ink"
      dotColor={characteristic ? charTok.color : undefined}
      title={
        characteristic ? (
          <Space wrap>
            <span>Метрики характеристики «{characteristic.title}»</span>
            <Tag style={solidTagStyle(charTok.strong)}>
              {characteristic.score < 0 ? 'н/д' : `${characteristic.score}%`}
            </Tag>
          </Space>
        ) : 'Метрики характеристики'
      }
      extra={characteristic
        ? <Button size="small" icon={<EyeInvisibleOutlined />} onClick={hideChar}>Спрятать</Button>
        : undefined}
    >
      {!characteristic ? (
        <Hint text="Выберите характеристику в «Профиле качества» — здесь появятся её метрики" />
      ) : (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 260px', minWidth: 240, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            <div style={{ width: 214, height: 190, display: 'flex' }}>
              <AutoChart option={gaugeOption} minHeight={170} />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 300 }}>
            <Table<ManagerMetric>
              dataSource={characteristic.metrics}
              columns={columns}
              rowKey="id"
              size="small"
              pagination={false}
              onRow={(r) => ({
                onClick: () => setSubName(r.name === subName ? undefined : r.name),
                style: { cursor: 'pointer', background: r.name === subName ? PREMIUM.surfaceTint : undefined },
              })}
              locale={{ emptyText: <Empty description="Нет метрик" /> }}
            />
            <Text type="secondary" style={TYPE.caption}>
              Клик по строке — выбрать подхарактеристику (уточняет меры и суждения по ней).
            </Text>
          </div>
        </div>
      )}
    </GridCard>
  );
};

// ─────────────────── Выработка мер ───────────────────

export const ManagerMeasureDevCard: React.FC = () => {
  const { system, characteristic } = useManagerScope();
  if (!system || !characteristic) {
    return (
      <GridCard title="Выработка мер" accent="sage">
        <Hint text="Выберите характеристику — здесь появятся предложения по мерам" />
      </GridCard>
    );
  }
  // Панель приносит собственную карточку с шапкой, поэтому GridCard здесь не нужен:
  // иначе получится карточка в карточке с двумя заголовками. FillCard заставляет ЕЁ карточку
  // заполнить ячейку сетки — иначе под ней пустота, растущая при увеличении карточки мышью.
  return (
    <FillCard>
      <MeasureDevelopmentPanel
        systemName={system.name}
        system={system}
        characteristic={characteristic.title}
      />
    </FillCard>
  );
};

// ─────────────────── Меры и намерения ───────────────────

export const ManagerMeasuresCard: React.FC = () => {
  const { characteristic, subName, measuresList, openMeasure } = useManagerScope();
  const [showAll, setShowAll] = React.useState(false);

  const shown = useMemo(() => {
    const sorted = [...measuresList].sort((a, b) => a.calculatedScore - b.calculatedScore);
    return showAll ? sorted : sorted.slice(0, 3);
  }, [measuresList, showAll]);

  return (
    <GridCard
      accent="terracotta"
      dotColor={RAG.bad.color}
      title={
        <Space wrap>
          <span>Меры и намерения{characteristic ? ` — характеристика «${characteristic.title}»` : ''}</span>
          {subName && <Tag>{subName}</Tag>}
        </Space>
      }
    >
      {!characteristic ? (
        <Hint text="Выберите характеристику — здесь появятся меры по ней" />
      ) : measuresList.length === 0 ? (
        <Text type="secondary">
          По выбору мер пока нет. Откройте «Суждение» по метрике, чтобы зафиксировать
          профессиональное суждение и поставить задачу — она уйдёт топ-менеджменту на одобрение.
        </Text>
      ) : (
        <List
          dataSource={shown}
          footer={measuresList.length > 3 ? (
            <div style={{ textAlign: 'center' }}>
              <Button type="link" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Свернуть' : `Показать все (${measuresList.length})`}
              </Button>
            </div>
          ) : undefined}
          renderItem={(p) => {
            const meta = STATUS_META[p.status];
            return (
              <List.Item
                onClick={() => openMeasure(p)}
                style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px' }}
              >
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space wrap>
                    <Text strong>{p.riskTitle || p.metricName}</Text>
                    <Tag icon={meta.icon} style={solidTagStyle(meta.color)}>{meta.label}</Tag>
                    {p.execution === 'DONE' && <Tag color="green">выполнено</Tag>}
                    {p.execution === 'NOT_DONE' && <Tag color="red">не выполнено</Tag>}
                    {p.status === 'APPROVED' && !p.execution && <Tag color="blue">отчитаться о выполнении</Tag>}
                    <Text type="secondary" style={TYPE.caption}>{p.characteristic}</Text>
                  </Space>
                  <Text type="secondary" style={TYPE.bodySm}>{p.rationale}</Text>
                  {(p.owner || p.dueDate) && (
                    <Text type="secondary" style={TYPE.caption}>
                      {p.owner && <>Ответственный: {p.owner}{p.ownerRole ? ` (${p.ownerRole})` : ''}. </>}
                      {p.dueDate && <>Срок: {p.dueDate}.</>}
                    </Text>
                  )}
                  {p.decidedBy && (
                    <Text type="secondary" style={TYPE.caption}>
                      Решение: {meta.label.toLowerCase()} ({p.decidedBy})
                    </Text>
                  )}
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </GridCard>
  );
};

// ─────────────────── Профессиональные суждения ───────────────────

export const ManagerJudgmentsCard: React.FC = () => {
  const { system, characteristic, subName } = useManagerScope();
  if (!system || !characteristic) {
    return (
      <GridCard title="Профессиональные суждения" accent="slate">
        <Hint text="Выберите характеристику — здесь появятся заполненные суждения" />
      </GridCard>
    );
  }
  return (
    <FillCard>
      <FilledJudgmentsCard systemName={system.name} characteristic={characteristic.title} sub={subName} />
    </FillCard>
  );
};
