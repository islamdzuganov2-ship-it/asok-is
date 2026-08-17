/**
 * MeasureCardExtras.tsx — ТЗ v19 §17 (Пункт 17): состав карточки эскалации.
 *
 * Вынесено из MeasureDecisionModal.tsx (превышало потолок check-size.mjs) — самодостаточный
 * блок: метка/ревью LLM-рекомендации (§17.6), цена неисполнения Ц_ОМ (§17.4), системность,
 * направление, альтернативные варианты решения (§17.3). Сам грузит Ц_ОМ и сам диспатчит
 * мутации — родителю достаточно передать проп `proposal` и флаги прав.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, List, Space, Typography } from 'antd';
import { message } from '../theme/appMessage';
import { PlusOutlined, DeleteOutlined, WarningOutlined, RobotOutlined } from '@ant-design/icons';
import { useAppDispatch } from '../store/hooks';
import {
  fetchPriceOfInaction, updateSystemicScope, updateAlternatives, reviewLlmMeasure,
  type AlternativeSolution, type PriceOfInaction, type Proposal,
} from '../store/slices/governanceSlice';
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

  useEffect(() => {
    setScopeNote(p.systemicScopeNote || ''); setScopeEditing(false);
    setAltDraft(p.alternativeSolutions || []); setAltEditing(false);
    setPriceOfInaction(null);
    dispatch(fetchPriceOfInaction({ id: p.id })).unwrap()
      .then((r) => setPriceOfInaction(r)).catch(() => setPriceOfInaction(null));
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

      {/* §17.4 (УК-49): цена неисполнения — только для просроченных мер. */}
      {priceOfInaction?.isOverdue && (
        <Alert
          style={{ marginBottom: 12 }}
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message={`Цена неисполнения (Ц_ОМ): ${(priceOfInaction.priceCurrent ?? 0).toLocaleString('ru-RU')} ₽`}
          description={
            p.measureType === 'COMPENSATING'
              ? 'Компенсирующая мера: фактический ущерб по связанным сбоям с момента просрочки (§17.4).'
              : 'Деньги под риском, остающиеся незакрытыми, пока мера не выполнена (§17.4). '
                + (priceOfInaction.priceSnapshot != null
                  ? `На момент просрочки: ${priceOfInaction.priceSnapshot.toLocaleString('ru-RU')} ₽.` : '')
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
    </>
  );
};

export default MeasureCardExtras;
