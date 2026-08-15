import React from 'react';
import { Typography, Card, Switch, Tag, Row, Col, Space } from 'antd';
import { LineChartOutlined, ScheduleOutlined, DashboardOutlined, ThunderboltOutlined, AlertOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { setExecFeature, type ExecFeatureKey } from '../store/slices/uiSlice';
import { accentDot, pageContainer, pageTitle, GOLD, PREMIUM, SPACE, TYPE } from '../theme/premium';
import { RAG, ACCENT, BRAND } from '../theme/ragPalette';
import ThemeSettingsCard from '../components/ThemeSettingsCard';

const { Title, Text, Paragraph } = Typography;

// Мини-превью «Динамика качества» — линия тренда по кварталам.
const DynamicsPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    {[15, 30, 45].map((y) => <line key={y} x1="0" y1={y} x2="160" y2={y} stroke="#EEF0F2" strokeWidth="1" />)}
    <polyline points="0,44 32,36 64,40 96,22 128,26 160,12" fill="none" stroke={on ? ACCENT.slate.color : '#C2C8D0'} strokeWidth="2.5" />
    {[[0, 44], [32, 36], [64, 40], [96, 22], [128, 26], [160, 12]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r="3" fill={on ? '#3A4F6B' : '#C2C8D0'} />
    ))}
  </svg>
);

// Мини-превью «План задач» — полосы диаграммы Ганта.
const TaskPlanPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    <line x1="96" y1="0" x2="96" y2="60" stroke="#F0C5BC" strokeWidth="2" />
    <rect x="6" y="8" width="70" height="9" rx="4" fill={on ? ACCENT.slate.color : BRAND.borderSoft} />
    <rect x="30" y="26" width="96" height="9" rx="4" fill={on ? RAG.medium.color : BRAND.borderSoft} />
    <rect x="52" y="44" width="60" height="9" rx="4" fill={on ? RAG.bad.color : BRAND.borderSoft} />
  </svg>
);

// Мини-превью «Аналитический дашборд» — бублик распределения + столбцы.
const AnalyticsPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    <circle cx="28" cy="30" r="16" fill="none" stroke={on ? ACCENT.slate.color : BRAND.borderSoft} strokeWidth="8" strokeDasharray="64 36" transform="rotate(-90 28 30)" />
    {[[72, 34], [96, 22], [120, 30], [144, 16]].map(([x, h], i) => (
      <rect key={i} x={x} y={52 - h} width="14" height={h} rx="3"
        fill={on ? [ACCENT.slate.color, RAG.good.color, RAG.medium.color, RAG.bad.color][i] : BRAND.borderSoft} />
    ))}
  </svg>
);

// Мини-превью «Аналитика сбоев» — донат первопричин + столбцы MTTR.
const IncidentsPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    <circle cx="30" cy="30" r="16" fill="none" stroke={on ? ACCENT.violet.color : BRAND.borderSoft} strokeWidth="8" strokeDasharray="30 70" transform="rotate(-90 30 30)" />
    <circle cx="30" cy="30" r="16" fill="none" stroke={on ? ACCENT.slate.color : '#E3E6EA'} strokeWidth="8" strokeDasharray="18 82" strokeDashoffset="-30" transform="rotate(-90 30 30)" />
    {[[74, 28], [98, 18], [122, 34], [146, 22]].map(([x, h], i) => (
      <rect key={i} x={x} y={52 - h} width="14" height={h} rx="3"
        fill={on ? [ACCENT.violet.color, RAG.medium.color, RAG.good.color, RAG.bad.color][i] : BRAND.borderSoft} />
    ))}
  </svg>
);

// ДЕФ-27: у риск-радара появился свой переключатель — раньше он гейтился флагом
// «Аналитика сбоев», и, выключив её, топ-менеджер неожиданно терял и радар.
const RiskRadarPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    {[22, 15, 8].map((r, i) => (
      <circle key={i} cx="80" cy="32" r={r} fill="none"
        stroke={on ? BRAND.borderSoft : '#EDEFF2'} strokeWidth="1.5" />
    ))}
    <line x1="80" y1="32" x2="80" y2="10" stroke={on ? ACCENT.slate.color : BRAND.borderSoft} strokeWidth="2" />
    {[[96, 22, RAG.bad.color], [66, 40, RAG.medium.color], [88, 44, RAG.good.color]].map(([x, y, c], i) => (
      <circle key={`p${i}`} cx={x as number} cy={y as number} r="4" fill={on ? (c as string) : BRAND.borderSoft} />
    ))}
  </svg>
);

interface FeatureDef {
  key: ExecFeatureKey;
  title: string;
  desc: string;
  icon: React.ReactNode;
  Preview: React.FC<{ on: boolean }>;
}

const FEATURES: FeatureDef[] = [
  {
    key: 'execAnalytics',
    title: 'Аналитический дашборд',
    desc: 'Распределение метрик по уровням, проблемные ИС и полная тепловая карта по всем ИС.',
    icon: <DashboardOutlined />,
    Preview: AnalyticsPreview,
  },
  {
    key: 'execDynamics',
    title: 'Дашборд «Динамика качества»',
    desc: 'Тренды характеристик и подхарактеристик по кварталам с кликабельными линиями.',
    icon: <LineChartOutlined />,
    Preview: DynamicsPreview,
  },
  {
    key: 'execTaskPlan',
    title: 'Дашборд «План задач по повышению качества»',
    desc: 'Пузырьковая шкала по ответственным: сроки, задачи в СУЗ, комментарии и эскалация. '
      + 'Цвет пузырька — просрочено / в зоне риска / в плане.',
    icon: <ScheduleOutlined />,
    Preview: TaskPlanPreview,
  },
  {
    key: 'execIncidents',
    title: 'Аналитика технических сбоев',
    desc: 'Сбои по первопричинам (релиз/инфраструктура/производительность/сеть/электроснабжение), MTTR и топ нестабильных ИС.',
    icon: <ThunderboltOutlined />,
    Preview: IncidentsPreview,
  },
  {
    key: 'execRiskRadar',
    title: 'Риск-радар',
    desc: 'Риски, сработавшие по метрикам качества: что уже требует внимания, чтобы не допустить технического сбоя.',
    icon: <AlertOutlined />,
    Preview: RiskRadarPreview,
  },
];

const AdminFlagsPage: React.FC = () => {
  const dispatch = useDispatch();
  const ui = useSelector((s: RootState) => s.ui);

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Настройка</Title>
      <Text type="secondary">Персональные настройки интерфейса и опциональные дашборды для топ-менеджмента.</Text>

      {/* Оформление: тема + шрифт (ТЗ v17, req 5) — применяется сразу, сохраняется в браузере. */}
      <div style={{ marginTop: 16 }}>
        <ThemeSettingsCard />
      </div>

      <Title level={5} style={{ marginTop: 24, marginBottom: 4 }}>Дополнительные дашборды</Title>
      <Text type="secondary">Управляйте составом дашбордов в меню: включённые видны, выключенные скрываются (для топ-менеджмента).</Text>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {FEATURES.map((f) => {
          const on = (ui as any)[f.key] as boolean;
          const { Preview } = f;
          return (
            <Col xs={24} md={12} key={f.key}>
              <Card
                hoverable
                styles={{ body: { padding: 0 } }}
                style={{ borderColor: on ? '#8FB9A2' : PREMIUM.border, overflow: 'hidden', borderRadius: PREMIUM.radius, boxShadow: PREMIUM.shadow.card }}
              >
                <div style={{ padding: 16, background: on ? '#F5FAF7' : BRAND.surfaceSoft, borderBottom: '1px solid #EEF0F2' }}>
                  <Preview on={on} />
                </div>
                <div style={{ padding: 16 }}>
                  <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Space>
                      <span style={{
                        width: 40, height: 40, borderRadius: 10, fontSize: TYPE.pageTitle.fontSize, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                        background: on ? '#E5F2EA' : BRAND.dividerSoft, color: on ? RAG.good.strong : RAG.muted.strong,
                      }}>{f.icon}</span>
                      <div>
                        <Text strong>{f.title}</Text><br />
                        <Tag color={on ? 'green' : 'default'} style={{ marginTop: 4 }}>
                          {on ? 'Включён для топ-менеджера' : 'Выключен'}
                        </Tag>
                      </div>
                    </Space>
                    <Switch checked={on} onChange={(v) => dispatch(setExecFeature({ key: f.key, value: v }))} />
                  </Space>
                  <Paragraph type="secondary" style={{ fontSize: TYPE.bodySm.fontSize, marginTop: SPACE.cozy, marginBottom: 0 }}>{f.desc}</Paragraph>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* ПОД РАЗВИТИЕ: раздел «Оценка СИИ» (ГОСТ Р 59898-2021) и история ИИ-оценок пока НЕ
          выведены в интерфейс. Страница и маршрут сохранены в коде (App.tsx, AiAssessmentPage);
          когда понадобится — вернуть сюда карточку-переключатель и пункт меню (AppLayout). */}
    </div>
  );
};

export default AdminFlagsPage;
