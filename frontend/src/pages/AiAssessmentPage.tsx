/**
 * AiAssessmentPage.tsx — «Оценка СИИ» по ГОСТ Р 59898-2021 (BL-001 E1).
 *
 * Контур для систем с признаком «Система ИИ» (system_kind=AI), отдельный от ISO 25010:
 *   каскад группа → характеристика → субхарактеристика (модель из GET /ai-assessments/ai-model,
 *   единый источник истины — BL-003), ввод ML-входов (TP/TN/FP/FN, A/B, экспертная шкала),
 *   baseline ± допуски (ε⁻/ε⁺), нормировка X∈[0,1], вердикт соответствия,
 *   интегральный Q (равные веса, E1) и отчёт соответствия.
 *
 * ⚠️ СТАТУС «ПОД РАЗВИТИЕ» (2026-07-06): E1/E2 реализованы и рабочие, но раздел НАМЕРЕННО скрыт
 * из UI — пункт меню не выведен (см. App.tsx / AppLayout.tsx). Код сохраняется закоммиченным до
 * появления потребности открыть раздел; этап E3 отложен (T-17). Чтобы включить — вернуть пункт
 * меню «Оценка СИИ» в AppLayout.tsx.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Progress, Select, Space,
  Table, Tag, Tooltip, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined, ExperimentOutlined, FileDoneOutlined, PlusOutlined, RobotOutlined,
} from '@ant-design/icons';
import { ragToken } from '../theme/ragPalette';

const { Title, Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// --- Типы модели 59898 (зеркало ответа /ai-assessments/ai-model) ---
interface AiSub { name: string; metric_kind: string; inputs_schema: string[]; is_ai_specific: boolean; hint: string }
interface AiChar { title: string; subs: AiSub[] }
interface AiGroup { group: string; characteristics: AiChar[] }

interface AiValue {
  id: string; group_name: string; characteristic: string; subcharacteristic: string;
  metric_kind: string; inputs: Record<string, number> | null;
  baseline: number | null; tol_low: number | null; tol_high: number | null;
  raw_value: number | null; normalized_x: number | null; conformant: boolean | null;
  unmeasurable: boolean; expert_comment: string | null; is_ai_specific: boolean;
}
interface AiPeriod { id: string; system_id: string; system_name?: string; period: string; status: string }
interface CalcOut { q: number | null; level: string; characteristics: Array<{ title: string; score: number }>; weighted?: boolean }
interface ConfRow {
  characteristic: string; subcharacteristic: string; metric_kind: string;
  raw_value: number | null; baseline: number | null; tol_low: number | null; tol_high: number | null;
  normalized_x: number | null; verdict: string;
}
interface ConfReport { q: number | null; level: string; rows: ConfRow[]; conformant_count: number; nonconformant_count: number; no_baseline_count: number }

interface SystemLite { id: string; name: string; code?: string; system_kind?: string }

const INPUT_LABEL: Record<string, string> = {
  A: 'A (факт)', B: 'B (база)', TP: 'TP', TN: 'TN', FP: 'FP', FN: 'FN', score: 'Оценка 0–100',
  y: 'y — фактические значения (CSV)', y_hat: 'ŷ — предсказания (CSV)',
  rel: 'Релевантности по порядку выдачи (CSV)', curve: 'Точки кривой: x,y; x,y; …',
  I: 'I — эталонное изображение (пиксели CSV)', I_hat: 'Î — реконструкция (пиксели CSV)',
  max_i: 'MAX (динамический диапазон, напр. 255)',
};
// Поля-массивы вводятся текстом (CSV) и парсятся перед отправкой; curve — парами «x,y; x,y».
const ARRAY_FIELDS = new Set(['y', 'y_hat', 'rel', 'I', 'I_hat']);
const CURVE_FIELDS = new Set(['curve']);
const parseCsv = (s: string): number[] => s.replace(/;/g, ',').split(',').map((p) => p.trim()).filter(Boolean).map(Number);
const parseCurve = (s: string): number[][] => s.split(';').map((pair) => pair.trim()).filter(Boolean)
  .map((pair) => pair.split(',').map((p) => Number(p.trim())));
const VERDICT_TAG: Record<string, string> = {
  'В допуске': 'green', 'Вне допуска': 'red', 'Эталон не задан': 'default',
  'Невозможно измерить': 'default', 'Не рассчитано': 'orange',
};

// Зеркало METRIC_KINDS бэкенда (modules/quality/ai_quality_model.py) для переопределения вида метрики.
const KIND_SCHEMAS: Record<string, string[]> = {
  RATIO_DIRECT: ['A', 'B'], RATIO_INVERSE: ['A', 'B'],
  ACCURACY: ['TP', 'TN', 'FP', 'FN'], PRECISION: ['TP', 'FP'], RECALL: ['TP', 'FN'],
  SPECIFICITY: ['TN', 'FP'], F1: ['TP', 'FP', 'FN'], EXPERT_SCALE: ['score'],
  MSE: ['y', 'y_hat'], MAE: ['y', 'y_hat'], AUC_ROC: ['curve'], AUC_PRC: ['curve'],
  NDCG: ['rel'], PSNR: ['I', 'I_hat', 'max_i'], SSIM: ['I', 'I_hat'],
};

const AiAssessmentPage: React.FC = () => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const [model, setModel] = useState<AiGroup[]>([]);
  const [systems, setSystems] = useState<SystemLite[]>([]);
  const [systemId, setSystemId] = useState<string>();
  const [periods, setPeriods] = useState<AiPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string>();
  const [newPeriod, setNewPeriod] = useState<string>();
  const [values, setValues] = useState<AiValue[]>([]);
  const [calc, setCalc] = useState<CalcOut | null>(null);
  const [report, setReport] = useState<ConfReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  // E2: редактор весов характеристик (Σ=1) для взвешенной свёртки Q (формулы 3–8).
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [charWeights, setCharWeights] = useState<Record<string, number | null>>({});
  const allCharacteristics = useMemo(
    () => model.flatMap((g) => g.characteristics.map((c) => c.title)), [model],
  );
  const weightSum = useMemo(
    () => Object.values(charWeights).reduce((s: number, w) => s + (w ?? 0), 0), [charWeights],
  );

  const openWeights = async () => {
    if (!periodId) return;
    try {
      const r = await fetch(`${VITE_API}/ai-assessments/${periodId}/weights`, { headers });
      const d = r.ok ? await r.json() : { characteristics: {} };
      const next: Record<string, number | null> = {};
      allCharacteristics.forEach((c) => { next[c] = d.characteristics?.[c] ?? null; });
      setCharWeights(next);
      setWeightsOpen(true);
    } catch { message.error('Не удалось загрузить веса'); }
  };

  const saveWeights = async (reset = false) => {
    if (!periodId) return;
    const filled = Object.fromEntries(
      Object.entries(charWeights).filter(([, w]) => w != null && w > 0),
    ) as Record<string, number>;
    if (!reset && Object.keys(filled).length > 0 && Math.abs(weightSum - 1) > 0.001) {
      message.error(`Σ весов = ${weightSum.toFixed(3)} — требуется ровно 1.0 (ГОСТ 59898, ф. 3–8)`);
      return;
    }
    const r = await fetch(`${VITE_API}/ai-assessments/${periodId}/weights`, {
      method: 'PUT', headers,
      body: JSON.stringify({ characteristics: reset ? {} : filled }),
    });
    if (r.ok) {
      message.success(reset ? 'Веса сброшены — свёртка с равными весами' : 'Веса сохранены');
      setWeightsOpen(false); setCalc(null);
    } else {
      const e = await r.json().catch(() => ({}));
      message.error(e.detail || 'Не удалось сохранить веса');
    }
  };

  const periodOptions = useMemo(() => {
    const year = new Date().getFullYear();
    return [year, year - 1].flatMap((y) => [4, 3, 2, 1].map((q) => `Q${q}-${y}`));
  }, []);

  // Модель 59898 + системы ИИ.
  useEffect(() => {
    fetch(`${VITE_API}/ai-assessments/ai-model`).then((r) => r.json())
      .then((d) => setModel(d.groups || [])).catch(() => setModel([]));
    fetch(`${VITE_API}/systems?limit=100`, { headers }).then((r) => r.json())
      .then((d) => setSystems((d.items || []).filter((s: SystemLite) => s.system_kind === 'AI')))
      .catch(() => setSystems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPeriods = (sid: string) => {
    fetch(`${VITE_API}/ai-assessments/periods?system_id=${sid}`, { headers })
      .then((r) => r.json()).then((d) => setPeriods(Array.isArray(d) ? d : []))
      .catch(() => setPeriods([]));
  };
  const loadValues = (pid: string) => {
    fetch(`${VITE_API}/ai-assessments/${pid}/values`, { headers })
      .then((r) => r.json()).then((d) => setValues(Array.isArray(d) ? d : []))
      .catch(() => setValues([]));
  };

  useEffect(() => { if (systemId) { setPeriodId(undefined); setValues([]); setCalc(null); loadPeriods(systemId); } }, [systemId]);
  useEffect(() => { if (periodId) { setCalc(null); loadValues(periodId); } }, [periodId]);

  const createPeriod = async () => {
    if (!systemId || !newPeriod) return;
    const r = await fetch(`${VITE_API}/ai-assessments/periods`, {
      method: 'POST', headers, body: JSON.stringify({ system_id: systemId, period: newPeriod }),
    });
    if (r.status === 201) { const p = await r.json(); loadPeriods(systemId); setPeriodId(p.id); message.success('Период оценки СИИ создан'); }
    else if (r.status === 409) { message.info('Период уже существует — выберите его в списке'); loadPeriods(systemId); }
    else message.error('Не удалось создать период');
  };

  // Каскад в модале добавления.
  const selGroup: string | undefined = Form.useWatch('group', form);
  const selChar: string | undefined = Form.useWatch('characteristic', form);
  const selSub: string | undefined = Form.useWatch('subcharacteristic', form);
  const unmeasurable: boolean = Form.useWatch('unmeasurable', form) || false;
  const kindOverride: string | undefined = Form.useWatch('metric_kind', form);

  const charsOf = (g?: string) => model.find((x) => x.group === g)?.characteristics ?? [];
  const subsOf = (g?: string, c?: string) => charsOf(g).find((x) => x.title === c)?.subs ?? [];
  const subMeta = subsOf(selGroup, selChar).find((s) => s.name === selSub);
  // Действующий вид метрики: переопределение (E2) или назначенный каталогом.
  const effectiveKind = kindOverride || subMeta?.metric_kind;
  const effectiveSchema = effectiveKind ? (KIND_SCHEMAS[effectiveKind] ?? subMeta?.inputs_schema ?? []) : [];

  const saveValue = async () => {
    if (!periodId) return;
    try {
      const f = await form.validateFields();
      const inputs: Record<string, unknown> = {};
      effectiveSchema.forEach((k) => {
        const raw = f[`in_${k}`];
        if (raw == null || raw === '') return;
        if (ARRAY_FIELDS.has(k)) inputs[k] = parseCsv(String(raw));
        else if (CURVE_FIELDS.has(k)) inputs[k] = parseCurve(String(raw));
        else inputs[k] = raw;
      });
      setSaving(true);
      const r = await fetch(`${VITE_API}/ai-assessments/${periodId}/values`, {
        method: 'PUT', headers,
        body: JSON.stringify([{
          characteristic: f.characteristic, subcharacteristic: f.subcharacteristic,
          metric_kind: effectiveKind,
          inputs: f.unmeasurable ? null : inputs,
          baseline: f.unmeasurable ? null : (f.baseline ?? null),
          tol_low: f.unmeasurable ? null : (f.tol_low ?? null),
          tol_high: f.unmeasurable ? null : (f.tol_high ?? null),
          expert_comment: f.expert_comment || null,
          unmeasurable: !!f.unmeasurable,
        }]),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${r.status}`); }
      message.success('Оценка сохранена (X и вердикт рассчитаны)');
      form.resetFields(); setAddOpen(false); loadValues(periodId); setCalc(null);
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(String(e.message || e));
    } finally { setSaving(false); }
  };

  const runCalculate = async () => {
    if (!periodId) return;
    const r = await fetch(`${VITE_API}/ai-assessments/${periodId}/calculate`, { method: 'POST', headers });
    if (r.ok) setCalc(await r.json()); else message.error('Не удалось рассчитать Q');
  };
  const openReport = async () => {
    if (!periodId) return;
    const r = await fetch(`${VITE_API}/ai-assessments/${periodId}/conformance-report`, { headers });
    if (r.ok) { setReport(await r.json()); setReportOpen(true); } else message.error('Не удалось получить отчёт');
  };
  const finalize = async () => {
    if (!periodId) return;
    const r = await fetch(`${VITE_API}/ai-assessments/${periodId}/finalize`, { method: 'POST', headers });
    if (r.ok) { message.success('Оценка СИИ завершена'); if (systemId) loadPeriods(systemId); }
    else { const e = await r.json().catch(() => ({})); message.error(e.detail || 'Завершение недоступно'); }
  };

  const valueColumns: ColumnsType<AiValue> = [
    {
      title: 'Субхарактеристика', dataIndex: 'subcharacteristic', ellipsis: true,
      render: (v: string, rec) => (
        <Space size={4}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
          {rec.is_ai_specific && <Tag color="purple" style={{ fontSize: 10 }}>ИИ</Tag>}
        </Space>
      ),
    },
    { title: 'Метрика', dataIndex: 'metric_kind', width: 110, render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
    {
      title: 'Значение', dataIndex: 'raw_value', width: 90,
      render: (v: number | null, rec) => rec.unmeasurable ? <Tag>Н/И</Tag> : v == null ? '—' : <Text strong>{v.toFixed(3)}</Text>,
    },
    {
      title: 'Эталон ±ε', key: 'baseline', width: 130,
      render: (_: unknown, rec) => rec.baseline == null ? <Text type="secondary">—</Text>
        : <Text style={{ fontSize: 12 }}>{rec.baseline} (−{rec.tol_low ?? 0}/+{rec.tol_high ?? 0})</Text>,
    },
    {
      title: 'X', dataIndex: 'normalized_x', width: 80,
      render: (v: number | null) => v == null ? '—'
        : <Tag color={ragToken(v * 100).color} style={{ color: '#fff', border: 'none' }}>{v.toFixed(3)}</Tag>,
    },
    {
      title: 'Вердикт', key: 'verdict', width: 140,
      render: (_: unknown, rec) => {
        const verdict = rec.unmeasurable ? 'Невозможно измерить'
          : rec.raw_value == null ? 'Не рассчитано'
          : rec.conformant == null ? 'Эталон не задан'
          : rec.conformant ? 'В допуске' : 'Вне допуска';
        return <Tag color={VERDICT_TAG[verdict]}>{verdict}</Tag>;
      },
    },
    {
      title: 'Комментарий', dataIndex: 'expert_comment', ellipsis: true,
      render: (v: string | null) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">—</Text>,
    },
  ];

  const activePeriod = periods.find((p) => p.id === periodId);
  const qPct = calc?.q != null ? Math.round(calc.q * 100) : null;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Title level={3} style={{ color: '#1F3864', marginBottom: 4 }}>
        <ExperimentOutlined /> Оценка СИИ — ГОСТ Р 59898-2021
      </Title>
      <Text type="secondary">
        Контур для систем ИИ: представительный набор субхарактеристик, ML-метрики, соответствие
        базовым значениям (baseline ± допуски), интегральный показатель Q.
      </Text>

      <Card title="Система ИИ и период" style={{ marginTop: 16 }}>
        <Space wrap align="end" size="middle">
          <div style={{ minWidth: 340 }}>
            <Text type="secondary">Система ИИ (system_kind = AI)</Text>
            <Select
              style={{ width: 340, display: 'block' }}
              placeholder={systems.length ? 'Выберите систему ИИ' : 'Нет систем с признаком «Система ИИ»'}
              showSearch optionFilterProp="label"
              value={systemId} onChange={setSystemId}
              options={systems.map((s) => ({ value: s.id, label: `${s.name}${s.code ? ` (${s.code})` : ''}` }))}
            />
          </div>
          <div>
            <Text type="secondary">Период</Text>
            <Select
              style={{ width: 170, display: 'block' }} placeholder="Выбрать"
              value={periodId} onChange={setPeriodId} disabled={!systemId}
              options={periods.map((p) => ({ value: p.id, label: `${p.period} · ${p.status}` }))}
            />
          </div>
          <Space>
            <Select style={{ width: 130 }} placeholder="Новый" value={newPeriod} onChange={setNewPeriod}
              options={periodOptions.map((p) => ({ value: p, label: p }))} disabled={!systemId} />
            <Button icon={<PlusOutlined />} onClick={createPeriod} disabled={!systemId || !newPeriod}>Создать</Button>
          </Space>
        </Space>
        {systems.length === 0 && (
          <Alert style={{ marginTop: 12 }} type="info" showIcon
            message="Пометьте систему как СИИ"
            description="Признак «Система ИИ (ГОСТ Р 59898-2021)» задаётся при создании системы: «Оценка ИС» → «Добавить систему» → Тип системы." />
        )}
      </Card>

      {periodId && (
        <Card
          style={{ marginTop: 16 }}
          title={<Space><span>Представительный набор — {activePeriod?.period}</span><Tag>{values.length} субхар.</Tag></Space>}
          extra={(
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setAddOpen(true); }}>Добавить оценку</Button>
              <Tooltip title="Весовые коэффициенты характеристик uₖ (Σ=1) — взвешенный Q по формулам 3–8">
                <Button onClick={openWeights}>Веса</Button>
              </Tooltip>
              <Button icon={<RobotOutlined />} onClick={runCalculate} disabled={values.length === 0}>Рассчитать Q</Button>
              <Button icon={<FileDoneOutlined />} onClick={openReport} disabled={values.length === 0}>Отчёт соответствия</Button>
              <Tooltip title="Доступно, когда каждая внесённая строка рассчитана или помечена «невозможно измерить»">
                <Button icon={<CheckCircleOutlined />} onClick={finalize} disabled={values.length === 0}>Завершить</Button>
              </Tooltip>
            </Space>
          )}
        >
          {calc && (
            <Alert
              style={{ marginBottom: 12 }}
              type={qPct != null && qPct >= 61 ? 'success' : qPct != null && qPct >= 41 ? 'warning' : 'error'}
              showIcon icon={<RobotOutlined />}
              message={<Space size="large">
                <Text strong>Интегральный показатель Q = {calc.q != null ? calc.q.toFixed(3) : '—'} ({qPct ?? '—'}%)</Text>
                <Tag color={qPct != null ? ragToken(qPct).color : 'default'} style={{ color: '#fff', border: 'none' }}>{calc.level}</Tag>
                <Tag>{calc.weighted ? 'взвешенная свёртка (ф. 3–8)' : 'равные веса'}</Tag>
              </Space>}
              description={(
                <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 6 }}>
                  {calc.characteristics.map((c) => (
                    <div key={c.title} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text style={{ width: 260, fontSize: 12 }} ellipsis>{c.title}</Text>
                      <Progress percent={Math.round(c.score * 100)} size="small" style={{ flex: 1, maxWidth: 320 }}
                        strokeColor={ragToken(c.score * 100).color} />
                    </div>
                  ))}
                </Space>
              )}
            />
          )}
          <Table<AiValue>
            columns={valueColumns} dataSource={values} rowKey="id" size="small" bordered sticky
            pagination={false} scroll={{ x: 980, y: 440 }}
            locale={{ emptyText: 'Набор пуст. Добавьте субхарактеристики представительного набора.' }}
          />
        </Card>
      )}

      {/* Модал добавления/обновления оценки субхарактеристики */}
      <Modal
        title="Оценка субхарактеристики СИИ"
        open={addOpen} onCancel={() => setAddOpen(false)} onOk={saveValue}
        confirmLoading={saving} okText="Сохранить" cancelText="Отмена" width={680}
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: 'flex' }} align="start">
            <Form.Item name="group" label="Группа" style={{ minWidth: 190 }} rules={[{ required: true, message: 'Выберите группу' }]}>
              <Select options={model.map((g) => ({ value: g.group, label: g.group }))}
                onChange={() => form.setFieldsValue({ characteristic: undefined, subcharacteristic: undefined })} />
            </Form.Item>
            <Form.Item name="characteristic" label="Характеристика" style={{ minWidth: 210 }} rules={[{ required: true, message: 'Выберите характеристику' }]}>
              <Select disabled={!selGroup} options={charsOf(selGroup).map((c) => ({ value: c.title, label: c.title }))}
                onChange={() => form.setFieldsValue({ subcharacteristic: undefined })} />
            </Form.Item>
          </Space>
          <Form.Item name="subcharacteristic" label="Субхарактеристика" rules={[{ required: true, message: 'Выберите субхарактеристику' }]}>
            <Select
              disabled={!selChar} showSearch optionFilterProp="label"
              options={subsOf(selGroup, selChar).map((s) => ({
                value: s.name,
                label: `${s.name}${s.is_ai_specific ? ' · ИИ-специфичная' : ''} (${s.metric_kind})`,
              }))}
            />
          </Form.Item>

          {subMeta && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message={<span>Метрика каталога: <Tag>{subMeta.metric_kind}</Tag>{subMeta.is_ai_specific && <Tag color="purple">ИИ-специфичная</Tag>}</span>}
              description={subMeta.hint} />
          )}

          {subMeta && !unmeasurable && (
            <Form.Item
              name="metric_kind"
              label={<Tooltip title="Номенклатура метрик настраиваемая (ГОСТ 59898, разд. 8 — рекомендательный): можно заменить вид метрики, например на MSE/AUC/NDCG (E2)">Вид метрики (переопределить)</Tooltip>}
            >
              <Select
                allowClear
                placeholder={`По каталогу: ${subMeta.metric_kind}`}
                options={Object.keys(KIND_SCHEMAS).map((k) => ({ value: k, label: k }))}
              />
            </Form.Item>
          )}

          <Form.Item name="unmeasurable" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>Невозможно измерить (нет возможности собрать данные) — комментарий обязателен</Checkbox>
          </Form.Item>

          {!unmeasurable && subMeta && (
            <>
              <Space wrap size="middle" style={{ width: '100%' }}>
                {effectiveSchema.map((k) => (
                  ARRAY_FIELDS.has(k) || CURVE_FIELDS.has(k) ? (
                    <Form.Item key={`${effectiveKind}-${k}`} name={`in_${k}`} label={INPUT_LABEL[k] ?? k}
                      style={{ minWidth: 300, flex: 1 }}
                      rules={[{ required: true, message: 'Обязательное поле' }]}>
                      <Input.TextArea rows={2}
                        placeholder={CURVE_FIELDS.has(k) ? '0,0; 0.2,0.7; 1,1' : '1.2, 3.4, 5.6, …'} />
                    </Form.Item>
                  ) : (
                    <Form.Item key={`${effectiveKind}-${k}`} name={`in_${k}`} label={INPUT_LABEL[k] ?? k}
                      rules={k === 'max_i' ? [] : [{ required: true, message: 'Обязательное поле' }]}>
                      <InputNumber min={0} style={{ width: 150 }} placeholder={k === 'max_i' ? '255' : undefined} />
                    </Form.Item>
                  )
                ))}
              </Space>
              <Space wrap size="middle">
                <Form.Item name="baseline" label={<Tooltip title="Базовое (эталонное) значение mₗ — критерий соответствия ГОСТ 59898, п. 7.1.3">Эталон (baseline)</Tooltip>}>
                  <InputNumber min={0} max={1} step={0.01} style={{ width: 150 }} placeholder="напр. 0.95" />
                </Form.Item>
                <Form.Item name="tol_low" label="Допуск ε⁻ (вниз)">
                  <InputNumber min={0} max={1} step={0.01} style={{ width: 140 }} placeholder="0.03" />
                </Form.Item>
                <Form.Item name="tol_high" label="Допуск ε⁺ (вверх)">
                  <InputNumber min={0} max={1} step={0.01} style={{ width: 140 }} placeholder="0.05" />
                </Form.Item>
              </Space>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                X = 1 при совпадении с эталоном, убывает к границе допуска. Без эталона X = само значение метрики.
              </Text>
            </>
          )}

          <Form.Item
            name="expert_comment" label="Комментарий"
            rules={unmeasurable ? [{ required: true, message: 'Опишите, почему нет возможности собрать данные' }] : []}
          >
            <Input.TextArea rows={2}
              placeholder={unmeasurable ? 'Причина: почему невозможно измерить (обязательно)' : 'Источник данных, артефакты (необязательно)'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Веса характеристик (E2): Σ=1, взвешенный Q по формулам 3–8 */}
      <Modal
        title="Весовые коэффициенты характеристик (uₖ, Σ = 1)"
        open={weightsOpen} onCancel={() => setWeightsOpen(false)}
        footer={[
          <Button key="reset" onClick={() => saveWeights(true)}>Сбросить (равные веса)</Button>,
          <Button key="save" type="primary" onClick={() => saveWeights(false)}>Сохранить</Button>,
        ]}
        width={560}
      >
        <Alert
          type={Math.abs(weightSum - 1) <= 0.001 || weightSum === 0 ? 'info' : 'warning'}
          showIcon style={{ marginBottom: 12 }}
          message={<span>Σ весов = <b>{weightSum.toFixed(3)}</b> {weightSum === 0 ? '(пусто — свёртка с равными весами)' : Math.abs(weightSum - 1) <= 0.001 ? '✓' : '— требуется 1.0'}</span>}
          description="Вес отражает значимость характеристики для конкретной СИИ (представительный набор, п. 7.1.4). Пустые поля не участвуют."
        />
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {allCharacteristics.map((c) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontSize: 13 }} ellipsis title={c}>{c}</Text>
              <InputNumber
                min={0} max={1} step={0.05} style={{ width: 120 }}
                value={charWeights[c] ?? undefined}
                placeholder="—"
                onChange={(v) => setCharWeights((prev) => ({ ...prev, [c]: v ?? null }))}
              />
            </div>
          ))}
        </Space>
      </Modal>

      {/* Отчёт соответствия (критерий приёмки 7) */}
      <Modal
        title={<span><FileDoneOutlined /> Отчёт соответствия базовым значениям</span>}
        open={reportOpen} onCancel={() => setReportOpen(false)} footer={null} width={860}
      >
        {report && (
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Space size="large" wrap>
              <Text strong>Q = {report.q != null ? report.q.toFixed(3) : '—'}</Text>
              <Tag>{report.level}</Tag>
              <Tag color="green">В допуске: {report.conformant_count}</Tag>
              <Tag color="red">Вне допуска: {report.nonconformant_count}</Tag>
              <Tag>Без эталона: {report.no_baseline_count}</Tag>
            </Space>
            <Table<ConfRow>
              dataSource={report.rows} rowKey={(r) => `${r.characteristic}|${r.subcharacteristic}`}
              size="small" bordered pagination={false} scroll={{ y: 400 }}
              columns={[
                { title: 'Характеристика', dataIndex: 'characteristic', width: 180, ellipsis: true },
                { title: 'Субхарактеристика', dataIndex: 'subcharacteristic', ellipsis: true },
                { title: 'Значение', dataIndex: 'raw_value', width: 90, render: (v: number | null) => v == null ? '—' : v.toFixed(3) },
                { title: 'Эталон', dataIndex: 'baseline', width: 80, render: (v: number | null) => v == null ? '—' : v },
                { title: 'ε⁻/ε⁺', key: 'tol', width: 90, render: (_: unknown, r) => r.baseline == null ? '—' : `${r.tol_low ?? 0}/${r.tol_high ?? 0}` },
                { title: 'X', dataIndex: 'normalized_x', width: 70, render: (v: number | null) => v == null ? '—' : v.toFixed(3) },
                { title: 'Вердикт', dataIndex: 'verdict', width: 150, render: (v: string) => <Tag color={VERDICT_TAG[v]}>{v}</Tag> },
              ]}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default AiAssessmentPage;
