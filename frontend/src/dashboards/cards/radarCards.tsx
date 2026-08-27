/**
 * radarCards.tsx — карточки «Риск-радара».
 *
 * Скоуп не нужен: обе карточки самодостаточны, а выбор ИС относится только к списку триггеров и
 * живёт в его шапке. Данные тянутся через RTK Query — запросы дедуплицируются, если карточка
 * оказалась на дашборде рядом с другой такой же.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Empty, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { AlertOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useGetSystemsQuery, useGetTriggeredRisksQuery } from '../../store/api/apiSlice';
import type { RootState } from '../../store';
import { MOCK_INCIDENTS, computeTriggeredRisks } from '../../data/mockIncidents';
import { accentColorOf, SPACE, TYPE, PREMIUM } from '../../theme/premium';
import { RAG, solidTagStyle, ACCENT } from '../../theme/ragPalette';
import GridCard from '../GridCard';

const { Text, Paragraph } = Typography;

/** Плашка критичности — с белым текстом, поэтому тона глубокие (≥4.5:1 с белым, T-57). */
const SEVERITY: Record<string, { label: string; color: string; order: number }> = {
  critical: { label: 'критический', color: '#A32B1F', order: 0 },
  high: { label: 'высокий', color: RAG.bad.strong, order: 1 },
  medium: { label: 'средний', color: RAG.medium.strong, order: 2 },
  low: { label: 'низкий', color: ACCENT.slate.strong, order: 3 },
};

export const RadarNoteCard: React.FC = () => {
  const isLive = useSelector((s: RootState) => s.ui.dataMode) === 'live';
  return (
    <GridCard title="Зачем нужен риск-радар" accent="terracotta" dotColor={accentColorOf('terracotta')}>
      <Alert
        type="warning"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Проактивная защита от техсбоя"
        description={`Радар отбирает из базы риски, которые уже показывают признаки скорой реализации — по двум сигналам: (1) частые технические сбои по одной и той же первопричине в этой ИС, (2) просевшие характеристики качества ISO 25010, связанные с риском. Список строится напрямую по данным, а не придумывается на лету — это факт срабатывания. ${isLive ? 'Режим LLM: данные из реальной БД.' : 'Демо-режим: тот же алгоритм на сценарном демо-наборе техсбоев.'} Мера минимизации по каждому риску берётся из справочника рисков. Приоритет для реагирования — критические и высокие.`}
      />
    </GridCard>
  );
};

export const RadarTriggersCard: React.FC = () => {
  const isLive = useSelector((s: RootState) => s.ui.dataMode) === 'live';
  const { data: systems } = useGetSystemsQuery();
  const [system, setSystem] = useState<string | undefined>(undefined);
  const live = useGetTriggeredRisksQuery(system ? { system } : undefined, { skip: !isLive });
  const risks = isLive ? live.data : computeTriggeredRisks(MOCK_INCIDENTS, system);
  const isFetching = isLive && live.isFetching;

  const sorted = useMemo(
    () => [...(risks ?? [])].sort((a, b) => (SEVERITY[a.severity]?.order ?? 9) - (SEVERITY[b.severity]?.order ?? 9)),
    [risks],
  );

  const systemOptions = [
    { value: '', label: 'Весь ИТ-ландшафт' },
    ...(systems?.items ?? []).map((s) => ({ value: s.name, label: s.name })),
  ];

  return (
    <GridCard
      title="Сработавшие риск-триггеры"
      accent="slate"
      dotColor={ACCENT.slate.color}
      extra={(
        <Select
          size="small"
          style={{ minWidth: 200 }}
          value={system ?? ''}
          onChange={(v) => setSystem(v || undefined)}
          options={systemOptions}
          placeholder="Система"
        />
      )}
    >
      {isFetching ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
      ) : sorted.length === 0 ? (
        <Empty description="Активных риск-триггеров нет — по текущим данным риски из базы не сработали." />
      ) : (
        <List
          itemLayout="vertical"
          dataSource={sorted}
          renderItem={(r) => {
            const sev = SEVERITY[r.severity] ?? { label: r.severity, color: RAG.muted.strong, order: 9 };
            return (
              <List.Item key={r.id} style={{ borderLeft: `3px solid ${sev.color}`, paddingLeft: SPACE.base, marginBottom: SPACE.tight }}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag style={solidTagStyle(sev.color)}>{sev.label}</Tag>
                    {r.characteristic && <Tag>{r.characteristic}</Tag>}
                    <Text strong>{r.title}</Text>
                    <Text type="secondary" style={TYPE.caption}>({r.code})</Text>
                  </Space>
                  <Space size={6} align="start">
                    {/* ui-audit-ignore UI-05 — оптическая подгонка иконки под базовую линию текста. */}
                    <ThunderboltOutlined style={{ color: RAG.bad.color, marginTop: 3 }} />
                    <Text style={{ fontSize: TYPE.bodySm.fontSize }}>
                      <Text type="secondary">Сработал по: </Text>{r.triggered_by}
                    </Text>
                  </Space>
                  {r.consequence && (
                    <Text type="secondary" style={{ fontSize: TYPE.bodySm.fontSize }}>
                      <AlertOutlined /> Последствие: {r.consequence}
                    </Text>
                  )}
                  {r.mitigation && (
                    <Paragraph style={{
                      ...TYPE.bodySm, marginBottom: 0,
                      background: PREMIUM.surfaceSoft,
                      padding: `${SPACE.snug}px ${SPACE.cozy}px`,
                      borderRadius: PREMIUM.radiusSm,
                    }}>
                      <Text strong style={TYPE.captionStrong}>Меры минимизации: </Text>{r.mitigation}
                    </Paragraph>
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
