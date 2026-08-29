/**
 * execCards.tsx — карточки управленческого дашборда (CEO/CTO) как единицы каталога.
 *
 * Вёрстка перенесена из ExecutiveDashboard. Изменения только там, где этого требует сетка:
 *  • «Общий индекс» был не карточкой, а шапкой страницы — стал карточкой с тем же содержимым;
 *  • «AI-резюме» раньше просто не рендерилось в демо-режиме — теперь честно говорит, что
 *    доступно в режиме LLM (в сетке карточка не может молча исчезнуть, оставив дыру);
 *  • «Топ проблемных ИС» был Row из трёх Col — стал сеткой внутри карточки, чтобы три плитки
 *    ужимались вместе с шириной ячейки.
 */
import React from 'react';
import { Alert, Badge, Button, Card, Space, Spin, Tag, Typography } from 'antd';
import { RobotOutlined, FireOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { RAG, ragToken, levelLabel, BRAND, critTagStyle, solidTagStyle } from '../../theme/ragPalette';
import { GOLD, PREMIUM, TYPE, SPACE } from '../../theme/premium';
import { useChartTokens } from '../../theme/useThemeTokens';
import { MeasuresRegistryCard } from '../../components/MeasuresRegistryCard';
import MeasuresAiAnalyticsCard from '../../components/MeasuresAiAnalyticsCard';
import { TechDebtCard } from '../../components/TechDebtCard';
import EmployeeEffectivenessCard from '../../components/EmployeeEffectivenessCard';
import { useExecScope } from '../scopes/ExecScope';
import GridCard, { FillCard } from '../GridCard';
import AutoChart from '../AutoChart';

const { Title, Text, Paragraph } = Typography;

// ─────────────────── Общий индекс качества ───────────────────

export const ExecIndexCard: React.FC = () => {
  const { globalIndex, isLive, live, pendingCount, openPending, gaugeCaption } = useExecScope();
  const idxTok = ragToken(globalIndex);
  const chart = useChartTokens();

  const gaugeOption = React.useMemo(() => ({
    series: [{
      type: 'gauge',
      startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '62%'],
      progress: { show: true, width: 16, itemStyle: { color: idxTok.color } },
      axisLine: { lineStyle: { width: 16, color: [[0.4, RAG.bad.color], [0.8, RAG.medium.color], [1, RAG.good.color]] } },
      pointer: { width: 4, length: '62%', itemStyle: { color: chart.ink } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      anchor: { show: true, size: 10, itemStyle: { color: chart.ink } },
      detail: {
        valueAnimation: true, formatter: '{value}%',
        fontSize: TYPE.metricLg.fontSize, fontWeight: TYPE.metricLg.fontWeight,
        color: idxTok.color, offsetCenter: [0, '32%'],
      },
      data: [{ value: globalIndex }],
    }],
  }), [globalIndex, idxTok.color, chart.ink]);

  return (
    <GridCard title="Общий индекс качества ИТ-ландшафта" accent="gold" dotColor={GOLD.base}>
      <div style={{ display: 'flex', gap: SPACE.base, flexWrap: 'wrap', alignItems: 'center', height: '100%' }}>
        <div style={{ flex: '1 1 240px', minWidth: 220 }}>
          <Title level={4} style={{ margin: 0, color: idxTok.strong }}>
            {globalIndex}% · {levelLabel(globalIndex)}
          </Title>
          <Text type="secondary">
            <Tag color={isLive ? 'green' : 'default'}>{isLive ? 'LLM · live' : 'Демо'}</Tag>
          </Text>
          {isLive && live?.periodsUsed && live.periodsUsed.distinct.length > 0 && (
            <div style={{ marginTop: SPACE.tight }}>
              <Text type="secondary" style={TYPE.caption}>
                Данные за период{live.periodsUsed.distinct.length > 1 ? 'ы' : ''}:{' '}
                {live.periodsUsed.distinct.length > 1
                  ? `${live.periodsUsed.earliest} – ${live.periodsUsed.latest} (разные ИС на разных последних периодах)`
                  : live.periodsUsed.latest}
              </Text>
            </div>
          )}
          <div style={{ marginTop: SPACE.cozy }}>
            <Badge count={pendingCount} offset={[-6, 6]} color={RAG.medium.color}>
              <Button onClick={openPending}>Меры на одобрение</Button>
            </Badge>
          </div>
        </div>
        <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column' }}>
          <AutoChart option={gaugeOption} minHeight={130} />
          {gaugeCaption && (
            <Text type="secondary" style={{ ...TYPE.caption, display: 'block', textAlign: 'center', marginTop: -8 }}>
              {gaugeCaption}
            </Text>
          )}
        </div>
      </div>
    </GridCard>
  );
};

// ─────────────────── AI-резюме ───────────────────

export const ExecAiSummaryCard: React.FC = () => {
  const { isLive, live, liveLoading, liveError } = useExecScope();
  return (
    <GridCard title={<><RobotOutlined /> AI-резюме</>} accent="slate">
      {!isLive ? (
        <Text type="secondary">
          Резюме встроенной модели доступно в режиме LLM — переключите тумблер «Демо / LLM» в шапке.
        </Text>
      ) : liveLoading ? (
        <div><Spin size="small" /> <Text type="secondary">Генерация на локальной модели…</Text></div>
      ) : liveError ? (
        <Alert
          type="warning" showIcon
          message="Не удалось получить ответ LLM — переключитесь на «Демо» или проверьте backend."
          description={liveError}
        />
      ) : live ? (
        <Paragraph style={{ marginBottom: 0, fontSize: TYPE.bodySm.fontSize }}>{live.aiInsights}</Paragraph>
      ) : (
        <Text type="secondary">Данных пока нет.</Text>
      )}
    </GridCard>
  );
};

// ─────────────────── AI-аналитика по мерам ───────────────────

export const ExecMeasuresAiCard: React.FC = () => {
  const { proposals, openRegistryFor } = useExecScope();
  const navigate = useNavigate();
  return (
    <FillCard>
      <MeasuresAiAnalyticsCard
        proposals={proposals}
        onOpenCharacteristic={openRegistryFor}
        onOpenInTaskPlan={(c) => navigate(`/dashboard/taskplan?characteristic=${encodeURIComponent(c)}`)}
      />
    </FillCard>
  );
};

// ─────────────────── Топ проблемных ИС ───────────────────

export const ExecTopSystemsCard: React.FC = () => {
  const { topCards, aiInsights, genSystemInsight, openSystem, openAllSystems } = useExecScope();
  return (
    <GridCard
      accent="terracotta"
      dotColor={RAG.medium.color}
      title={<><FireOutlined style={{ color: RAG.medium.color }} /> Топ проблемных ИС — требуют внимания</>}
      extra={<Button type="link" size="small" onClick={openAllSystems}>Показать все системы →</Button>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: SPACE.base }}>
        {topCards.map((sys) => {
          const tok = ragToken(sys.score);
          const insight = aiInsights[sys.id];
          return (
            <Card
              key={sys.id}
              hoverable
              onClick={() => openSystem(sys)}
              style={{ borderColor: tok.border, background: tok.soft, height: '100%', borderRadius: PREMIUM.radius, boxShadow: PREMIUM.shadow.card }}
              styles={{ body: { padding: 16 } }}
            >
              <Space style={{ marginBottom: 8 }} wrap>
                <Button
                  size="small"
                  type={insight?.text ? 'default' : 'primary'}
                  ghost={!!insight?.text}
                  icon={<RobotOutlined />}
                  loading={!!insight?.loading}
                  onClick={(e) => { e.stopPropagation(); genSystemInsight(sys); }}
                >
                  {insight?.loading ? 'Генерация…' : insight?.text ? 'AI-резюме' : 'Собрать AI-резюме'}
                </Button>
                <Tag style={solidTagStyle(tok.strong)}>{sys.score}%</Tag>
                <Tag style={critTagStyle(sys.criticality)}>{sys.criticality}</Tag>
              </Space>
              <Title level={5} style={{ margin: '4px 0', color: BRAND.ink }}>{sys.name}</Title>
              <Text type="secondary" style={{ ...TYPE.micro, display: 'block', marginBottom: 2 }}>
                {insight?.text ? '✓ Вывод ИИ (сгенерировано по кнопке)' : 'Сводка по метрикам — не заключение ИИ, нажмите кнопку выше'}
              </Text>
              <Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ fontSize: TYPE.bodySm.fontSize, marginBottom: 8 }}>
                {insight?.error
                  ? 'Не удалось получить анализ LLM — попробуйте ещё раз или проверьте backend.'
                  : insight?.text ?? sys.aiSummary}
              </Paragraph>
              {!insight?.text && !insight?.error && (
                <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>→ {sys.recommendation}</Text>
              )}
            </Card>
          );
        })}
      </div>
    </GridCard>
  );
};

// ─────────────────── Технический долг ───────────────────

export { ExecHeatmapCard } from './execHeatmapCard';

export const ExecTechDebtCard: React.FC = () => {
  const { proposals, openMeasure } = useExecScope();
  return (
    <FillCard>
      <TechDebtCard proposals={proposals} onOpenMeasure={openMeasure} />
    </FillCard>
  );
};

// ─────────────────── Эффективность сотрудников ───────────────────

export const ExecEmployeesCard: React.FC = () => {
  const { proposals } = useExecScope();
  const navigate = useNavigate();
  return (
    <FillCard>
      <EmployeeEffectivenessCard
        proposals={proposals}
        onSelectOwner={(o, status) => navigate(`/dashboard/taskplan?owner=${encodeURIComponent(o)}${status ? `&status=${encodeURIComponent(status)}` : ''}`)}
      />
    </FillCard>
  );
};

// ─────────────────── Реестр мер качества ───────────────────

export const ExecRegistryCard: React.FC = () => {
  const { proposals, openMeasure, registryPreset } = useExecScope();
  // MeasuresRegistryCard приносит собственную <Card {...premiumCard('ink')}> с уже полным
  // заголовком (счётчик, иконка) — GridCard поверх нёс бы карточку в карточке с двумя
  // заголовками. FillCard вместо этого заставляет ЕЁ карточку заполнить ячейку сетки.
  return (
    <FillCard>
      <MeasuresRegistryCard proposals={proposals} onOpen={openMeasure} presetCharacteristic={registryPreset} />
    </FillCard>
  );
};

