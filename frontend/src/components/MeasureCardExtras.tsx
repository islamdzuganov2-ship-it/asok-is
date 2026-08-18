/**
 * MeasureCardExtras.tsx — ТЗ v19 §17 (Пункт 17): состав карточки эскалации.
 *
 * Вынесено из MeasureDecisionModal.tsx (превышало потолок check-size.mjs) — самодостаточный
 * блок: метка/ревью LLM-рекомендации (§17.6), цена неисполнения Ц_ОМ (§17.4), системность,
 * направление, альтернативные варианты решения (§17.3). Сам грузит Ц_ОМ и сам диспатчит
 * мутации — родителю достаточно передать проп `proposal` и флаги прав.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, List, Radio, Space, Typography } from 'antd';
import { message } from '../theme/appMessage';
import { PlusOutlined, DeleteOutlined, WarningOutlined, RobotOutlined } from '@ant-design/icons';
import { useAppDispatch } from '../store/hooks';
import {
  fetchPriceOfInaction, fetchPriceHistory, fetchBudgetVariance, fetchEffectTimeline,
  updateSystemicScope, updateAlternatives, reviewLlmMeasure,
  type AlternativeSolution, type BudgetVariance, type EffectTimeline, type PriceHistory, type PriceOfInaction, type Proposal,
} from '../store/slices/governanceSlice';
import { RAG } from '../theme/ragPalette';
import { TYPE } from '../theme/premium';
import { fmtMoney } from '../utils/money';

const { Text } = Typography;

interface Props {
  proposal: Proposal;
  canManageCard: boolean;  // §17.3: системность/альтернативы — менеджер по качеству
  canReviewLlm: boolean;   // §17.6: ревью LLM-рекомендации — QUALITY_MANAGER/RISK_MANAGER
}

export const MeasureCardExtras: React.FC<Props> = ({ proposal: p, canManageCard, canReviewLlm }) => {
  const dispatch = useAppDispatch();
  const [scopeNote, setScopeNote] = useState('');
  const [scopeEditing, setScopeEditing] = useState(false);
  const [altDraft, setAltDraft] = useState<AlternativeSolution[]>([]);
  const [altEditing, setAltEditing] = useState(false);
  const [priceOfInaction, setPriceOfInaction] = useState<PriceOfInaction | null>(null);
  // §17.4 (УК-51): переключатель «сегодня / за квартал» — квартал = честное среднее по
  // дневным точкам истории (fetchPriceHistory), не переиспользование снимка под другой подписью.
  const [priceHistory, setPriceHistory] = useState<PriceHistory | null>(null);
  const [priceHorizon, setPriceHorizon] = useState<'current' | 'quarter'>('current');
  // §17.7 (УК-57): план/факт — читаем на карточке эскалации, вносит исполнитель на «Моих задачах».
  const [budgetVariance, setBudgetVariance] = useState<BudgetVariance | null>(null);
  // ТЗ v19 п.15 (УК-37): эффект во времени — считается только после решения (decided_at).
  const [effectTimeline, setEffectTimeline] = useState<EffectTimeline | null>(null);

  useEffect(() => {
    setScopeNote(p.systemicScopeNote || ''); setScopeEditing(false);
    setAltDraft(p.alternativeSolutions || []); setAltEditing(false);
    setPriceOfInaction(null); setPriceHistory(null); setPriceHorizon('current');
    setBudgetVariance(null); setEffectTimeline(null);
    dispatch(fetchPriceOfInaction({ id: p.id })).unwrap()
      .then((r) => {
        setPriceOfInaction(r);
        if (r?.isOverdue) fetchPriceHistory(p.id, 'quarter').then(setPriceHistory).catch(() => setPriceHistory(null));
      })
      .catch(() => setPriceOfInaction(null));
    if (p.execution === 'DONE' && canManageCard) {
      fetchBudgetVariance(p.id).then(setBudgetVariance).catch(() => setBudgetVariance(null));
    }
    if (p.status === 'APPROVED') {
      fetchEffectTimeline(p.id).then((t) => setEffectTimeline(t.computable ? t : null)).catch(() => setEffectTimeline(null));
    }
  }, [p.id]);

  const saveScopeNote = () => {
    if (!scopeNote.trim()) { message.error('Опишите системность проблемы'); return; }
    dispatch(updateSystemicScope({ id: p.id, note: scopeNote.trim() }));
    setScopeEditing(false);
    message.success('Анализ системности сохранён');
  };

  const addAlternative = () => setAltDraft((a) => [...a, { title: '' }]);
  const removeAlternative = (i: number) => setAltDraft((a) => a.filter((_, idx) => idx !== i));
  const updateAlternative = (i: number, patch: Partial<AlternativeSolution>) =>
    setAltDraft((a) => a.map((alt, idx) => (idx === i ? { ...alt, ...patch } : alt)));
  const saveAlternatives = () => {
    const cleaned = altDraft.filter((a) => a.title.trim());
    dispatch(updateAlternatives({ id: p.id, alternatives: cleaned }));
    setAltDraft(cleaned);
    setAltEditing(false);
    message.success('Альтернативные варианты сохранены');
  };

  const reviewLlm = (approved: boolean) => {
    dispatch(reviewLlmMeasure({ id: p.id, approved }));
    message.success(approved ? 'Рекомендация LLM одобрена' : 'Рекомендация LLM отклонена — мера возвращена на ручную формулировку');
  };

  return (
    <>
      {/* §17.6 (УК-55/56): метка источника + обязательное ревью LLM-рекомендации. */}
      {p.measureSource === 'LLM' && (
        <Alert
          style={{ marginBottom: 12 }}
          type={p.llmReviewedBy ? 'success' : 'warning'}
          showIcon
          icon={<RobotOutlined />}
          message={p.llmReviewedBy ? 'Рекомендация LLM — проверена' : 'Рекомендация LLM — требуется ревью перед эскалацией'}
          description={
            !p.llmReviewedBy && canReviewLlm ? (
              <Space style={{ marginTop: 6 }}>
                <Button size="small" type="primary" onClick={() => reviewLlm(true)}>Одобрить</Button>
                <Button size="small" onClick={() => reviewLlm(false)}>Отклонить</Button>
              </Space>
            ) : !p.llmReviewedBy ? (
              'Мера не может быть эскалирована топ-менеджменту, пока QUALITY_MANAGER/RISK_MANAGER не проверит формулировку (§17.6).'
            ) : undefined
          }
        />
      )}

      {/* §17.4 (УК-49/51): цена неисполнения — только для просроченных мер, с переключателем
          «сегодня / за квартал» (квартал — честное среднее по дневной истории, не снимок). */}
      {priceOfInaction?.isOverdue && (
        <Alert
          style={{ marginBottom: 12 }}
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
              <Text strong style={{ fontSize: 16 }}>
                {(
                  (priceHorizon === 'quarter' ? priceHistory?.periodAvg : priceOfInaction.priceCurrent) ?? 0
                ).toLocaleString('ru-RU')} ₽
              </Text>
              <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize }}>
                {p.measureType === 'COMPENSATING'
                  ? 'Компенсирующая мера: фактический ущерб по связанным сбоям с момента просрочки (§17.4).'
                  : 'Деньги под риском, остающиеся незакрытыми, пока мера не выполнена (§17.4).'}
                {priceHorizon === 'quarter' && priceHistory && (
                  <> Среднее по {priceHistory.points.length} дн. текущего квартала.</>
                )}
              </Text>
            </Space>
          }
        />
      )}

      {/* §17.3 (УК-46/47/48): системность, направление, альтернативные варианты. */}
      <div style={{ background: '#F5F6F8', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {(p.department || canManageCard) && (
            <div>
              <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Направление</Text>
              <div><Text>{p.department || '— не сопоставлено со справочником —'}</Text></div>
            </div>
          )}
          <div>
            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
              Системность {p.systemicScopeSystemCount != null ? `— затронуто систем: ${p.systemicScopeSystemCount}` : ''}
            </Text>
            {scopeEditing ? (
              <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 4 }}>
                <Input.TextArea rows={2} value={scopeNote} onChange={(e) => setScopeNote(e.target.value)}
                  placeholder="Опишите, к скольким системам применима проблема и почему" />
                <Space>
                  <Button size="small" type="primary" onClick={saveScopeNote}>Сохранить</Button>
                  <Button size="small" onClick={() => { setScopeEditing(false); setScopeNote(p.systemicScopeNote || ''); }}>Отмена</Button>
                </Space>
              </Space>
            ) : (
              <div>
                <Text>{p.systemicScopeNote || <Text type="secondary">ручной анализ не проведён</Text>}</Text>
                {canManageCard && (
                  <Button size="small" type="link" onClick={() => setScopeEditing(true)} style={{ padding: 0, marginInlineStart: 8 }}>
                    {p.systemicScopeNote ? 'изменить' : 'добавить анализ'}
                  </Button>
                )}
              </div>
            )}
            {p.systemicScopeLlmNote && (
              <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block', marginTop: 4 }}>
                <RobotOutlined /> {p.systemicScopeLlmNote}
              </Text>
            )}
          </div>

          {(p.alternativeSolutions?.length || canManageCard) ? (
            <div>
              <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Альтернативные варианты решения</Text>
              {altEditing ? (
                <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 4 }}>
                  {altDraft.map((alt, i) => (
                    <Space key={i} style={{ width: '100%' }}>
                      <Input value={alt.title} onChange={(e) => updateAlternative(i, { title: e.target.value })}
                        placeholder="Формулировка варианта" style={{ width: 220 }} />
                      <InputNumber value={alt.capex} onChange={(v) => updateAlternative(i, { capex: v ?? undefined })}
                        placeholder="CAPEX" style={{ width: 110 }} />
                      <InputNumber value={alt.opex} onChange={(v) => updateAlternative(i, { opex: v ?? undefined })}
                        placeholder="OPEX/год" style={{ width: 110 }} />
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeAlternative(i)} />
                    </Space>
                  ))}
                  <Space>
                    <Button size="small" icon={<PlusOutlined />} onClick={addAlternative}>Добавить вариант</Button>
                    <Button size="small" type="primary" onClick={saveAlternatives}>Сохранить</Button>
                    <Button size="small" onClick={() => { setAltEditing(false); setAltDraft(p.alternativeSolutions || []); }}>Отмена</Button>
                  </Space>
                </Space>
              ) : (
                <div>
                  {p.alternativeSolutions?.length ? (
                    <List
                      size="small"
                      dataSource={p.alternativeSolutions}
                      renderItem={(alt) => (
                        <List.Item style={{ padding: '4px 0' }}>
                          <Text>{alt.title}</Text>
                          {(alt.capex != null || alt.opex != null) && (
                            <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, marginInlineStart: 8 }}>
                              {alt.capex != null ? `CAPEX ${fmtMoney(alt.capex)}` : ''}{alt.capex != null && alt.opex != null ? ' · ' : ''}
                              {alt.opex != null ? `OPEX/год ${fmtMoney(alt.opex)}` : ''}
                            </Text>
                          )}
                        </List.Item>
                      )}
                    />
                  ) : <Text type="secondary">не заданы</Text>}
                  {canManageCard && (
                    <Button size="small" type="link" onClick={() => setAltEditing(true)} style={{ padding: 0 }}>
                      {p.alternativeSolutions?.length ? 'изменить' : 'добавить варианты'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </Space>
      </div>

      {/* §17.7 (УК-57): план/факт по бюджету и трудоёмкости — read-only здесь, факт вносит
          исполнитель на «Моих задачах» (AssigneeTasksPage). Показываем только при наличии
          хотя бы одного расхождения — нечего показывать до первого факта. */}
      {budgetVariance && (budgetVariance.capexVariance != null || budgetVariance.opexVariance != null || budgetVariance.effortVariance != null) && (
        <div style={{ background: '#F5F6F8', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>План / факт (перерасход бюджета и ресурсов)</Text>
          <Space direction="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
            {budgetVariance.capexVariance != null && (
              <Text style={{ fontSize: 13, color: budgetVariance.capexVariance > 0 ? RAG.bad.strong : RAG.good.strong }}>
                CAPEX: план {fmtMoney(budgetVariance.plannedCapex ?? 0)} · факт {fmtMoney(budgetVariance.actualCapex ?? 0)} ·{' '}
                {budgetVariance.capexVariance > 0 ? 'перерасход' : 'экономия'} {fmtMoney(Math.abs(budgetVariance.capexVariance))}
              </Text>
            )}
            {budgetVariance.opexVariance != null && (
              <Text style={{ fontSize: 13, color: budgetVariance.opexVariance > 0 ? RAG.bad.strong : RAG.good.strong }}>
                OPEX/год: план {fmtMoney(budgetVariance.plannedOpex ?? 0)} · факт {fmtMoney(budgetVariance.actualOpex ?? 0)} ·{' '}
                {budgetVariance.opexVariance > 0 ? 'перерасход' : 'экономия'} {fmtMoney(Math.abs(budgetVariance.opexVariance))}
              </Text>
            )}
            {budgetVariance.effortVariance != null && (
              <Text style={{ fontSize: 13, color: budgetVariance.effortVariance > 0 ? RAG.bad.strong : RAG.good.strong }}>
                Трудоёмкость: план {budgetVariance.plannedEffortHours ?? 0} ч · факт {budgetVariance.actualEffortHours ?? 0} ч ·{' '}
                {budgetVariance.effortVariance > 0 ? 'перерасход' : 'экономия'} {Math.abs(budgetVariance.effortVariance)} ч
              </Text>
            )}
          </Space>
        </div>
      )}

      {/* ТЗ v19 п.15 (УК-37): эффект во времени по кварталам — когда реально придут деньги,
          с учётом лага внедрения (implementation_months) и точки окупаемости. */}
      {effectTimeline && effectTimeline.points.length > 0 && (
        <div style={{ background: '#F5F6F8', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Эффект во времени (по кварталам)</Text>
          <div style={{ marginTop: 4, marginBottom: 6 }}>
            <Text style={{ fontSize: 13 }}>
              Эффект начинается с {effectTimeline.effectStartDate ? new Date(effectTimeline.effectStartDate).toLocaleDateString('ru-RU') : '—'}
              {effectTimeline.paybackQuarter ? <> · окупаемость: <Text strong>{effectTimeline.paybackQuarter}</Text></> : ' · окупаемость в пределах горизонта не наступает'}
            </Text>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {effectTimeline.points.map((pt) => (
              <div
                key={pt.quarterLabel}
                style={{
                  minWidth: 92, padding: '6px 8px', borderRadius: 6,
                  background: pt.quarterLabel === effectTimeline.paybackQuarter ? RAG.good.soft : '#fff',
                  border: `1px solid ${pt.quarterLabel === effectTimeline.paybackQuarter ? RAG.good.strong : '#E5E7EB'}`,
                }}
              >
                <Text style={{ fontSize: TYPE.micro.fontSize, display: 'block' }} type="secondary">{pt.quarterLabel}</Text>
                <Text style={{ fontSize: 12, display: 'block', color: pt.netCash > 0 ? RAG.good.strong : pt.netCash < 0 ? RAG.bad.strong : undefined }}>
                  {pt.netCash > 0 ? '+' : ''}{fmtMoney(pt.netCash)}
                </Text>
                <Text style={{ fontSize: 12, display: 'block', color: pt.cumulative >= 0 ? RAG.good.strong : RAG.bad.strong }}>
                  Σ {fmtMoney(pt.cumulative)}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default MeasureCardExtras;
