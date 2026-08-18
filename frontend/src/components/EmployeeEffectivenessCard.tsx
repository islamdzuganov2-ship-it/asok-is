/**
 * EmployeeEffectivenessCard.tsx — «Эффективность сотрудников» (ТЗ v17, req 7).
 *
 * По ФИО ответственных (owner мер), с разбивкой по кварталам (из срока dueDate):
 *   • сколько мер назначено, сколько выполнено / ожидает / просрочено-или-не-выполнено;
 *   • эффективность в % = выполнено / назначено.
 * Назначенными считаем не отклонённые меры с ответственным (как в «Плане задач»).
 *
 * Размещение (req 7): на управленческом дашборде — под техдолгом и теплокартой; и в самом верху
 * «Плана задач». Компонент переиспользуемый: принимает proposals, как TechDebtCard.
 */
import React, { useMemo, useState } from 'react';
import { Card, Empty, Progress, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { TeamOutlined } from '@ant-design/icons';
import type { Proposal } from '../store/slices/governanceSlice';
import { BRAND, RAG, ragByScore, solidTagStyle } from '../theme/ragPalette';
import { premiumCard, accentDot, GOLD, SPACE, TYPE } from '../theme/premium';
import { sorterFor } from '../theme/table';
import { useCharacteristicWeights } from '../hooks/useCharacteristicWeights';

const { Text } = Typography;

// «Сегодня» демо — как в TechDebtCard, чтобы две карточки на дашборде были согласованы.
const TODAY = new Date(2026, 5, 26).getTime();

function parseDue(d?: string): Date | null {
  if (!d) return null;
  const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

const quarterOf = (d: Date): string => `Q${Math.floor(d.getMonth() / 3) + 1}-${d.getFullYear()}`;
const quarterSort = (k: string) => { const [q, y] = k.slice(1).split('-'); return Number(y) * 10 + Number(q); };

type Bucket = 'done' | 'awaiting' | 'overdue';
function bucketOf(p: Proposal): Bucket {
  if (p.execution === 'DONE') return 'done';
  if (p.execution === 'NOT_DONE') return 'overdue';
  const due = parseDue(p.dueDate);
  if (due && due.getTime() < TODAY) return 'overdue';
  return 'awaiting';
}

interface Row {
  owner: string;
  role?: string;
  quarters: string[];
  total: number;
  done: number;
  awaiting: number;
  overdue: number;
  effectiveness: number; // %
}

interface Props {
  proposals: Proposal[];
  /** style/props прокидываются в Card (например marginTop). */
  style?: React.CSSProperties;
  /**
   * Клик по ФИО или по числу в строке — переход к задачам этого сотрудника (План задач/Гант),
   * `statusFilter` — один из ключей Segmented-фильтра «Плана задач» ('Все'/'Выполнено'/
   * 'Просрочено'/'Активные'), не задан при клике на ФИО или на «Назначено».
   */
  onSelectOwner?: (owner: string, statusFilter?: string) => void;
}

export const EmployeeEffectivenessCard: React.FC<Props> = ({ proposals, style, onSelectOwner }) => {
  const [quarter, setQuarter] = useState<string | undefined>();
  const { weights: charWeights } = useCharacteristicWeights();
  // Вес меры для взвешенной эффективности — по её характеристике (ГОСТ 25010, ТЗ v20 п.3).
  // Неизвестная характеристика (не должна встречаться — веса покрывают всю QUALITY_MODEL) даёт 0:
  // мера не тянет ни числитель, ни знаменатель, вместо падения расчёта.
  const weightOf = (p: Proposal) => charWeights[p.characteristic] ?? 0;

  // Назначенные меры = не отклонённые, с ответственным.
  const assigned = useMemo(
    () => proposals.filter((p) => p.status !== 'REJECTED' && (p.owner || '').trim()),
    [proposals],
  );

  const allQuarters = useMemo(() => {
    const set = new Set<string>();
    assigned.forEach((p) => { const d = parseDue(p.dueDate); if (d) set.add(quarterOf(d)); });
    return [...set].sort((a, b) => quarterSort(a) - quarterSort(b));
  }, [assigned]);

  const scoped = useMemo(
    () => (quarter ? assigned.filter((p) => { const d = parseDue(p.dueDate); return d && quarterOf(d) === quarter; }) : assigned),
    [assigned, quarter],
  );

  const rows = useMemo<Row[]>(() => {
    const byOwner = new Map<string, Row>();
    // Вес по владельцу — отдельно от Row (счётчики в Row остаются простыми числами задач для
    // столбцов таблицы; эффективность считается по весам параллельно).
    const weightByOwner = new Map<string, { applied: number; done: number }>();
    for (const p of scoped) {
      const owner = (p.owner as string).trim();
      const r = byOwner.get(owner) ?? { owner, role: p.ownerRole, quarters: [], total: 0, done: 0, awaiting: 0, overdue: 0, effectiveness: 0 };
      r.total += 1;
      r[bucketOf(p)] += 1;
      const d = parseDue(p.dueDate);
      if (d) { const q = quarterOf(d); if (!r.quarters.includes(q)) r.quarters.push(q); }
      if (!r.role && p.ownerRole) r.role = p.ownerRole;
      byOwner.set(owner, r);

      const w = weightByOwner.get(owner) ?? { applied: 0, done: 0 };
      const weight = weightOf(p);
      w.applied += weight;
      if (bucketOf(p) === 'done') w.done += weight;
      weightByOwner.set(owner, w);
    }
    const out = [...byOwner.values()];
    out.forEach((r) => {
      const w = weightByOwner.get(r.owner);
      r.effectiveness = w && w.applied > 0 ? Math.round((w.done / w.applied) * 100) : 0;
      r.quarters.sort((a, b) => quarterSort(a) - quarterSort(b));
    });
    // Сортировка: больше назначено → выше; при равенстве — выше эффективность.
    return out.sort((a, b) => (b.total - a.total) || (b.effectiveness - a.effectiveness));
  }, [scoped, charWeights]);

  // Числа кликабельны, только если родитель дал обработчик (карточка переиспользуется в местах
  // без перехода к «Плану задач», например — если понадобится встроить её в отчёт).
  const STATUS_OF: Record<Bucket, string> = { done: 'Выполнено', awaiting: 'Активные', overdue: 'Просрочено' };
  const numCol = (title: string, key: Bucket, color: string): ColumnsType<Row>[number] => ({
    title, dataIndex: key, key, width: 104, align: 'center' as const,
    sorter: (a: Row, b: Row) => a[key] - b[key],
    render: (n: number, r) => (
      <Text
        strong
        style={{ color: n ? color : BRAND.inkSoft, cursor: onSelectOwner ? 'pointer' : undefined }}
        onClick={onSelectOwner ? (e) => { e.stopPropagation(); onSelectOwner(r.owner, STATUS_OF[key]); } : undefined}
      >
        {n}
      </Text>
    ),
  });

  const columns: ColumnsType<Row> = [
    {
      title: 'Сотрудник', dataIndex: 'owner', key: 'owner',
      sorter: sorterFor((r: Row) => r.owner),
      render: (owner: string, r) => (
        <div
          style={{ cursor: onSelectOwner ? 'pointer' : undefined }}
          onClick={onSelectOwner ? (e) => { e.stopPropagation(); onSelectOwner(owner); } : undefined}
        >
          <Text strong style={onSelectOwner ? { color: BRAND.ink, textDecoration: 'underline', textDecorationColor: BRAND.divider } : { color: BRAND.ink }}>
            {owner}
          </Text>
          {r.role && <div style={{ ...TYPE.caption, color: BRAND.inkSoft }}>{r.role}</div>}
        </div>
      ),
    },
    {
      title: 'Кварталы', dataIndex: 'quarters', key: 'quarters', width: 150,
      sorter: sorterFor((r: Row) => r.quarters?.length ?? 0),
      render: (qs: string[]) => (
        <Space size={4} wrap>
          {qs.length ? qs.map((q) => (
            <Tag
              key={q}
              style={{ marginInlineEnd: 0, cursor: 'pointer' }}
              color={quarter === q ? 'gold' : undefined}
              onClick={(e) => { e.stopPropagation(); setQuarter(quarter === q ? undefined : q); }}
            >
              {q}
            </Tag>
          )) : <Text type="secondary">—</Text>}
        </Space>
      ),
    },
    {
      title: 'Назначено', dataIndex: 'total', key: 'total', width: 96, align: 'center',
      sorter: (a, b) => a.total - b.total,
      render: (n: number, r) => (
        <Text
          strong
          style={{ cursor: onSelectOwner ? 'pointer' : undefined }}
          onClick={onSelectOwner ? (e) => { e.stopPropagation(); onSelectOwner(r.owner, 'Все'); } : undefined}
        >
          {n}
        </Text>
      ),
    },
    numCol('Выполнено', 'done', RAG.good.strong),
    numCol('Ожидает', 'awaiting', '#50749B'),
    numCol('Просрочено', 'overdue', RAG.bad.strong),
    {
      title: 'Эффективность', dataIndex: 'effectiveness', key: 'eff', width: 168,
      defaultSortOrder: undefined,
      sorter: (a, b) => a.effectiveness - b.effectiveness,
      render: (pct: number) => {
        const tok = RAG[ragByScore(pct)];
        return (
          <Tooltip title={`Выполнено ${pct}% от назначенных мер`}>
            <Progress percent={pct} size="small" strokeColor={tok.color} trailColor={BRAND.divider}
              format={(p) => <span style={{ color: tok.strong, fontWeight: 600 }}>{p}%</span>} />
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Card
      title={<span style={{ color: BRAND.ink }}><span style={accentDot(GOLD.base)} /><TeamOutlined /> Эффективность сотрудников</span>}
      extra={(
        <Space size={SPACE.snug}>
          <Text type="secondary" style={{ fontSize: 12 }}>Квартал:</Text>
          <Select allowClear size="small" style={{ width: 132 }} placeholder="Все кварталы"
            value={quarter} onChange={setQuarter}
            options={allQuarters.map((q) => ({ value: q, label: q }))} />
        </Space>
      )}
      {...premiumCard('gold')}
      style={{ ...premiumCard('gold').style, ...style }}
    >
      {rows.length === 0 ? (
        <Empty style={{ padding: 24 }} description="Нет назначенных мер с ответственным в выбранном периоде" />
      ) : (
        <Table<Row>
          style={{ marginTop: SPACE.cozy }}
          size="small"
          rowKey="owner"
          columns={columns}
          dataSource={rows}
          pagination={rows.length > 8 ? { pageSize: 8, size: 'small', hideOnSinglePage: true } : false}
          scroll={{ x: 760 }}
        />
      )}
    </Card>
  );
};

export default EmployeeEffectivenessCard;
