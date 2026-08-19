/**
 * AssigneeTasksPage.tsx — «Мои задачи» для роли «Исполнитель» (ТЗ v17, req 6).
 *
 * Исполнитель видит назначенные на него поручения (меры, где owner = его ФИО) и может:
 *   • задавать уточнения по метрике/поручению (текстом);
 *   • предлагать новый срок по поручению с обоснованием.
 * Всё это «падает» менеджеру по качеству: уточнения и запрос переноса срока он видит в карточке
 * задачи «Плана задач» и решает по переносу (принять/отклонить). См. governanceSlice.
 *
 * Источник данных — governance-набор по режиму (mock/live). Дашборды у исполнителя те же, что у
 * топ-менеджмента (маршруты в App.tsx), но действия по мерам — только просмотр.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Button, Col, DatePicker, Empty, Input, InputNumber, Modal, Radio, Row, Space, Statistic, Table, Tag, Timeline, Typography } from 'antd';
import { message } from '../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { ClockCircleOutlined, CommentOutlined, FieldTimeOutlined, FileTextOutlined, ScheduleOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import {
  selectProposalsForAssignee, addClarification, requestDueChange, setEffortHours,
  fetchPriceOfInaction, fetchPriceHistory, setActuals, fetchBudgetVariance,
  type Proposal, type PriceOfInaction, type PriceHistory, type BudgetVariance,
} from '../store/slices/governanceSlice';
import { BRAND, RAG, ragToken, solidTagStyle } from '../theme/ragPalette';
import { premiumCard, accentDot, pageContainer, pageTitle, GOLD, SPACE } from '../theme/premium';
import { numericColumn, numericText, sorterFor } from '../theme/table';

const { Title, Text, Paragraph } = Typography;

const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};
const TODAY = new Date(2026, 5, 26).getTime();

// Резерв под 2-строчный заголовок KPI-плитки (см. использование ниже) — держит значение
// на одной высоте у всех плиток ряда независимо от длины конкретного заголовка.
const KPI_TITLE_STYLE: React.CSSProperties = { minHeight: 40, color: BRAND.inkSoft, fontSize: 14 };

// Приоритет для сортировки по статусу — просроченное впереди, выполненное в хвосте (наглядно
// для исполнителя: что горит сильнее всего). statusTag использует тот же порядок условий.
const statusRank = (p: Proposal): number => {
  if (p.execution === 'DONE') return 4;
  if (p.execution === 'NOT_DONE') return 3;
  const d = parseRu(p.dueDate);
  if (d && d.getTime() < TODAY) return 0;
  if (p.status === 'APPROVED') return 2;
  return 1;
};

const statusTag = (p: Proposal) => {
  if (p.execution === 'DONE') return <Tag color="green">выполнено</Tag>;
  if (p.execution === 'NOT_DONE') return <Tag color="red">не выполнено</Tag>;
  const d = parseRu(p.dueDate);
  if (d && d.getTime() < TODAY) return <Tag color="red">просрочено</Tag>;
  if (p.status === 'APPROVED') return <Tag color="blue">в работе</Tag>;
  return <Tag color="gold">ожидает решения</Tag>;
};

const AssigneeTasksPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || '';
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const tasks = useSelector(selectProposalsForAssignee(fullName));

  const [sel, setSel] = useState<Proposal | null>(null);
  const [clarify, setClarify] = useState('');
  const [newDue, setNewDue] = useState<dayjs.Dayjs | null>(null);
  const [justif, setJustif] = useState('');
  const [hours, setHours] = useState<number | null>(null);
  const [savingHours, setSavingHours] = useState(false);
  // ТЗ v19 §17.4/17.8 (УК-49/58): цена неисполнения (Ц_ОМ) — видна, только если выдано право
  // view.measure_economics.own (своя мера) или общее view.risk_economics (менеджмент).
  const canSeeEconomics = permissions.includes('view.measure_economics.own') || permissions.includes('view.risk_economics');
  const [priceOfInaction, setPriceOfInaction] = useState<PriceOfInaction | null>(null);
  // §17.4 (УК-51): «за квартал» — честное среднее по дневной истории (fetchPriceHistory),
  // не переиспользование снимка на просрочку под другой подписью.
  const [priceHistory, setPriceHistory] = useState<PriceHistory | null>(null);
  const [priceHorizon, setPriceHorizon] = useState<'current' | 'quarter'>('current');
  // §17.7 (УК-57): факт по бюджету/трудоёмкости — исполнитель вносит после «выполнено» (execution
  // === DONE), variance считает бэкенд (или live-эквивалент в моке) — не дублируем арифметику тут.
  const [actualCapex, setActualCapex] = useState<number | null>(null);
  const [actualOpex, setActualOpex] = useState<number | null>(null);
  const [actualHours, setActualHours] = useState<number | null>(null);
  const [savingActuals, setSavingActuals] = useState(false);
  const [budgetVariance, setBudgetVariance] = useState<BudgetVariance | null>(null);

  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.execution === 'DONE').length;
    const overdue = tasks.filter((t) => t.execution === 'NOT_DONE' || (t.execution !== 'DONE' && (parseRu(t.dueDate)?.getTime() ?? Infinity) < TODAY)).length;
    return { total: tasks.length, done, overdue, eff: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }, [tasks]);

  const open = (p: Proposal) => {
    setSel(p); setClarify(''); setNewDue(p.dueDate ? dayjs(parseRu(p.dueDate)) : null);
    setJustif(''); setHours(p.effortHours ?? null);
    setPriceOfInaction(null); setPriceHistory(null); setPriceHorizon('current');
    setActualCapex(p.actualCapex ?? null); setActualOpex(p.actualOpex ?? null); setActualHours(p.actualEffortHours ?? null);
    setBudgetVariance(null);
    if (canSeeEconomics) {
      dispatch(fetchPriceOfInaction({ id: p.id })).unwrap()
        .then((r) => {
          setPriceOfInaction(r);
          if (r?.isOverdue) fetchPriceHistory(p.id, 'quarter').then(setPriceHistory).catch(() => setPriceHistory(null));
        })
        .catch(() => setPriceOfInaction(null));
      if (p.execution === 'DONE') {
        fetchBudgetVariance(p.id).then(setBudgetVariance).catch(() => setBudgetVariance(null));
      }
    }
  };

  const submitActuals = async () => {
    if (!sel) return;
    if (actualCapex === null && actualOpex === null && actualHours === null) {
      message.error('Укажите хотя бы одно значение факта (CAPEX, OPEX или часы)');
      return;
    }
    setSavingActuals(true);
    try {
      const updated = await dispatch(setActuals({
        id: sel.id,
        capex: actualCapex ?? undefined,
        opex: actualOpex ?? undefined,
        effortHours: actualHours ?? undefined,
      })).unwrap();
      message.success('Факт по бюджету сохранён');
      if (updated) setSel(updated);
      fetchBudgetVariance(sel.id).then(setBudgetVariance).catch(() => setBudgetVariance(null));
    } catch {
      message.error('Не удалось сохранить факт по бюджету');
    } finally {
      setSavingActuals(false);
    }
  };

  const submitHours = async () => {
    if (!sel) return;
    if (hours === null || hours <= 0) { message.error('Укажите трудоёмкость в часах — больше нуля'); return; }
    setSavingHours(true);
    try {
      const updated = await dispatch(setEffortHours({ id: sel.id, effortHours: hours })).unwrap();
      message.success('Трудоёмкость сохранена');
      if (updated) setSel(updated);
    } catch {
      message.error('Не удалось сохранить трудоёмкость');
    } finally {
      setSavingHours(false);
    }
  };

  const submitClarify = () => {
    if (!sel || !clarify.trim()) { message.error('Введите текст уточнения'); return; }
    dispatch(addClarification({ id: sel.id, text: clarify.trim(), by: fullName }));
    message.success('Уточнение отправлено менеджеру по качеству');
    setClarify('');
    setSel((s) => (s ? { ...s, clarifications: [...(s.clarifications ?? []), { at: new Date().toISOString(), by: fullName, text: clarify.trim() }] } : s));
  };

  const submitDue = () => {
    if (!sel) return;
    if (!newDue) { message.error('Выберите предлагаемый срок'); return; }
    if (!justif.trim()) { message.error('Укажите обоснование переноса срока'); return; }
    const proposedDate = newDue.format('DD.MM.YYYY');
    dispatch(requestDueChange({ id: sel.id, proposedDate, justification: justif.trim(), by: fullName }));
    message.success('Запрос на перенос срока отправлен менеджеру по качеству');
    setSel(null);
  };

  const columns: ColumnsType<Proposal> = [
    { title: 'Поручение', dataIndex: 'riskTitle', sorter: sorterFor((r: Proposal) => r.riskTitle || r.metricName),
      render: (v: string, r) => (
      <div>
        <Text strong style={{ color: BRAND.ink }}>{v || r.metricName}</Text>
        <div style={{ fontSize: 12, color: BRAND.inkSoft }}>{r.systemName} · {r.characteristic}</div>
      </div>
    ) },
    numericColumn<Proposal>({ title: 'Балл', dataIndex: 'calculatedScore', width: 76,
      sorter: sorterFor((r: Proposal) => r.calculatedScore),
      render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag> }),
    { title: 'Срок', dataIndex: 'dueDate', width: 116,
      sorter: sorterFor((r: Proposal) => parseRu(r.dueDate)?.getTime() ?? null),
      render: (v: string, r) => (
      <Space direction="vertical" size={0}>
        <Text>{v || '—'}</Text>
        {r.dueChangeRequest?.status === 'PENDING' && <Tag color="gold" style={{ marginInlineEnd: 0 }}>перенос на рассмотрении</Tag>}
        {r.dueChangeRequest?.status === 'ACCEPTED' && <Tag color="green" style={{ marginInlineEnd: 0 }}>перенос принят</Tag>}
        {r.dueChangeRequest?.status === 'DECLINED' && <Tag color="red" style={{ marginInlineEnd: 0 }}>перенос отклонён</Tag>}
      </Space>
    ) },
    { title: 'Статус', key: 'status', width: 130, sorter: sorterFor((r: Proposal) => statusRank(r)),
      render: (_: unknown, r) => statusTag(r) },
    numericColumn<Proposal>({ title: 'Часы', dataIndex: 'effortHours', width: 84,
      sorter: sorterFor((r: Proposal) => r.effortHours),
      render: (v: number | undefined) => (v ? <Text>{v} ч</Text> : <Text type="secondary">—</Text>) }),
    numericColumn<Proposal>({ title: 'Уточнения', key: 'clar', width: 96,
      sorter: sorterFor((r: Proposal) => r.clarifications?.length ?? 0),
      render: (_: unknown, r) => (r.clarifications?.length ? <Tag icon={<CommentOutlined />}>{r.clarifications.length}</Tag> : <Text type="secondary">—</Text>) }),
  ];

  return (
    <div style={pageContainer}>
      <Row align="middle" justify="space-between" wrap gutter={[12, 8]}>
        <Col>
          <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Мои задачи</Title>
          <Text type="secondary">Поручения, назначенные на вас ({fullName}). Уточнения и предложения по срокам направляются менеджеру по качеству.</Text>
        </Col>
        {permissions.includes('view.dashboard.taskplan') && (
          <Col>
            <Button onClick={() => navigate('/dashboard/taskplan')}>Открыть в плане задач →</Button>
          </Col>
        )}
      </Row>

      {/* Выравнивание цифр: заголовки разной длины («Просрочено / не выполнено» против
          «Выполнено») переносились по-разному, и значение у каждой плитки съезжало на свою
          высоту — цифры 9/2/1/22% не стояли на одной линии по ряду. minHeight на заголовке
          резервирует место под двухстрочный вариант ВСЕГДА, а не только когда он реально
          нужен — тогда значение стартует с одной и той же высоты у всех плиток ряда, плюс
          табличные цифры (numericText), как и в остальном приложении. */}
      <Row gutter={[16, 16]} style={{ margin: '16px 0' }}>
        <Col xs={12} md={6}><div {...premiumCard()}>
          <Statistic title={<div style={KPI_TITLE_STYLE}>Всего поручений</div>} value={stats.total} valueStyle={numericText} />
        </div></Col>
        <Col xs={12} md={6}><div {...premiumCard()}>
          <Statistic title={<div style={KPI_TITLE_STYLE}>Выполнено</div>} value={stats.done} valueStyle={{ color: RAG.good.strong, ...numericText }} />
        </div></Col>
        <Col xs={12} md={6}><div {...premiumCard()}>
          <Statistic title={<div style={KPI_TITLE_STYLE}>Просрочено / не выполнено</div>} value={stats.overdue} valueStyle={{ color: stats.overdue ? RAG.bad.strong : undefined, ...numericText }} />
        </div></Col>
        <Col xs={12} md={6}><div {...premiumCard()}>
          <Statistic title={<div style={KPI_TITLE_STYLE}>Личная эффективность</div>} value={stats.eff} suffix="%" valueStyle={{ color: ragToken(stats.eff).strong, ...numericText }} />
        </div></Col>
      </Row>

      {tasks.length === 0 ? (
        <Empty description="На вас пока не назначено поручений" style={{ padding: 48 }} />
      ) : (
        <Table<Proposal>
          rowKey="id"
          columns={columns}
          dataSource={tasks}
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => open(r), style: { cursor: 'pointer' } })}
          scroll={{ x: 720 }}
        />
      )}

      <Modal open={!!sel} onCancel={() => setSel(null)} footer={null} width={640} title={sel ? (sel.riskTitle || sel.metricName) : ''}>
        {sel && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{sel.systemName}</Tag>
              <Tag>{sel.characteristic}</Tag>
              {statusTag(sel)}
            </Space>

            {/* ТЗ v19 §17.4 (УК-49/51): цена неисполнения (Ц_ОМ) — только при наличии права
                view.measure_economics.own/view.risk_economics (§17.8, УК-58) и только для
                просроченных мер (иначе показывать нечего — «неисполнения» ещё не произошло). */}
            {canSeeEconomics && priceOfInaction?.isOverdue && (
              <Alert
                type="error"
                showIcon
                icon={<WarningOutlined />}
                message="Цена неисполнения (Ц_ОМ)"
                description={
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {priceHistory && (
                      <Radio.Group size="small" value={priceHorizon} onChange={(e) => setPriceHorizon(e.target.value)}>
                        <Radio.Button value="current">На сегодня</Radio.Button>
                        <Radio.Button value="quarter">За квартал (среднее)</Radio.Button>
                      </Radio.Group>
                    )}
                    <Text strong style={{ fontSize: 18, color: RAG.bad.strong }}>
                      {(
                        (priceHorizon === 'quarter' ? priceHistory?.periodAvg : priceOfInaction.priceCurrent) ?? 0
                      ).toLocaleString('ru-RU')} ₽
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {sel.measureType === 'COMPENSATING'
                        ? 'Компенсирующая мера: фактический ущерб по связанным сбоям с момента просрочки, не доля риска (§17.4).'
                        : 'Деньги под риском, которые остаются незакрытыми, пока мера не выполнена (§17.4).'}
                      {priceOfInaction.priceCurrentAt && priceHorizon === 'current' && (
                        <> Пересчитано: {dayjs(priceOfInaction.priceCurrentAt).format('DD.MM.YYYY')}.</>
                      )}
                      {priceHorizon === 'quarter' && priceHistory && (
                        <> Среднее по {priceHistory.points.length} дн. текущего квартала.</>
                      )}
                    </Text>
                  </Space>
                }
              />
            )}

            {/* ТЗ v19 п.16: переписано менеджером по качеству на язык исполнителя — конкретные
                шаги вместо профсуждения ниже. Показываем первым, обоснование — деталь под ним. */}
            {sel.executorBrief && (
              <div style={{ background: BRAND.surfaceSoft, borderRadius: 8, padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}><FileTextOutlined /> Что сделать</Text>
                <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{sel.executorBrief}</Paragraph>
              </div>
            )}
            <div><Text type="secondary">Метрика: </Text><Text>{sel.metricName}</Text></div>
            <div><Text type="secondary">Обоснование меры</Text><Paragraph style={{ marginBottom: 0 }}>{sel.rationale}</Paragraph></div>
            <div><Text type="secondary">Текущий срок: </Text><Text strong>{sel.dueDate || '—'}</Text></div>

            {/* Трудоёмкость в часах (ТЗ v19 п.13, В-41) — проставляет исполнитель вручную,
                видна в нагрузке/балансировке у менеджера по качеству (RiskEconomicsPage). */}
            {sel.status === 'APPROVED' && (
              <div>
                <Text type="secondary"><ClockCircleOutlined /> Трудоёмкость (часы, ваша оценка)</Text>
                <Space style={{ marginTop: 8 }}>
                  <InputNumber<number> min={0.5} step={0.5} value={hours}
                    onChange={(v) => setHours(typeof v === 'number' ? v : null)}
                    placeholder="Например, 8 ч" style={{ width: 140 }} />
                  <Button type="primary" loading={savingHours} onClick={submitHours}>
                    {sel.effortHours ? 'Обновить' : 'Сохранить'}
                  </Button>
                </Space>
                {sel.effortHoursSetAt && (
                  <div style={{ fontSize: 11, color: BRAND.inkSoft, marginTop: 4 }}>
                    Оценено: {dayjs(sel.effortHoursSetAt).format('DD.MM.YYYY HH:mm')}
                  </div>
                )}
              </div>
            )}

            {/* §17.7 (УК-57): факт по бюджету/трудоёмкости — вносит исполнитель после «выполнено»,
                variance (факт − план) считает бэкенд, не дублируем арифметику на фронте. */}
            {sel.execution === 'DONE' && canSeeEconomics && (
              <div>
                <Text type="secondary"><FieldTimeOutlined /> Факт по бюджету и трудоёмкости</Text>
                <Row gutter={8} style={{ marginTop: 8 }}>
                  <Col span={8}>
                    <InputNumber<number> min={0} value={actualCapex} onChange={(v) => setActualCapex(typeof v === 'number' ? v : null)}
                      placeholder="CAPEX, ₽" style={{ width: '100%' }} />
                  </Col>
                  <Col span={8}>
                    <InputNumber<number> min={0} value={actualOpex} onChange={(v) => setActualOpex(typeof v === 'number' ? v : null)}
                      placeholder="OPEX/год, ₽" style={{ width: '100%' }} />
                  </Col>
                  <Col span={8}>
                    <InputNumber<number> min={0} step={0.5} value={actualHours} onChange={(v) => setActualHours(typeof v === 'number' ? v : null)}
                      placeholder="Часы факт" style={{ width: '100%' }} />
                  </Col>
                </Row>
                <Button style={{ marginTop: 8 }} type="primary" loading={savingActuals} onClick={submitActuals}>
                  {sel.actualsSetAt ? 'Обновить факт' : 'Сохранить факт'}
                </Button>
                {budgetVariance && (budgetVariance.capexVariance != null || budgetVariance.opexVariance != null || budgetVariance.effortVariance != null) && (
                  <Space direction="vertical" size={2} style={{ marginTop: 8, width: '100%' }}>
                    {budgetVariance.capexVariance != null && (
                      <Text style={{ fontSize: 12, color: budgetVariance.capexVariance > 0 ? RAG.bad.strong : RAG.good.strong }}>
                        CAPEX: {budgetVariance.capexVariance > 0 ? 'перерасход' : 'экономия'} {Math.abs(budgetVariance.capexVariance).toLocaleString('ru-RU')} ₽
                      </Text>
                    )}
                    {budgetVariance.opexVariance != null && (
                      <Text style={{ fontSize: 12, color: budgetVariance.opexVariance > 0 ? RAG.bad.strong : RAG.good.strong }}>
                        OPEX/год: {budgetVariance.opexVariance > 0 ? 'перерасход' : 'экономия'} {Math.abs(budgetVariance.opexVariance).toLocaleString('ru-RU')} ₽
                      </Text>
                    )}
                    {budgetVariance.effortVariance != null && (
                      <Text style={{ fontSize: 12, color: budgetVariance.effortVariance > 0 ? RAG.bad.strong : RAG.good.strong }}>
                        Трудоёмкость: {budgetVariance.effortVariance > 0 ? 'перерасход' : 'экономия'} {Math.abs(budgetVariance.effortVariance)} ч
                      </Text>
                    )}
                  </Space>
                )}
              </div>
            )}

            {/* Ранее внесённые уточнения */}
            {(sel.clarifications?.length ?? 0) > 0 && (
              <div>
                <Text strong><CommentOutlined /> Мои уточнения</Text>
                <Timeline style={{ marginTop: 8 }} items={(sel.clarifications ?? []).map((c) => ({
                  children: <><Text>{c.text}</Text><div style={{ fontSize: 11, color: BRAND.inkSoft }}>{dayjs(c.at).format('DD.MM.YYYY HH:mm')} · {c.by}</div></>,
                }))} />
              </div>
            )}

            {/* Уточнение по метрике/поручению */}
            <div>
              <Text type="secondary"><CommentOutlined /> Уточнение по метрике / поручению (уйдёт менеджеру по качеству)</Text>
              <Input.TextArea rows={2} value={clarify} onChange={(e) => setClarify(e.target.value)} placeholder="Например: метрика посчитана без учёта планового окна; фактический показатель выше…" />
              <Button style={{ marginTop: 8 }} icon={<CommentOutlined />} onClick={submitClarify}>Отправить уточнение</Button>
            </div>

            {/* Предложение нового срока */}
            <div>
              <Text type="secondary"><FieldTimeOutlined /> Предложить новый срок с обоснованием</Text>
              {sel.dueChangeRequest && sel.dueChangeRequest.status !== 'PENDING' && (
                <Alert
                  style={{ margin: '8px 0' }}
                  type={sel.dueChangeRequest.status === 'ACCEPTED' ? 'success' : 'warning'}
                  showIcon
                  message={`Предыдущий запрос (${sel.dueChangeRequest.proposedDate}) — ${sel.dueChangeRequest.status === 'ACCEPTED' ? 'принят' : 'отклонён'} менеджером по качеству`}
                  description={sel.dueChangeRequest.decisionComment}
                />
              )}
              {sel.dueChangeRequest?.status === 'PENDING' ? (
                <Alert style={{ marginTop: 8 }} type="info" showIcon
                  message={`Запрос на перенос срока на ${sel.dueChangeRequest.proposedDate} направлен и ожидает решения менеджера по качеству`}
                  description={sel.dueChangeRequest.justification} />
              ) : (
                <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={8}>
                  <DatePicker value={newDue} onChange={setNewDue} format="DD.MM.YYYY" style={{ width: 200 }} placeholder="Новый срок" />
                  <Input.TextArea rows={2} value={justif} onChange={(e) => setJustif(e.target.value)} placeholder="Обоснование переноса срока (причина, риски, что требуется)…" />
                  <Button type="primary" icon={<ScheduleOutlined />} onClick={submitDue}>Предложить срок менеджеру по качеству</Button>
                </Space>
              )}
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default AssigneeTasksPage;
