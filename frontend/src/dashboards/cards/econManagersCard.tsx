/**
 * econManagersCard.tsx — «Эффективность руководителей» риск-экономического контура.
 *
 * Одиннадцать столбцов и пять плиток — отдельный модуль, чтобы econCards остался читаемым.
 * Метрики выводятся ПАКЕТОМ и без привязки к мотивации (§7.1): при прямой связи с премией
 * любая из них ломается — дробление мер, срок с запасом, завышение исходной оценки риска.
 */
import React from 'react';
import { Alert, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import KpiCard from '../../components/KpiCard';
import { SPACE } from '../../theme/premium';
import { numericColumn, sorterFor } from '../../theme/table';
import { BRAND, RAG } from '../../theme/ragPalette';
import { useEconScope, fmtMoney, fmtNum, fmtMln, type ManagerMetricRow } from '../scopes/EconScope';
import GridCard from '../GridCard';

const { Text } = Typography;
// ─────────────────── Эффективность руководителей ───────────────────

export const EconManagersCard: React.FC = () => {
  const { managers, managersLoading, managersError } = useEconScope();
  const rows = managers?.rows ?? [];
  const totals = {
    owners: rows.length,
    open: rows.reduce((s, r) => s + r.openCount, 0),
    overdue: rows.reduce((s, r) => s + r.overdueCount, 0),
    delta: rows.reduce((s, r) => s + r.deltaAleManaged, 0),
    // В-41: сколько мер без оценки часов — чтобы не спутать «мало нагрузки» с «нагрузку не оценили».
    withoutEstimate: rows.reduce((s, r) => s + r.measuresWithoutEstimate, 0),
  };

  const columns: ColumnsType<ManagerMetricRow> = [
    { title: 'Владелец', dataIndex: 'owner', width: 200, sorter: sorterFor((r: ManagerMetricRow) => r.owner), render: (o: string) => <Text strong>{o}</Text> },
    numericColumn({ title: 'Нагрузка', dataIndex: 'openCount', width: 110, sorter: sorterFor((r: ManagerMetricRow) => r.openCount) }),
    numericColumn({ title: 'Просрочено', dataIndex: 'overdueCount', width: 120,
      sorter: sorterFor((r: ManagerMetricRow) => r.overdueCount),
      render: (v: number) => <Text style={{ color: v > 0 ? RAG.bad.strong : BRAND.inkSoft }}>{v}</Text> }),
    numericColumn({ title: 'Выполнено', dataIndex: 'completedCount', width: 120,
      sorter: sorterFor((r: ManagerMetricRow) => r.completedCount),
      render: (v: number) => <Text style={{ color: v > 0 ? RAG.good.strong : BRAND.inkSoft }}>{v}</Text> }),
    numericColumn({ title: 'Средний возраст, дн', dataIndex: 'avgAgeDays', width: 170,
      sorter: sorterFor((r: ManagerMetricRow) => r.avgAgeDays), render: (v: number | null) => fmtNum(v, 1) }),
    numericColumn({ title: 'Δ ALE под управлением', dataIndex: 'deltaAleManaged', width: 200,
      sorter: sorterFor((r: ManagerMetricRow) => r.deltaAleManaged), render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'Доля «принять», %', dataIndex: 'acceptShare', width: 160,
      sorter: sorterFor((r: ManagerMetricRow) => r.acceptShare),
      // Высокая доля «принять» — сигнал: проблемы прячут вместо решения (§7.1).
      render: (v: number) => <Text style={{ color: v >= 50 ? RAG.medium.strong : BRAND.inkSoft }}>{fmtNum(v, 1)}</Text> }),
    numericColumn({ title: 'Доля компенсирующих, %', dataIndex: 'compensatingShare', width: 200,
      sorter: sorterFor((r: ManagerMetricRow) => r.compensatingShare),
      // Много компенсирующих — лечение симптомов вместо причин (§7.1).
      render: (v: number) => <Text style={{ color: v >= 50 ? RAG.medium.strong : BRAND.inkSoft }}>{fmtNum(v, 1)}</Text> }),
    numericColumn({ title: 'Взвеш. нагрузка', dataIndex: 'weightedLoad', width: 150,
      sorter: sorterFor((r: ManagerMetricRow) => r.weightedLoad), render: (v: number) => fmtNum(v, 0) }),
    numericColumn({ title: 'Часы (оценено)', dataIndex: 'hoursEstimated', width: 140,
      sorter: sorterFor((r: ManagerMetricRow) => r.hoursEstimated), render: (v: number) => `${fmtNum(v, 1)} ч` }),
    numericColumn({ title: 'Мер без оценки часов', dataIndex: 'measuresWithoutEstimate', width: 180,
      sorter: sorterFor((r: ManagerMetricRow) => r.measuresWithoutEstimate),
      render: (v: number) => <Text style={{ color: v > 0 ? RAG.medium.strong : BRAND.inkSoft }}>{v}</Text> }),
  ];

  return (
    <GridCard title="Эффективность руководителей" accent="slate" hint="диагностический режим — без привязки к мотивации">
      <Space size="middle" wrap style={{ marginBottom: SPACE.cozy }}>
        <KpiCard title="Руководителей" value={totals.owners} loading={managersLoading} />
        <KpiCard title="Открытых задач" value={totals.open} loading={managersLoading} />
        <KpiCard title="Просрочено" value={totals.overdue} loading={managersLoading}
          color={totals.overdue > 0 ? RAG.bad.strong : undefined} />
        <KpiCard title="Δ ALE под управлением" value={fmtMln(totals.delta)} hint="₽/год" loading={managersLoading} />
        <KpiCard title="Мер без оценки часов" value={totals.withoutEstimate} loading={managersLoading}
          color={totals.withoutEstimate > 0 ? RAG.medium.strong : undefined}
          hint="не входят во взвешенную нагрузку" />
      </Space>

      <Alert type="info" showIcon style={{ marginBottom: SPACE.cozy }}
        message="Диагностический режим — без привязки к мотивации"
        description={managers?.note ?? 'Метрики выводятся пакетом, не по одной: при прямой привязке к премии любая из них ломается (дробление мер, срок с запасом, завышение исходной оценки риска). Первые 2 квартала — наблюдение и калибровка порогов.'} />

      {managersError && <Alert type="error" showIcon message="Ошибка загрузки" description={managersError} style={{ marginBottom: SPACE.cozy }} />}

      <Table<ManagerMetricRow>
        columns={columns} dataSource={rows} rowKey="owner" loading={managersLoading} size="small"
        scroll={{ x: 1750 }} pagination={{ pageSize: 15, hideOnSinglePage: true }}
        locale={{ emptyText: 'Нет данных: метрики появятся, когда у несоответствий и мер будут указаны владельцы.' }}
      />
    </GridCard>
  );
};

