/**
 * AiParityTab.tsx — паритет тестовой и эксплуатационной сред (ГОСТ Р 59898-2021, табл. 3; BL-001 E3).
 *
 * По каждому фактору — как в тесте, как в эксплуатации и вердикт. Отличие допустимо только с
 * обоснованием; незаполненный фактор — «не проверено», а не «совпадает».
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Tag, Typography } from 'antd';
import AppTable from '../../components/AppTable';
import { message } from '../../theme/appMessage';
import { aiApi, PARITY_STATUS, type ParityOut, type ParityRow } from './aiE3Api';

const { Text } = Typography;

export const AiParityTab: React.FC<{ periodId: string; onChanged: () => void }> = ({ periodId, onChanged }) => {
  const [data, setData] = useState<ParityOut | null>(null);
  const [draft, setDraft] = useState<Record<string, ParityRow>>({});
  const [saving, setSaving] = useState(false);

  const apply = (d: ParityOut) => {
    setData(d);
    setDraft(Object.fromEntries(d.factors.map((f) => {
      const row = d.rows.find((r) => r.factor === f.code);
      return [f.code, row ?? { factor: f.code, test_env: '', prod_env: '', status: '', justification: '' }];
    })));
  };
  useEffect(() => { aiApi<ParityOut>(`/${periodId}/env-parity`).then(apply).catch((e) => message.error(e.message)); }, [periodId]);

  const set = (code: string, patch: Partial<ParityRow>) => setDraft((d) => ({ ...d, [code]: { ...d[code], ...patch } }));
  const save = async () => {
    const rows = Object.values(draft).filter((r) => r.status);
    setSaving(true);
    try {
      apply(await aiApi<ParityOut>(`/${periodId}/env-parity`, { method: 'PUT', body: JSON.stringify(rows) }));
      message.success('Паритет сред сохранён'); onChanged();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  };

  if (!data) return null;
  const s = data.summary;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type={s.ok ? 'success' : 'warning'} showIcon
        message={s.ok ? 'Паритет сред подтверждён по всем факторам табл. 3'
          : `Проверено факторов: ${s.checked} из ${s.total}${s.mismatches.length ? `, расхождений: ${s.mismatches.length}` : ''}`}
        description={s.ok ? undefined : 'Результаты испытаний переносятся на эксплуатацию, только если среды совпадают или отличия обоснованы.'} />
      {/* Порядок факторов задан табл. 3 стандарта — колонки без сортировки. */}
      <AppTable<{ code: string; label: string }> tableKey="ai-env-parity" size="small" rowKey="code" pagination={false} dataSource={data.factors}
        columns={[
          { title: 'Фактор (табл. 3)', dataIndex: 'label', width: 260, sortable: false, render: (v: string) => <Text strong>{v}</Text> },
          { title: 'В тестовой среде', key: 'test', render: (_: unknown, f) => <Input value={draft[f.code]?.test_env ?? ''} onChange={(e) => set(f.code, { test_env: e.target.value })} /> },
          { title: 'В эксплуатации', key: 'prod', render: (_: unknown, f) => <Input value={draft[f.code]?.prod_env ?? ''} onChange={(e) => set(f.code, { prod_env: e.target.value })} /> },
          { title: 'Вердикт', key: 'status', width: 190, render: (_: unknown, f) => (
            <Select value={draft[f.code]?.status || undefined} placeholder="не проверено" style={{ width: 180 }}
              onChange={(v) => set(f.code, { status: v })}
              options={Object.entries(PARITY_STATUS).map(([value, x]) => ({ value, label: <Tag color={x.color}>{x.label}</Tag> }))} />
          ) },
          { title: 'Обоснование отличия', key: 'just', render: (_: unknown, f) => (
            <Input value={draft[f.code]?.justification ?? ''} disabled={draft[f.code]?.status !== 'ACCEPTABLE'}
              placeholder={draft[f.code]?.status === 'ACCEPTABLE' ? 'почему отличие не влияет на метрики' : ''}
              onChange={(e) => set(f.code, { justification: e.target.value })} />
          ) },
        ]} />
      <Button type="primary" loading={saving} onClick={save}>Сохранить паритет</Button>
    </Space>
  );
};

export default AiParityTab;
