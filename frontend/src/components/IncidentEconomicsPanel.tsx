/**
 * IncidentEconomicsPanel.tsx — «Экономика сбоя» в карточке техсбоя (BL-007).
 *
 * RE-05: ручной ввод аналитика — тип события, длительность, тайминги, трудозатраты по линиям.
 * RE-06: для деградации K считается по типу из входов (функциональная / производительная /
 *        пропускная); правило «деградация → простой» (K ≥ порога дольше N минут) показывается явно.
 * RE-03: линии, закрытые вендором, — у вендора своя ставка, квант биллинга и пакет часов.
 * RE-07: C_ТС и его разложение считает бэкенд; здесь — ввод и подача, без расчётов на клиенте.
 *
 * Деньги: чтение — по праву контура или правки реестра, правка — только `incidents.edit`.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Descriptions, Form, InputNumber, Select, Space, Spin, Tag, Typography } from 'antd';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { message } from '../theme/appMessage';
import { fmtMoney } from '../utils/money';
import { SPACE } from '../theme/premium';

const { Text } = Typography;
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export interface IncidentEconomics {
  id: string;
  incidentType: 'DOWNTIME' | 'DEGRADATION';
  degradationType?: 'FUNCTIONAL' | 'PERFORMANCE' | 'THROUGHPUT' | null;
  degradationInputs?: Record<string, number> | null;
  downtimeMinutes?: number | null;
  kImpact?: number | null;
  countsAsDowntime?: boolean | null;
  tReactionMin?: number | null;
  tResolutionMin?: number | null;
  tTargetMin?: number | null;
  laborL1Hours?: number | null;
  laborL2Hours?: number | null;
  laborL3Hours?: number | null;
  laborVendorLines?: string[] | null;
  laborSource?: string | null;
  costTotal?: number | null;
  costBreakdown?: {
    recovery?: number; downtime?: number; total?: number; k_source?: string;
    lines?: Array<{ line: string; hours: number; billable_hours?: number; executor: string; cost: number | null; note?: string }>;
  } | null;
}

const DEGRADATION_LABEL: Record<string, string> = {
  FUNCTIONAL: 'Функциональная (часть функций недоступна)',
  PERFORMANCE: 'Производительная (вырос отклик)',
  THROUGHPUT: 'Пропускная (обрабатывается не вся нагрузка)',
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${r.status}`);
  }
  return r.json();
}

/** Входы расчёта K для выбранного типа деградации → тело запроса (RE-06). */
export function degradationInputsFrom(type: string | undefined, v: Record<string, number | undefined>): Record<string, number> | null {
  const pick = (keys: string[]) => {
    const out: Record<string, number> = {};
    for (const k of keys) if (typeof v[k] === 'number') out[k] = v[k] as number;
    return Object.keys(out).length === keys.length ? out : null;
  };
  if (type === 'FUNCTIONAL') return pick(['unavailable_weight', 'total_weight']);
  if (type === 'PERFORMANCE') return pick(['response_ratio']);
  if (type === 'THROUGHPUT') return pick(['actual', 'required']);
  return null;
}

const IncidentEconomicsPanel: React.FC<{ incidentId: string; onSaved?: (costTotal: number | null) => void }> = ({ incidentId, onSaved }) => {
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const canEdit = permissions.includes('incidents.edit');
  const canView = canEdit || permissions.includes('view.risk_economics');
  const [data, setData] = useState<IncidentEconomics | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm();
  const incidentType = Form.useWatch('incidentType', form);
  const degradationType = Form.useWatch('degradationType', form);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    setLoading(true);
    call<IncidentEconomics>(`/incidents/${incidentId}/economics`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        form.setFieldsValue({ ...d, ...(d.degradationInputs ?? {}), vendorLines: d.laborVendorLines ?? [] });
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [incidentId, canView, form]);

  if (!canView) return null;

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        incidentType: v.incidentType,
        degradationType: v.incidentType === 'DEGRADATION' ? v.degradationType ?? null : null,
        degradationInputs: v.incidentType === 'DEGRADATION' ? degradationInputsFrom(v.degradationType, v) : null,
        downtimeMinutes: v.downtimeMinutes ?? null,
        kImpact: v.kImpact ?? null,
        tReactionMin: v.tReactionMin ?? null,
        tResolutionMin: v.tResolutionMin ?? null,
        tTargetMin: v.tTargetMin ?? null,
        laborL1Hours: v.laborL1Hours ?? null,
        laborL2Hours: v.laborL2Hours ?? null,
        laborL3Hours: v.laborL3Hours ?? null,
        laborVendorLines: v.vendorLines ?? [],
      };
      const d = await call<IncidentEconomics>(`/incidents/${incidentId}/economics`, { method: 'PUT', body: JSON.stringify(body) });
      setData(d);
      form.setFieldsValue({ kImpact: d.kImpact });
      message.success(`C_ТС пересчитана: ${fmtMoney(d.costTotal ?? 0)}`);
      onSaved?.(d.costTotal ?? null);
    } catch (e: any) {
      message.error(e.message || 'Не удалось сохранить экономику сбоя');
    } finally {
      setSaving(false);
    }
  };

  const b = data?.costBreakdown;
  return (
    <div>
      <Text strong style={{ display: 'block', marginBottom: SPACE.cozy }}>Экономика сбоя</Text>
      {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: SPACE.cozy }} />}
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" disabled={!canEdit} initialValues={{ incidentType: 'DOWNTIME', vendorLines: [] }}>
          <Space wrap size="middle" style={{ width: '100%' }}>
            <Form.Item name="incidentType" label="Тип события" style={{ minWidth: 200 }}>
              <Select options={[{ value: 'DOWNTIME', label: 'Простой (полный отказ)' }, { value: 'DEGRADATION', label: 'Деградация' }]} />
            </Form.Item>
            <Form.Item name="downtimeMinutes" label="Длительность, мин" style={{ minWidth: 140 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            {incidentType === 'DEGRADATION' && (
              <Form.Item name="degradationType" label="Тип деградации" style={{ minWidth: 280 }}>
                <Select allowClear options={Object.entries(DEGRADATION_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            )}
          </Space>
          {incidentType === 'DEGRADATION' && (
            <Space wrap size="middle">
              {degradationType === 'FUNCTIONAL' && (<>
                <Form.Item name="unavailable_weight" label="Вес недоступных функций"><InputNumber min={0} /></Form.Item>
                <Form.Item name="total_weight" label="Вес всех функций"><InputNumber min={0} /></Form.Item>
              </>)}
              {degradationType === 'PERFORMANCE' && (
                <Form.Item name="response_ratio" label="Отклик к нормативу, раз"><InputNumber min={1} step={0.5} /></Form.Item>
              )}
              {degradationType === 'THROUGHPUT' && (<>
                <Form.Item name="actual" label="Фактическая пропускная"><InputNumber min={0} /></Form.Item>
                <Form.Item name="required" label="Требуемая пропускная"><InputNumber min={0} /></Form.Item>
              </>)}
              <Form.Item name="kImpact" label="K влияния (если входов нет)"><InputNumber min={0} max={1} step={0.05} /></Form.Item>
            </Space>
          )}
          <Space wrap size="middle">
            <Form.Item name="tReactionMin" label="Реакция, мин"><InputNumber min={0} /></Form.Item>
            <Form.Item name="tResolutionMin" label="Восстановление, мин"><InputNumber min={0} /></Form.Item>
            <Form.Item name="tTargetMin" label="Устранение причины, мин"><InputNumber min={0} /></Form.Item>
          </Space>
          <Space wrap size="middle" align="end">
            <Form.Item name="laborL1Hours" label="L1, ч"><InputNumber min={0} step={0.5} /></Form.Item>
            <Form.Item name="laborL2Hours" label="L2, ч"><InputNumber min={0} step={0.5} /></Form.Item>
            <Form.Item name="laborL3Hours" label="L3, ч"><InputNumber min={0} step={0.5} /></Form.Item>
            <Form.Item name="vendorLines" label="Закрыто вендором">
              <Checkbox.Group options={['L1', 'L2', 'L3']} />
            </Form.Item>
          </Space>
          {canEdit && <Button type="primary" onClick={save} loading={saving}>Сохранить и пересчитать C_ТС</Button>}
        </Form>
      </Spin>

      {data && (
        <Descriptions size="small" column={2} bordered style={{ marginTop: SPACE.base }}>
          <Descriptions.Item label="C_ТС, всего">{fmtMoney(data.costTotal ?? null)}</Descriptions.Item>
          <Descriptions.Item label="K влияния">
            {data.kImpact ?? '—'}{' '}
            {b?.k_source === 'computed' && <Tag color="blue">рассчитан по типу</Tag>}
            {b?.k_source === 'manual' && <Tag>введён вручную</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Восстановление">{fmtMoney(b?.recovery ?? null)}</Descriptions.Item>
          <Descriptions.Item label="Простой">{fmtMoney(b?.downtime ?? null)}</Descriptions.Item>
          <Descriptions.Item label="Учёт в доступности" span={2}>
            {data.incidentType === 'DOWNTIME' && 'Простой — учитывается'}
            {data.incidentType === 'DEGRADATION' && data.countsAsDowntime === true && <Tag color="red">Деградация засчитана как простой (K и длительность выше порога)</Tag>}
            {data.incidentType === 'DEGRADATION' && data.countsAsDowntime === false && <Tag color="green">Деградация ниже порога — в простой не входит</Tag>}
            {data.incidentType === 'DEGRADATION' && data.countsAsDowntime == null && <Text type="secondary">Нет K или длительности — правило не применено</Text>}
          </Descriptions.Item>
          {(b?.lines ?? []).length > 0 && (
            <Descriptions.Item label="По линиям" span={2}>
              {(b?.lines ?? []).map((l) => (
                <div key={l.line}>
                  {l.line}: {l.hours} ч{l.billable_hours && l.billable_hours !== l.hours ? ` (к оплате ${l.billable_hours} ч по кванту)` : ''}
                  {' · '}{l.executor === 'VENDOR' ? 'вендор' : 'внутр.'}{' · '}
                  {l.cost === null ? <Text type="warning">{l.note}</Text> : fmtMoney(l.cost)}
                </div>
              ))}
            </Descriptions.Item>
          )}
          {data.laborSource === 'reassignment_log' && (
            <Descriptions.Item label="Трудозатраты" span={2}>восстановлены из журнала переназначений ITSM</Descriptions.Item>
          )}
        </Descriptions>
      )}
    </div>
  );
};

export default IncidentEconomicsPanel;
