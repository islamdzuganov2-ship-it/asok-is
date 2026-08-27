/**
 * MyTasksScope.tsx — общее состояние карточек «Мои задачи» (роль «Исполнитель», ТЗ v17 req 6).
 *
 * Выборка поручений (owner = ФИО пользователя) нужна и плиткам, и таблице, а карточка поручения
 * со всеми действиями исполнителя (уточнение, запрос переноса срока, трудоёмкость, факт по
 * бюджету) открывается из таблицы — всё это здесь, чтобы карточки можно было разнести по разным
 * дашбордам, не потеряв поведение.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { Alert, Button, Col, DatePicker, Input, InputNumber, Modal, Radio, Row, Space, Tag, Timeline, Typography } from 'antd';
import { message } from '../../theme/appMessage';
import { ClockCircleOutlined, CommentOutlined, FieldTimeOutlined, FileTextOutlined, ScheduleOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { useAppDispatch } from '../../store/hooks';
import {
  selectProposalsForAssignee, addClarification, requestDueChange, setEffortHours,
  fetchPriceOfInaction, fetchPriceHistory, setActuals, fetchBudgetVariance,
  type Proposal, type PriceOfInaction, type PriceHistory, type BudgetVariance,
} from '../../store/slices/governanceSlice';
import { BRAND, RAG } from '../../theme/ragPalette';

const { Text, Paragraph } = Typography;

const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};
const TODAY = new Date(2026, 5, 26).getTime();

/** Приоритет сортировки: просроченное впереди, выполненное в хвосте (что горит сильнее). */
export const statusRank = (p: Proposal): number => {
  if (p.execution === 'DONE') return 4;
  if (p.execution === 'NOT_DONE') return 3;
  const d = parseRu(p.dueDate);
  if (d && d.getTime() < TODAY) return 0;
  if (p.status === 'APPROVED') return 2;
  return 1;
};

export const statusTag = (p: Proposal) => {
  if (p.execution === 'DONE') return <Tag color="green">выполнено</Tag>;
  if (p.execution === 'NOT_DONE') return <Tag color="red">не выполнено</Tag>;
  const d = parseRu(p.dueDate);
  if (d && d.getTime() < TODAY) return <Tag color="red">просрочено</Tag>;
  if (p.status === 'APPROVED') return <Tag color="blue">в работе</Tag>;
  return <Tag color="gold">ожидает решения</Tag>;
};

export const dueMs = (p: Proposal) => parseRu(p.dueDate)?.getTime() ?? null;

interface MyTasksScopeValue {
  fullName: string;
  tasks: Proposal[];
  stats: { total: number; done: number; overdue: number; eff: number };
  openTask: (p: Proposal) => void;
}

const Ctx = createContext<MyTasksScopeValue | null>(null);

export function useMyTasksScope(): MyTasksScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка «Мои задачи» отрисована вне MyTasksScope');
  return v;
}

export const MyTasksScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || '';
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const tasks = useSelector(selectProposalsForAssignee(fullName));

  const [sel, setSel] = useState<Proposal | null>(null);
  const [clarify, setClarify] = useState('');
  const [newDue, setNewDue] = useState<dayjs.Dayjs | null>(null);
  const [justif, setJustif] = useState('');
  const [hours, setHours] = useState<number | null>(null);
  const [savingHours, setSavingHours] = useState(false);
  // §17.4/17.8 (УК-49/58): цена неисполнения видна только по праву.
  const canSeeEconomics = permissions.includes('view.measure_economics.own') || permissions.includes('view.risk_economics');
  const [priceOfInaction, setPriceOfInaction] = useState<PriceOfInaction | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistory | null>(null);
  const [priceHorizon, setPriceHorizon] = useState<'current' | 'quarter'>('current');
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

  const openTask = (p: Proposal) => {
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

  return (
    <Ctx.Provider value={{ fullName, tasks, stats, openTask }}>
      {children}
      <Modal open={!!sel} onCancel={() => setSel(null)} footer={null} width={640} title={sel ? (sel.riskTitle || sel.metricName) : ''}>
        {sel && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{sel.systemName}</Tag>
              <Tag>{sel.characteristic}</Tag>
              {statusTag(sel)}
            </Space>

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
                      {((priceHorizon === 'quarter' ? priceHistory?.periodAvg : priceOfInaction.priceCurrent) ?? 0).toLocaleString('ru-RU')} ₽
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

            {sel.executorBrief && (
              <div style={{ background: BRAND.surfaceSoft, borderRadius: 8, padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}><FileTextOutlined /> Что сделать</Text>
                <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{sel.executorBrief}</Paragraph>
              </div>
            )}
            <div><Text type="secondary">Метрика: </Text><Text>{sel.metricName}</Text></div>
            <div><Text type="secondary">Обоснование меры</Text><Paragraph style={{ marginBottom: 0 }}>{sel.rationale}</Paragraph></div>
            <div><Text type="secondary">Текущий срок: </Text><Text strong>{sel.dueDate || '—'}</Text></div>

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

            {(sel.clarifications?.length ?? 0) > 0 && (
              <div>
                <Text strong><CommentOutlined /> Мои уточнения</Text>
                <Timeline style={{ marginTop: 8 }} items={(sel.clarifications ?? []).map((c) => ({
                  children: <><Text>{c.text}</Text><div style={{ fontSize: 11, color: BRAND.inkSoft }}>{dayjs(c.at).format('DD.MM.YYYY HH:mm')} · {c.by}</div></>,
                }))} />
              </div>
            )}

            <div>
              <Text type="secondary"><CommentOutlined /> Уточнение по метрике / поручению (уйдёт менеджеру по качеству)</Text>
              <Input.TextArea rows={2} value={clarify} onChange={(e) => setClarify(e.target.value)} placeholder="Например: метрика посчитана без учёта планового окна; фактический показатель выше…" />
              <Button style={{ marginTop: 8 }} icon={<CommentOutlined />} onClick={submitClarify}>Отправить уточнение</Button>
            </div>

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
    </Ctx.Provider>
  );
};

export const MyTasksScopeToolbar: React.FC = () => null;
