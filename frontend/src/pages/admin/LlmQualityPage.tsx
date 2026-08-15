/**
 * LlmQualityPage.tsx (ТЗ v18 п.10) — дашборд «Качество LLM» супер-администратора.
 *
 * Система оценивает чужие ИС по ISO/IEC 25010 — здесь она показывает оценку САМОЙ СЕБЯ
 * по той же модели: 8 характеристик, 31 подхарактеристика, интегральный балл и покрытие.
 *
 * Ключевое отличие от прочих дашбордов — трактовка «нет балла». Здесь `score = null` это
 * не пропуск данных, а честный статус «невозможно измерить»: подхарактеристика либо
 * неприменима к LLM-компоненту (эстетика интерфейса), либо требует инференса, которого в
 * данном прогоне не было. Поэтому такие строки показаны отдельным нейтральным статусом и
 * НЕ занижают интегральный балл — ровно как методика МК_8.1 предписывает для прикладных ИС.
 *
 * Доступ гейтится правом view.admin.llm_quality (маршрут в App.tsx); право входит в набор
 * исключительных прав суперадминистратора и не выдаётся матрицей другим ролям.
 */
import React, { useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { message } from '../../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import {
  ExperimentOutlined, PlayCircleOutlined, ReloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  useGetLlmQualityQuery, useRunLlmQualityMutation,
  type LlmCharacteristicCheck, type LlmQualityHistoryRow, type LlmSubcheck,
} from '../../store/api/apiSlice';
import { numericColumn, numericText } from '../../theme/table';
import { pageContainer, pageTitle, GOLD, premiumCard, accentDot, TYPE, SPACE } from '../../theme/premium';
import { BRAND, RAG, ragToken, levelLabel, solidTagStyle } from '../../theme/ragPalette';

const { Title, Text, Paragraph } = Typography;

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;

/** Плашка балла: цвет из общей RAG-палитры, чтобы шкала совпадала с остальными дашбордами. */
const ScoreTag: React.FC<{ score: number | null }> = ({ score }) => {
  if (score === null) {
    return (
      <Tag style={solidTagStyle(RAG.muted.strong)}>невозможно измерить</Tag>
    );
  }
  const token = ragToken(Math.round(score * 100));
  return (
    <Tooltip title={levelLabel(Math.round(score * 100))}>
      <Tag style={solidTagStyle(token.strong)}>{pct(score)}</Tag>
    </Tooltip>
  );
};

const subColumns: ColumnsType<LlmSubcheck> = [
  { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 260,
    render: (v: string) => <span style={{ color: BRAND.ink }}>{v}</span> },
  { title: 'Что измеряется', dataIndex: 'what', width: 280,
    render: (v: string) => <Text type="secondary">{v}</Text> },
  numericColumn<LlmSubcheck>({
    title: 'Балл', dataIndex: 'score', width: 130,
    render: (_: unknown, row: LlmSubcheck) => <ScoreTag score={row.score} />,
  }),
  { title: 'Обоснование', dataIndex: 'evidence',
    render: (v: string) => <Text style={TYPE.caption}>{v}</Text> },
];

const LlmQualityPage: React.FC = () => {
  const { data, isLoading, isFetching, refetch } = useGetLlmQualityQuery();
  const [run, runState] = useRunLlmQualityMutation();
  const [expanded, setExpanded] = useState<readonly React.Key[]>([]);

  const start = async (mode: 'full' | 'static') => {
    try {
      const res = await run({ mode }).unwrap();
      if (res.status === 'QUEUED') {
        message.info('Полный прогон запущен в фоне — на CPU он занимает минуты. '
          + 'Обновите страницу позже, чтобы увидеть отчёт.');
      } else {
        message.success('Быстрый прогон выполнен: отчёт обновлён.');
      }
    } catch {
      message.error('Не удалось запустить самооценку');
    }
  };

  if (isLoading) {
    return <div style={pageContainer}><Spin /> <Text type="secondary">Загрузка отчёта самооценки…</Text></div>;
  }

  const report = data?.report ?? null;

  const charColumns: ColumnsType<LlmCharacteristicCheck> = [
    { title: 'Характеристика ISO/IEC 25010', dataIndex: 'characteristic',
      render: (v: string) => <span style={{ color: BRAND.ink, fontWeight: 600 }}>{v}</span> },
    numericColumn<LlmCharacteristicCheck>({
      title: 'Балл', dataIndex: 'score', width: 130,
      render: (_: unknown, row: LlmCharacteristicCheck) => <ScoreTag score={row.score} />,
    }),
    numericColumn<LlmCharacteristicCheck>({
      title: 'Измерено', dataIndex: 'measured', width: 130,
      render: (_: unknown, row: LlmCharacteristicCheck) =>
        <span style={numericText}>{row.measured} из {row.total}</span>,
    }),
  ];

  const historyColumns: ColumnsType<LlmQualityHistoryRow> = [
    { title: 'Дата прогона', dataIndex: 'generated_at', width: 200 },
    { title: 'Режим', dataIndex: 'mode', width: 110,
      render: (v: string) => <Tag>{v === 'full' ? 'с инференсом' : 'быстрый'}</Tag> },
    { title: 'Запуск', dataIndex: 'trigger', width: 130,
      render: (v: string) => <Text type="secondary">{v === 'schedule' ? 'по расписанию' : 'вручную'}</Text> },
    numericColumn<LlmQualityHistoryRow>({
      title: 'Интеграл', dataIndex: 'integral', width: 110,
      render: (v: number | null) => <span style={numericText}>{pct(v)}</span>,
    }),
    numericColumn<LlmQualityHistoryRow>({
      title: 'Покрытие', dataIndex: 'coverage', width: 110,
      render: (v: number) => <span style={numericText}>{pct(v)}</span>,
    }),
    numericColumn<LlmQualityHistoryRow>({
      title: 'Длительность', dataIndex: 'duration_s', width: 130,
      render: (v: number) => <span style={numericText}>{v} с</span>,
    }),
    { title: 'Модель', dataIndex: 'model', render: (v?: string) => <Text style={TYPE.caption}>{v ?? '—'}</Text> },
  ];

  return (
    <div style={pageContainer}>
      <Space align="start" style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={pageTitle}>
            <ExperimentOutlined style={{ color: GOLD.base, marginRight: 8 }} />Качество LLM
          </Title>
          <Text type="secondary">
            Самооценка встроенной LLM-подсистемы по ISO/IEC 25010 — той же моделью качества,
            которой система оценивает прикладные ИС. Расписание: {data?.schedule ?? '—'}.
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
            Обновить
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => start('static')}
            loading={runState.isLoading}>
            Быстрый прогон
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => start('full')}
            loading={runState.isLoading}>
            Полный прогон
          </Button>
        </Space>
      </Space>

      {!report && (
        <Card {...premiumCard('ink')} style={{ marginTop: 16 }}>
          <Empty description={
            <Space direction="vertical" size={SPACE.snug}>
              <Text>Самооценка ещё не выполнялась.</Text>
              <Text type="secondary">
                Запустите быстрый прогон (интроспекция, доли секунды) или полный
                (с обращением к модели — на CPU занимает минуты и выполняется в фоне).
              </Text>
            </Space>
          } />
        </Card>
      )}

      {report && (
        <>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card {...premiumCard('ink')}>
                <Statistic title="Интегральное качество" value={pct(report.integral)}
                  valueStyle={{ color: report.integral === null ? RAG.muted.strong
                    : ragToken(Math.round(report.integral * 100)).strong }} />
                <Text type="secondary" style={TYPE.caption}>
                  только по измеренным подхарактеристикам
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card {...premiumCard('ink')}>
                <Statistic title="Покрытие измерений" value={pct(report.coverage)} />
                <Text type="secondary" style={TYPE.caption}>
                  измерено {report.measured} из {report.total} подхарактеристик
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card {...premiumCard('ink')}>
                <Statistic title="Режим прогона"
                  value={report.mode === 'full' ? 'с инференсом' : 'быстрый'} />
                <Text type="secondary" style={TYPE.caption}>
                  длительность {report.duration_s} с, запуск {report.trigger === 'schedule'
                    ? 'по расписанию' : 'вручную'}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card {...premiumCard('ink')}>
                <Statistic title="Модель" value={report.model?.file_name ?? 'не загружена'}
                  valueStyle={{ fontSize: 16 }} />
                <Text type="secondary" style={TYPE.caption}>
                  {report.model
                    ? `${report.model.architecture ?? '—'} · ${report.model.quant ?? '—'} · окно ${report.model.n_ctx ?? '—'}`
                    : 'подсистема работает на детерминированном откате'}
                </Text>
              </Card>
            </Col>
          </Row>

          <Alert style={{ marginTop: 16 }} type={report.model_available ? 'info' : 'warning'}
            showIcon message="Вердикт" description={
              <Space direction="vertical" size={SPACE.snug} style={{ width: '100%' }}>
                <Paragraph style={{ marginBottom: 0 }}>{report.verdict}</Paragraph>
                {report.notes.map((n) => (
                  <Text key={n} type="secondary" style={TYPE.caption}>• {n}</Text>
                ))}
              </Space>
            } />

          <Card {...premiumCard('ink')} style={{ marginTop: 16 }}
            title={<Space><span style={accentDot(GOLD.base)} />
              <span style={{ color: BRAND.ink }}>Характеристики качества</span></Space>}>
            <Table<LlmCharacteristicCheck>
              rowKey="characteristic"
              size="small"
              pagination={false}
              columns={charColumns}
              dataSource={report.characteristics}
              expandable={{
                expandedRowKeys: expanded,
                onExpandedRowsChange: setExpanded,
                expandedRowRender: (row) => (
                  <Table<LlmSubcheck>
                    rowKey="subcharacteristic"
                    size="small"
                    pagination={false}
                    columns={subColumns}
                    dataSource={row.subcharacteristics}
                  />
                ),
              }}
            />
          </Card>
        </>
      )}

      {(data?.history?.length ?? 0) > 0 && (
        <Card {...premiumCard('ink')} style={{ marginTop: 16 }}
          title={<Space><span style={accentDot(RAG.good.strong)} />
            <span style={{ color: BRAND.ink }}>История прогонов</span></Space>}>
          <Table<LlmQualityHistoryRow>
            rowKey="id" size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }}
            columns={historyColumns} dataSource={data?.history ?? []}
          />
        </Card>
      )}
    </div>
  );
};

export default LlmQualityPage;
