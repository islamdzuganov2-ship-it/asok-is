/**
 * OwnerLink.tsx — «разрез по руководителю» на каждой карточке (ТЗ v19 п.5, УК-05).
 *
 * Drop-in замена статичного <Text>{owner}</Text>: клик по имени ответственного открывает
 * лёгкую карточку руководителя — текущая нагрузка/просрочка/выполнено по мерам и
 * несоответствиям (тот же /econ/manager-metrics, что и вкладка «Эффективность руководителей»
 * на RiskEconomicsPage — не отдельный источник данных, а тот же самый, просто по одному имени).
 * Без owner — просто нейтральный текст «не назначен», не ссылка (кликать некуда).
 */
import React, { useState } from 'react';
import { Modal, Typography, Space, Statistic, Empty, Spin } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { RAG } from '../theme/ragPalette';

const { Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface ManagerRow {
  owner: string; openCount: number; overdueCount: number; completedCount: number;
  weightedLoad: number; hoursEstimated: number; measuresWithoutEstimate: number;
  deltaAleManaged: number;
}

let rowsCache: ManagerRow[] | null = null;
async function fetchRows(): Promise<ManagerRow[]> {
  if (rowsCache) return rowsCache;
  try {
    const token = localStorage.getItem('token');
    const r = await fetch(`${VITE_API}/econ/manager-metrics`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) return [];
    const d = await r.json();
    rowsCache = Array.isArray(d?.rows) ? d.rows : [];
    return rowsCache ?? [];
  } catch {
    return [];
  }
}

interface Props {
  owner?: string | null;
  fallback?: string;
}

export const OwnerLink: React.FC<Props> = ({ owner, fallback = 'не назначен' }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<ManagerRow | null | undefined>(undefined); // undefined = ещё не загружено

  if (!owner) return <Text type="secondary">{fallback}</Text>;

  const onOpen = async (e: React.MouseEvent) => {
    e.stopPropagation(); // владелец часто внутри кликабельной строки/карточки — не открывать её же
    setOpen(true);
    if (row !== undefined) return;
    setLoading(true);
    const rows = await fetchRows();
    setRow(rows.find((r) => r.owner === owner) ?? null);
    setLoading(false);
  };

  return (
    <>
      <a onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(e as unknown as React.MouseEvent); }} role="button" tabIndex={0}>
        <UserOutlined /> {owner}
      </a>
      <Modal open={open} onCancel={(e) => { e.stopPropagation(); setOpen(false); }} footer={null} width={420}
        title={<span><UserOutlined /> {owner}</span>}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : row ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space size="large" wrap>
              <Statistic title="Нагрузка" value={row.openCount} />
              <Statistic title="Просрочено" value={row.overdueCount}
                valueStyle={row.overdueCount > 0 ? { color: RAG.bad.strong } : undefined} />
              <Statistic title="Выполнено" value={row.completedCount}
                valueStyle={row.completedCount > 0 ? { color: RAG.good.strong } : undefined} />
            </Space>
            <Space size="large" wrap>
              <Statistic title="Взвеш. нагрузка" value={row.weightedLoad} />
              <Statistic title="Часы (оценено)" value={row.hoursEstimated} suffix="ч" />
            </Space>
            {row.measuresWithoutEstimate > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Ещё {row.measuresWithoutEstimate} {row.measuresWithoutEstimate === 1 ? 'мера' : 'мер(ы)'} без оценки часов — не входят во взвешенную нагрузку выше.
              </Text>
            )}
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Нет данных по мерам/несоответствиям этого ответственного" />
        )}
      </Modal>
    </>
  );
};

export default OwnerLink;
