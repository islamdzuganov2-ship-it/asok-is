/**
 * AiCompareCard.tsx — сравнение нескольких СИИ в единых шкалах (ГОСТ Р 59898-2021, п. 7.2.2.5; BL-001 E3).
 *
 * Сравниваются только субхарактеристики, измеренные во всех выбранных оценках одной метрикой
 * с одинаковыми эталоном и допусками; остальные показаны с причиной исключения. Рейтинг — по
 * интегральному показателю на этом общем наборе, полный Q каждой оценки — справочно рядом.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Select, Space, Tag, Typography } from 'antd';
import AppTable, { type AppColumn } from '../../components/AppTable';
import { message } from '../../theme/appMessage';
import { premiumCard } from '../../theme/premium';
import { aiApi, type CompareOut } from './aiE3Api';
import type { AiPeriod } from './aiModel';

const { Text } = Typography;
type Rank = CompareOut['ranking'][number];
type Common = CompareOut['common'][number];

export const AiCompareCard: React.FC = () => {
  const [periods, setPeriods] = useState<AiPeriod[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [res, setRes] = useState<CompareOut | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { aiApi<AiPeriod[]>('/periods').then(setPeriods).catch(() => setPeriods([])); }, []);

  const run = async () => {
    setBusy(true);
    try { setRes(await aiApi<CompareOut>(`/compare?period_ids=${picked.join(',')}`)); }
    catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  };

  const labelOf = (id: string) => {
    const p = periods.find((x) => x.id === id);
    return p ? `${p.system_name ?? '—'} · ${p.period}` : id;
  };
  const rankCols: AppColumn<Rank>[] = [
    { title: 'СИИ', dataIndex: 'system', render: (v: string, r) => <span><Text strong>{v}</Text> · {r.period}</span> },
    { title: 'Q на общем наборе', dataIndex: 'q_common', width: 170, render: (v: number | null) => (v == null ? '—' : v.toFixed(3)) },
    { title: 'Уровень', dataIndex: 'level', width: 160, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Полный Q (справочно)', dataIndex: 'q_full', width: 180, render: (v: number | null) => (v == null ? '—' : v.toFixed(3)) },
  ];
  const commonCols: AppColumn<Common>[] = [
    { title: 'Субхарактеристика', dataIndex: 'subcharacteristic', render: (v: string, r) => <span>{v}<Text type="secondary"> · {r.characteristic}</Text></span> },
    ...(res?.ranking ?? []).map((_, i): AppColumn<Common> => ({
      title: labelOf(picked[i] ?? ''), key: `v${i}`, width: 150, exportValue: (r) => r.values[i],
      render: (_v: unknown, r) => r.values[i]?.toFixed(3) ?? '—',
    })),
  ];

  return (
    <Card {...premiumCard('gold', { marginTop: 16 })} title="Сравнение СИИ в единых шкалах (п. 7.2.2.5)">
      <Space wrap style={{ marginBottom: 12 }}>
        <Select mode="multiple" style={{ minWidth: 420 }} placeholder="Выберите оценки двух и более СИИ" value={picked}
          onChange={setPicked} options={periods.map((p) => ({ value: p.id, label: labelOf(p.id) }))} />
        <Button type="primary" disabled={picked.length < 2} loading={busy} onClick={run}>Сравнить</Button>
      </Space>
      {res && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type={res.common.length ? 'info' : 'warning'} showIcon message={res.note} />
          <AppTable<Rank> tableKey="ai-compare-ranking" rowKey="period_id" size="small" pagination={false} dataSource={res.ranking} columns={rankCols} />
          <AppTable<Common> tableKey="ai-compare-common" exportName="sravnenie-sii" size="small" pagination={false}
            rowKey={(r) => `${r.characteristic}|${r.subcharacteristic}`} dataSource={res.common} columns={commonCols}
            locale={{ emptyText: 'Нет субхарактеристик, измеренных во всех оценках в одной шкале' }} />
          {res.excluded.length > 0 && (
            <Text type="secondary">
              Исключены: {res.excluded.map((e) => `${e.subcharacteristic} — ${e.reason}`).join('; ')}
            </Text>
          )}
        </Space>
      )}
    </Card>
  );
};

export default AiCompareCard;
