/**
 * MeasureDecisionModal.tsx — карточка меры качества с принятием решения.
 *
 * Открывается по клику на меру (в управленческом дашборде / реестре). Показывает
 * полный контекст меры и, если она ожидает решения, даёт топ-менеджменту
 * одобрить/отклонить с обязательной возможностью оставить комментарий-обоснование.
 * Для уже решённых мер показывает решение и комментарий ЛПР (read-only).
 *
 * Топ-менеджмент может ВНОСИТЬ ПРАВКИ в меру (кнопка «Внести правки»): название, обоснование,
 * ожидание от ЛПР, ответственный, срок. Каждая правка пишется в историю изменений (аудит),
 * которая открывается кнопкой-иконкой (только иконка истории, без текста).
 */
import React, { useEffect, useState } from 'react';
import { Modal, Typography, Tag, Input, Button, Space, Divider, List, Tooltip, Empty } from 'antd';
import { message } from '../theme/appMessage';
import { CheckOutlined, CloseOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../store/hooks';
import { RootState } from '../store';
import {
  approveProposal, rejectProposal, setExecution, updateProposalMeta, editProposal,
  type EditableProposalFields, type Proposal, type ProposalStatus,
} from '../store/slices/governanceSlice';
import { DollarOutlined, FileTextOutlined } from '@ant-design/icons';
import { ragToken, solidTagStyle, RAG, ACCENT } from '../theme/ragPalette';
import { SPACE, TYPE } from '../theme/premium';
import { fmtMoney, fmtNum } from '../utils/money';
import { MeasureCardExtras } from './MeasureCardExtras';
import FieldHint from './FieldHint';

// ТЗ v19 п.14: карточка меры на языке топ-менеджмента (что не так → деньги/срок → решение →
// стоимость → результат → ответственный), ≤80 слов, без формул — считает бэкенд
// (governance/management_summary.py, персона TOP_MANAGER). Кэш по мере не нужен: бэкенд уже
// кэширует по содержимому факта (llm/service.py generate_management_summary).
interface ManagementSummary {
  text: string;
  wordCount: number;
  hasMoney: boolean;
  hasDeadline: boolean;
  hasResponsible: boolean;
  missing: string[];
}

const { Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// ТЗ v19 п.15: горизонт/ставка ROSI читаются из /econ/config (EconConfig — редактируется без
// деплоя, backend/app/modules/econ/service.py). Модуль-уровневый кэш — параметр общий для всех
// мер и не меняется на лету, повторный фетч на каждое открытие карточки не нужен.
let horizonCache: { months: number; rate: number } | null = null;
async function fetchRosiHorizon(): Promise<{ months: number; rate: number } | null> {
  if (horizonCache) return horizonCache;
  try {
    const token = localStorage.getItem('token');
    const r = await fetch(`${VITE_API}/econ/config`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) return null;
    const items: { key: string; value: unknown }[] = await r.json();
    const months = items.find((i) => i.key === 'rosi_horizon_months')?.value;
    const rate = items.find((i) => i.key === 'discount_rate_annual')?.value;
    if (typeof months === 'number' && typeof rate === 'number') {
      horizonCache = { months, rate };
      return horizonCache;
    }
  } catch { /* необязательная подпись — тихо остаёмся без неё, ROSI-число всё равно верное */ }
  return null;
}

const MEASURE_TYPE_LABEL: Record<string, string> = {
  ELIMINATING: 'Устраняющая (снимает первопричину)',
  COMPENSATING: 'Компенсирующая (снижает ущерб/вероятность)',
};
const VERDICT_LABEL: Record<string, { label: string; color: string }> = {
  ELIMINATE: { label: 'Устранить', color: 'green' },
  COMPENSATE: { label: 'Компенсировать', color: 'gold' },
  ACCEPT: { label: 'Принять риск', color: 'default' },
};

const STATUS_TAG: Record<ProposalStatus, { color: string; label: string }> = {
  PENDING_APPROVAL: { color: 'gold', label: 'Ожидает решения' },
  APPROVED: { color: 'green', label: 'Одобрена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
};

// Человекочитаемые названия полей для истории правок (аудита).
const FIELD_LABELS: Record<string, string> = {
  riskTitle: 'Название меры/риска',
  rationale: 'Обоснование',
  expectation: 'Ожидание от ЛПР',
  owner: 'Ответственный',
  ownerRole: 'Должность ответственного',
  dueDate: 'Срок',
  topComment: 'Комментарий топ-менеджера',
};

interface Props {
  open: boolean;
  proposal: Proposal | null;
  onClose: () => void;
}

const Field: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: SPACE.cozy }}>
    <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>{label}</Text>
    <div>{children}</div>
  </div>
);

const fmtTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export const MeasureDecisionModal: React.FC<Props> = ({ open, proposal, onClose }) => {
  const dispatch = useAppDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Топ-менеджмент';
  const role = useSelector((s: RootState) => s.auth.role) || '';
  // Свежая версия меры из стора (после правок/решений пропс может устареть).
  const current = useSelector((s: RootState) =>
    proposal ? s.governance.proposals.find((x) => x.id === proposal.id) ?? proposal : null);
  const [comment, setComment] = useState('');
  const [execComment, setExecComment] = useState('');
  const [horizon, setHorizon] = useState<{ months: number; rate: number } | null>(horizonCache);
  useEffect(() => {
    if (open && !horizon) { fetchRosiHorizon().then(setHorizon); }
  }, [open, horizon]);
  const [mgmtSummary, setMgmtSummary] = useState<ManagementSummary | null>(null);
  const [mgmtLoading, setMgmtLoading] = useState(false);
  useEffect(() => {
    if (!open || !proposal?.id) { setMgmtSummary(null); return; }
    let alive = true;
    setMgmtLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/governance/proposals/${proposal.id}/management-summary`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setMgmtSummary(d); })
      .catch(() => { if (alive) setMgmtSummary(null); })
      .finally(() => { if (alive) setMgmtLoading(false); });
    return () => { alive = false; };
  }, [open, proposal?.id]);
  // Редактируемые топ-менеджментом поля (ответственный/срок) до принятия решения.
  const [editOwner, setEditOwner] = useState('');
  const [editOwnerRole, setEditOwnerRole] = useState('');
  const [editDue, setEditDue] = useState('');
  // Режим «Внести правки» (топ-менеджер) + буфер правок; история — отдельная модалка.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<EditableProposalFields>>({});
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    setComment(''); setExecComment('');
    setEditOwner(proposal?.owner || '');
    setEditOwnerRole(proposal?.ownerRole || '');
    setEditDue(proposal?.dueDate || '');
    setEditing(false); setDraft({}); setHistoryOpen(false);
  }, [proposal?.id]);

  if (!current) return null;
  const p = current;
  const isPending = p.status === 'PENDING_APPROVAL';
  const isApproved = p.status === 'APPROVED';
  // Отчёт о выполнении (закрытие меры) — зона ответственности ТОЛЬКО менеджера по качеству (SoD, ТЗ v12).
  const canReportExecution = role === 'QUALITY_MANAGER';
  // Согласование работ по мере (одобрить/отклонить) — ТОЛЬКО топ-менеджмент (ADMIN-уровень) (SoD, ТЗ v12).
  const canDecide = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);
  // Менять ответственного/срок перед решением может топ-менеджмент (ЛПР).
  const canEditMeta = canDecide;
  // Вносить правки в меру (с аудитом) — топ-менеджмент, на любом статусе.
  const canEdit = canDecide;
  // ТЗ v19 §17.3: системность/альтернативы ведёт менеджер по качеству (governance.propose).
  const canManageCard = role === 'QUALITY_MANAGER';
  // §17.6 (УК-56): обязательное ревью LLM-рекомендации — QUALITY_MANAGER или RISK_MANAGER.
  const canReviewLlm = role === 'QUALITY_MANAGER' || role === 'RISK_MANAGER';
  const st = STATUS_TAG[p.status];
  const tok = ragToken(p.calculatedScore);
  const history = p.history ?? [];

  // ТЗ v19 п.7/11: экономика меры — ΔALE суммарно, окупаемость (простая, номинальная — НЕ
  // подменяет дисконтированный ROSI с бэкенда, это отдельная, более понятная топ-менеджменту
  // оценка «через сколько лет отобьётся CAPEX при текущем годовом эффекте минус OPEX»).
  const hasEconomics = p.capex != null || p.opexPerYear != null || p.rosi != null
    || p.deltaAleCash != null || p.deltaAleDeferred != null || p.deltaAleCapacity != null;
  const totalDeltaAle = (p.deltaAleCash ?? 0) + (p.deltaAleDeferred ?? 0) + (p.deltaAleCapacity ?? 0);
  const netAnnualBenefit = (p.deltaAleCash ?? 0) - (p.opexPerYear ?? 0);
  const paybackYears = p.capex && netAnnualBenefit > 0 ? p.capex / netAnnualBenefit : null;

  const decide = (action: typeof approveProposal | typeof rejectProposal) => {
    if (isPending && canEditMeta) {
      dispatch(updateProposalMeta({
        id: p.id,
        owner: editOwner.trim(),
        ownerRole: editOwnerRole.trim(),
        dueDate: editDue.trim() || undefined,
      }));
    }
    dispatch(action({ id: p.id, by: fullName, comment: comment.trim() || undefined }));
    onClose();
  };

  const reportExecution = (statusValue: 'DONE' | 'NOT_DONE') => {
    if (!execComment.trim()) {
      message.error('Комментарий обязателен: укажите, как выполнено или почему не выполнено');
      return;
    }
    dispatch(setExecution({ id: p.id, status: statusValue, comment: execComment.trim(), by: fullName }));
    onClose();
  };

  const startEdit = () => {
    setDraft({
      riskTitle: p.riskTitle || '',
      rationale: p.rationale,
      expectation: p.expectation,
      owner: p.owner || '',
      ownerRole: p.ownerRole || '',
      dueDate: p.dueDate || '',
    });
    setEditing(true);
  };

  const saveEdit = () => {
    dispatch(editProposal({ id: p.id, by: `${fullName}${role ? ` (${role})` : ''}`, patch: draft }));
    setEditing(false);
    message.success('Правки сохранены и записаны в историю изменений');
  };

  const setD = (field: keyof EditableProposalFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }));

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={540}
      title={
        <Space style={{ width: '100%', justifyContent: 'space-between', paddingRight: 24 }}>
          <Space>
            <Text strong>{p.riskTitle || p.metricName}</Text>
            <Tag color={st.color}>{st.label}</Tag>
          </Space>
          <Space size={4}>
            {canEdit && !editing && (
              <Button size="small" icon={<EditOutlined />} onClick={startEdit}>Внести правки</Button>
            )}
            <Tooltip title="История изменений (аудит)">
              <Button
                size="small"
                type="text"
                aria-label="История изменений"
                icon={<HistoryOutlined />}
                onClick={() => setHistoryOpen(true)}
              />
            </Tooltip>
          </Space>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag>{p.systemName}</Tag>
        <Tag>{p.characteristic}</Tag>
        <Tag style={solidTagStyle(tok.strong)}>{p.calculatedScore}%</Tag>
      </Space>

      {(mgmtLoading || mgmtSummary?.text) && (
        <div style={{
          background: '#F5F6F8', borderRadius: 8, padding: 12, marginBottom: 12,
          borderInlineStart: `3px solid ${ACCENT.slate.color}`,
        }}>
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
            <FileTextOutlined /> Для топ-менеджмента
          </Text>
          {mgmtLoading ? (
            <Paragraph style={{ marginBottom: 0, marginTop: 4 }} type="secondary">Готовится…</Paragraph>
          ) : (
            <>
              <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{mgmtSummary!.text}</Paragraph>
              {mgmtSummary!.missing.length > 0 && (
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block', marginTop: 4 }}>
                  Не заполнено на мере: {mgmtSummary!.missing.join(', ')} — цифры ниже неполные, не нулевые.
                </Text>
              )}
            </>
          )}
        </div>
      )}

      {hasEconomics && (
        <div style={{ background: '#F5F6F8', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
            <DollarOutlined /> Экономика меры
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
            {p.capex != null && (
              <div>
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block' }}>CAPEX</Text>
                <Text strong>{fmtMoney(p.capex)}</Text>
              </div>
            )}
            {p.opexPerYear != null && (
              <div>
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block' }}>OPEX/год</Text>
                <Text strong>{fmtMoney(p.opexPerYear)}</Text>
              </div>
            )}
            {(p.deltaAleCash != null || p.deltaAleDeferred != null || p.deltaAleCapacity != null) && (
              <div>
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block' }}>ΔALE/год (снижение риска)</Text>
                <Text strong style={{ color: RAG.good.strong }}>{fmtMoney(totalDeltaAle)}</Text>
              </div>
            )}
            {p.rosi != null && (
              <div>
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block' }}>
                  ROSI{horizon ? ` за ${Math.round(horizon.months / 12 * 10) / 10} г.` : ''}
                </Text>
                <Text strong style={{ color: p.rosi >= 0 ? RAG.good.strong : RAG.bad.strong }}>{fmtNum(p.rosi, 2)}</Text>
              </div>
            )}
            {paybackYears != null && (
              <div>
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block' }}>Окупаемость</Text>
                <Text strong>{fmtNum(paybackYears, 1)} лет</Text>
              </div>
            )}
          </div>
          {p.rosi != null && horizon && (
            <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block', marginTop: 4 }}>
              ROSI и окупаемость — за горизонт {horizon.months} мес. под ставку дисконтирования {Math.round(horizon.rate * 100)}%/год
              (параметр контура, меняется без релиза)
            </Text>
          )}
          {(p.deltaAleCash != null || p.deltaAleDeferred != null || p.deltaAleCapacity != null) && (
            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize, display: 'block', marginTop: 6 }}>
              из них: касса {fmtMoney(p.deltaAleCash)} · отложенная {fmtMoney(p.deltaAleDeferred)} · высвобожденная мощность {fmtMoney(p.deltaAleCapacity)}
            </Text>
          )}
          <Space wrap style={{ marginTop: 8 }}>
            {p.measureType && <Tag color={ACCENT.slate.color}>{MEASURE_TYPE_LABEL[p.measureType] ?? p.measureType}</Tag>}
            {p.verdict && VERDICT_LABEL[p.verdict] && (
              <Tag color={VERDICT_LABEL[p.verdict].color}>Вердикт: {VERDICT_LABEL[p.verdict].label}</Tag>
            )}
            {!p.verdict && p.recommendedVerdict && VERDICT_LABEL[p.recommendedVerdict] && (
              <Tag>Рекомендовано: {VERDICT_LABEL[p.recommendedVerdict].label}</Tag>
            )}
          </Space>
        </div>
      )}

      {/* ТЗ v19 §17.3/17.4/17.6: LLM-ревью, цена неисполнения, системность/направление/альтернативы. */}
      <MeasureCardExtras proposal={p} canManageCard={canManageCard} canReviewLlm={canReviewLlm} />

      {editing ? (
        <>
          <Field label={<FieldHint title="Краткая формулировка меры или риска, к которому она относится.">Название меры/риска</FieldHint>}>
            <Input value={draft.riskTitle} onChange={setD('riskTitle')} />
          </Field>
          <Field label={<FieldHint title="Почему нужна эта мера: факт → причина → влияние на качество.">Обоснование (профессиональное суждение)</FieldHint>}>
            <Input.TextArea rows={3} value={draft.rationale} onChange={setD('rationale')} />
          </Field>
          <Field label={<FieldHint title="Что конкретно должен сделать/решить ЛПР (топ-менеджмент) по этой мере и почему это важно.">Что ожидается от ЛПР и почему</FieldHint>}>
            <Input.TextArea rows={2} value={draft.expectation} onChange={setD('expectation')} />
          </Field>
          <Field label={<FieldHint title="Кто исполняет меру, в какой должности и к какому сроку — попадает в «Мои задачи» и на диаграмму Ганта.">Ответственный / должность / срок</FieldHint>}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Input value={draft.owner} onChange={setD('owner')} placeholder="ФИО ответственного" />
              <Input value={draft.ownerRole} onChange={setD('ownerRole')} placeholder="Должность ответственного" />
              <Input value={draft.dueDate} onChange={setD('dueDate')} placeholder="Срок выполнения (ДД.ММ.ГГГГ)" />
            </Space>
          </Field>
          <Space style={{ marginTop: 4, marginBottom: 8 }}>
            <Button type="primary" icon={<CheckOutlined />} onClick={saveEdit}>Сохранить правки</Button>
            <Button onClick={() => setEditing(false)}>Отмена</Button>
          </Space>
          <Paragraph type="secondary" style={{ fontSize: TYPE.caption.fontSize, marginBottom: 0 }}>
            Каждое изменение будет записано в историю изменений (аудит) с указанием автора и времени.
          </Paragraph>
        </>
      ) : (
        <>
          <Field label="Метрика">
            <Text>{p.metricName}</Text>
          </Field>
          <Field label="Что ожидается от ЛПР и почему">
            <Text>{p.expectation || '—'}</Text>
          </Field>
          <Field label="Обоснование (профессиональное суждение)">
            <Paragraph style={{ marginBottom: 0 }}>{p.rationale}</Paragraph>
          </Field>
          {isPending && canEditMeta ? (
            <Field label="Ответственный и срок (можно изменить перед решением)">
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} placeholder="ФИО ответственного" />
                <Input value={editOwnerRole} onChange={(e) => setEditOwnerRole(e.target.value)} placeholder="Должность ответственного" />
                <Input value={editDue} onChange={(e) => setEditDue(e.target.value)} placeholder="Срок выполнения (ДД.ММ.ГГГГ)" />
              </Space>
            </Field>
          ) : (p.owner || p.dueDate) ? (
            <Field label="Ответственный / срок">
              <Text>
                {p.owner || '—'}{p.ownerRole ? `, ${p.ownerRole}` : ''}
                {p.dueDate ? ` · до ${p.dueDate}` : ''}
              </Text>
            </Field>
          ) : null}

          <Divider style={{ margin: '12px 0' }} />

          {isPending ? (
            canDecide ? (
              <>
                <Field label="Комментарий к решению (необязательно)">
                  <Input.TextArea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Обоснуйте решение: условия, приоритет, что требуется уточнить…"
                  />
                </Field>
                <Space style={{ marginTop: 8 }}>
                  <Button type="primary" icon={<CheckOutlined />}
                    style={{ background: ragToken(85).color, borderColor: ragToken(85).color }}
                    onClick={() => decide(approveProposal)}>
                    Одобрить
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => decide(rejectProposal)}>
                    Отклонить
                  </Button>
                </Space>
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Ожидается решение</Text>
            )
          ) : (
            <Field label={`Решение (${p.decidedBy || '—'})`}>
              <Paragraph style={{ marginBottom: 0 }}>
                {p.decisionComment || <Text type="secondary">Без комментария</Text>}
              </Paragraph>
            </Field>
          )}

          {/* Контроль выполнения одобренной меры — зона ответственности менеджера по качеству */}
          {isApproved && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              {p.execution ? (
                <Field label={`Выполнение (${p.executedBy || '—'})`}>
                  <Tag color={p.execution === 'DONE' ? 'green' : 'red'}>
                    {p.execution === 'DONE' ? 'Выполнено' : 'Не выполнено'}
                  </Tag>
                  <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{p.executionComment}</Paragraph>
                </Field>
              ) : canReportExecution ? (
                <>
                  <Field label="Контроль выполнения (комментарий обязателен)">
                    <Input.TextArea
                      rows={3}
                      value={execComment}
                      onChange={(e) => setExecComment(e.target.value)}
                      placeholder="Как выполнено (что сделано, результат) или почему не выполнено (причина, новый срок)…"
                    />
                  </Field>
                  <Space style={{ marginTop: 8 }}>
                    <Button type="primary" icon={<CheckOutlined />}
                      style={{ background: ragToken(85).color, borderColor: ragToken(85).color }}
                      onClick={() => reportExecution('DONE')}>
                      Выполнено
                    </Button>
                    <Button danger icon={<CloseOutlined />} onClick={() => reportExecution('NOT_DONE')}>
                      Не выполнено
                    </Button>
                  </Space>
                </>
              ) : (
                <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Ожидает отчёта менеджера по качеству о выполнении.</Text>
              )}
            </>
          )}
        </>
      )}

      {/* История изменений (аудит правок меры) — открывается кнопкой-иконкой */}
      <Modal
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={560}
        title={<Space><HistoryOutlined /> История изменений — «{p.riskTitle || p.metricName}»</Space>}
      >
        {history.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Правок ещё не было" />
        ) : (
          <List
            size="small"
            dataSource={[...history].reverse()}
            renderItem={(h) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space wrap size={6}>
                    <Tag>{fmtTime(h.at)}</Tag>
                    <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>{FIELD_LABELS[h.field] ?? h.field}</Text>
                    <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>{h.by}</Text>
                  </Space>
                  <Text style={{ fontSize: TYPE.bodySm.fontSize }}>
                    <Text delete type="secondary">{h.from || '—'}</Text>
                    {' → '}
                    <Text strong>{h.to || '—'}</Text>
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Modal>
    </Modal>
  );
};

export default MeasureDecisionModal;
