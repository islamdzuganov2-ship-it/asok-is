/**
 * AiExpertTab.tsx — экспертная группа и согласованность (ГОСТ Р 59898-2021, п. 7.2; BL-001 E3).
 *
 * Каждый эксперт с правом `ai.expert.evaluate` вносит СВОИ оценки 0–100 по субхарактеристикам;
 * согласованность группы — коэффициент конкордации Кендалла W с проверкой значимости по χ².
 * В значения EXPERT_SCALE переносится только средняя оценка СОГЛАСОВАННОЙ группы.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, InputNumber, Select, Space, Tag, Typography } from 'antd';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import AppTable, { type AppColumn } from '../../components/AppTable';
import { message } from '../../theme/appMessage';
import { aiApi, currentLogin, kendallVerdict, type ConsensusOut } from './aiE3Api';
import type { AiGroup } from './aiModel';

const { Text } = Typography;
type Row = ConsensusOut['objects'][number];

export const AiExpertTab: React.FC<{ periodId: string; model: AiGroup[]; onApplied: () => void }> = ({ periodId, model, onApplied }) => {
  const canEvaluate = useSelector((s: RootState) => s.auth.permissions.includes('ai.expert.evaluate'));
  const me = useMemo(currentLogin, []);
  const [data, setData] = useState<ConsensusOut | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [mine, setMine] = useState<Record<string, number | null>>({});

  const pairs = useMemo(() => model.flatMap((g) => g.characteristics.flatMap((c) => c.subs.map((s) => `${c.title} / ${s.name}`))), [model]);
  const load = useCallback(() => {
    aiApi<ConsensusOut>(`/${periodId}/expert-consensus`).then((d) => {
      setData(d);
      setPick(d.objects.map((o) => `${o.characteristic} / ${o.subcharacteristic}`));
      setMine(Object.fromEntries(d.objects.map((o) => [`${o.characteristic} / ${o.subcharacteristic}`, o.scores[me] ?? null])));
    }).catch((e) => message.error(e.message));
  }, [periodId, me]);
  useEffect(load, [load]);

  const save = async () => {
    const items = pick.filter((k) => mine[k] != null).map((k) => {
      const [characteristic, subcharacteristic] = k.split(' / ');
      return { characteristic, subcharacteristic, score: mine[k] };
    });
    if (!items.length) { message.warning('Поставьте оценки 0–100'); return; }
    try { await aiApi(`/${periodId}/expert-scores`, { method: 'PUT', body: JSON.stringify(items) }); message.success('Оценки сохранены'); load(); }
    catch (e: any) { message.error(e.message); }
  };
  const apply = async () => {
    try {
      const r = await aiApi<{ applied: number }>(`/${periodId}/expert-consensus/apply`, { method: 'POST' });
      message.success(`Групповая оценка перенесена в ${r.applied} значени(й) экспертной шкалы`); onApplied();
    } catch (e: any) { message.error(e.message); }
  };

  const experts = data?.experts ?? [];
  const k = data?.kendall ?? null;
  const rows: Row[] = pick.map((key) => data?.objects.find((o) => `${o.characteristic} / ${o.subcharacteristic}` === key)
    ?? { characteristic: key.split(' / ')[0], subcharacteristic: key.split(' / ')[1], mean: null, rank_sum: null, scores: {} });
  const columns: AppColumn<Row>[] = [
    { title: 'Субхарактеристика', dataIndex: 'subcharacteristic', render: (v: string, r) => <span>{v}<Text type="secondary"> · {r.characteristic}</Text></span> },
    ...experts.filter((e) => e.login !== me).map((e): AppColumn<Row> => ({
      title: e.name || e.login, key: e.login, width: 110, exportValue: (r) => r.scores[e.login] ?? null,
      render: (_: unknown, r) => r.scores[e.login] ?? '—',
    })),
    { title: 'Моя оценка', key: 'mine', width: 130, sortable: false, render: (_: unknown, r) => {
      const key = `${r.characteristic} / ${r.subcharacteristic}`;
      return <InputNumber min={0} max={100} disabled={!canEvaluate} value={mine[key] ?? null} onChange={(v) => setMine((m) => ({ ...m, [key]: v }))} />;
    } },
    { title: 'Среднее', dataIndex: 'mean', width: 100 },
    { title: 'Сумма рангов', dataIndex: 'rank_sum', width: 120 },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type={k?.consistent ? 'success' : 'warning'} showIcon
        message={<Space wrap><span>Экспертов: {experts.length}</span>{k?.w != null && <Tag color={k.consistent ? 'green' : 'orange'}>W = {k.w.toFixed(3)}</Tag>}</Space>}
        description={kendallVerdict(k)} />
      <Space wrap>
        <Select mode="multiple" style={{ minWidth: 420 }} placeholder="Субхарактеристики для экспертной оценки" value={pick}
          onChange={setPick} options={pairs.map((p) => ({ value: p, label: p }))} maxTagCount={3} />
        {canEvaluate && <Button type="primary" onClick={save}>Сохранить мои оценки</Button>}
        <Button disabled={!k?.consistent} onClick={apply}>Перенести групповую оценку</Button>
      </Space>
      <AppTable<Row> tableKey="ai-expert-group" exportName="ekspertnaya-gruppa" size="small" pagination={false}
        rowKey={(r) => `${r.characteristic}|${r.subcharacteristic}`} dataSource={rows} columns={columns}
        locale={{ emptyText: 'Выберите субхарактеристики — эксперты оценивают их независимо, по шкале 0–100' }} />
      {!canEvaluate && <Text type="secondary">Вносить оценки может участник экспертной группы (право «Оценка СИИ: эксперт группы»).</Text>}
    </Space>
  );
};

export default AiExpertTab;
