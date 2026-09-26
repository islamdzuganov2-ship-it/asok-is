/**
 * MeasureCatalogHint.tsx — типовые меры каталога «риск → подхарактеристика → мера» (BL-007 RE-10, §4.2).
 *
 * Для характеристики (и, если известна, подхарактеристики) показывает типовые риски и ПАРУ мер:
 * устраняющую (снимает первопричину — растёт балл, падает ALE) и компенсирующую (причина остаётся,
 * балл не растёт, ALE падает за счёт ущерба/вероятности). Различие подписано явно: без него
 * компенсирующие меры выглядят как бездействие, и их перестают применять.
 *
 * Каталог — деньги контура (`/econ/measure-catalog` под `view.risk_economics`); без права
 * подсказка не рисуется и не делает запрос.
 */
import React, { useEffect, useState } from 'react';
import { Collapse, Tag, Typography } from 'antd';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { SPACE, TYPE } from '../theme/premium';

const { Text } = Typography;
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

interface CatalogEntry {
  characteristic: string;
  subcharacteristic: string;
  risk: string;
  eliminating: string;
  compensating: string;
}

const MeasureCatalogHint: React.FC<{ characteristic?: string | null; subcharacteristic?: string | null; max?: number }> = ({
  characteristic, subcharacteristic, max = 3,
}) => {
  const allowed = useSelector((s: RootState) => s.auth.permissions.includes('view.risk_economics'));
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);

  useEffect(() => {
    if (!allowed || !characteristic) return;
    let alive = true;
    const qs = new URLSearchParams({ characteristic });
    if (subcharacteristic) qs.set('subcharacteristic', subcharacteristic);
    const token = localStorage.getItem('token');
    fetch(`${API}/econ/measure-catalog?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CatalogEntry[]) => { if (alive) setEntries(d); })
      .catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [allowed, characteristic, subcharacteristic]);

  if (!allowed || !characteristic || !entries || entries.length === 0) return null;
  return (
    <Collapse
      size="small"
      style={{ marginTop: SPACE.snug }}
      items={[{
        key: 'catalog',
        label: <Text style={TYPE.caption}>Типовые меры из каталога · {entries.length}</Text>,
        children: entries.slice(0, max).map((e) => (
          <div key={`${e.subcharacteristic}|${e.risk}`} style={{ marginBottom: SPACE.cozy }}>
            <Text strong style={TYPE.caption}>{e.subcharacteristic}: </Text>
            <Text style={TYPE.caption}>{e.risk}</Text>
            <div style={{ marginTop: 2 }}>
              <Tag color="green">устраняющая</Tag><Text style={TYPE.caption}>{e.eliminating}</Text>
            </div>
            <div style={{ marginTop: 2 }}>
              <Tag color="gold">компенсирующая</Tag><Text style={TYPE.caption}>{e.compensating}</Text>
            </div>
          </div>
        )),
      }]}
    />
  );
};

export default MeasureCatalogHint;
