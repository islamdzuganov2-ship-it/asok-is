import React from 'react';
import { Typography, Card, Switch, Tag, Row, Col, Space } from 'antd';
import { LineChartOutlined, ScheduleOutlined, DashboardOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { setExecFeature, type ExecFeatureKey } from '../store/slices/uiSlice';

const { Title, Text, Paragraph } = Typography;

// Мини-превью «Динамика качества» — линия тренда по кварталам.
const DynamicsPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    {[15, 30, 45].map((y) => <line key={y} x1="0" y1={y} x2="160" y2={y} stroke="#EEF0F2" strokeWidth="1" />)}
    <polyline points="0,44 32,36 64,40 96,22 128,26 160,12" fill="none" stroke={on ? '#6E89A6' : '#C2C8D0'} strokeWidth="2.5" />
    {[[0, 44], [32, 36], [64, 40], [96, 22], [128, 26], [160, 12]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r="3" fill={on ? '#3A4F6B' : '#C2C8D0'} />
    ))}
  </svg>
);

// Мини-превью «План задач» — полосы диаграммы Ганта.
const TaskPlanPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    <line x1="96" y1="0" x2="96" y2="60" stroke="#F0C5BC" strokeWidth="2" />
    <rect x="6" y="8" width="70" height="9" rx="4" fill={on ? '#6E89A6' : '#D5DAE0'} />
    <rect x="30" y="26" width="96" height="9" rx="4" fill={on ? '#C9A14A' : '#D5DAE0'} />
    <rect x="52" y="44" width="60" height="9" rx="4" fill={on ? '#C06B5A' : '#D5DAE0'} />
  </svg>
);

// Мини-превью «Аналитический дашборд» — бублик распределения + столбцы.
const AnalyticsPreview: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="100%" height="60" viewBox="0 0 160 60" preserveAspectRatio="none">
    <circle cx="28" cy="30" r="16" fill="none" stroke={on ? '#6E89A6' : '#D5DAE0'} strokeWidth="8" strokeDasharray="64 36" transform="rotate(-90 28 30)" />
    {[[72, 34], [96, 22], [120, 30], [144, 16]].map(([x, h], i) => (
      <rect key={i} x={x} y={52 - h} width="14" height={h} rx="3"
        fill={on ? ['#6E89A6', '#6F9F86', '#C9A14A', '#C06B5A'][i] : '#D5DAE0'} />
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
    desc: 'Диаграмма Ганта: сроки, ответственные, задачи в СУЗ, комментарии и эскалация.',
    icon: <ScheduleOutlined />,
    Preview: TaskPlanPreview,
  },
];

const AdminFlagsPage: React.FC = () => {
  const dispatch = useDispatch();
  const ui = useSelector((s: RootState) => s.ui);

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Настройка</Title>
      <Text type="secondary">Опциональные дашборды для топ-менеджмента. Включите нужные — они появятся в меню.</Text>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {FEATURES.map((f) => {
          const on = (ui as any)[f.key] as boolean;
          const { Preview } = f;
          return (
            <Col xs={24} md={12} key={f.key}>
              <Card
                hoverable
                styles={{ body: { padding: 0 } }}
                style={{ borderColor: on ? '#8FB9A2' : undefined, overflow: 'hidden' }}
              >
                <div style={{ padding: 16, background: on ? '#F5FAF7' : '#FAFBFC', borderBottom: '1px solid #EEF0F2' }}>
                  <Preview on={on} />
                </div>
                <div style={{ padding: 16 }}>
                  <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Space>
                      <span style={{
                        width: 40, height: 40, borderRadius: 10, fontSize: 20, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                        background: on ? '#E5F2EA' : '#F0F1F3', color: on ? '#6F9F86' : '#8a94a6',
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
                  <Paragraph type="secondary" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>{f.desc}</Paragraph>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
};

export default AdminFlagsPage;
