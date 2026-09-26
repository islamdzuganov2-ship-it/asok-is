/**
 * ceoTileKit.tsx — общие помощники плиток кокпита CEO: ссылки L3, таблица деталей, состояния
 * загрузки/ошибки, бандл по разрезу. Вынесено из ceoTiles.tsx (потолок размера модуля);
 * таблица деталей — через AppTable (УК-28, УК-30: сортировка по каждой колонке, память сортировки).
 */
import React from 'react';
import { Typography, Space } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import L3Link from './L3Link';
import AppTable from '../../components/AppTable';
import type { TileValue } from './types';
import type { Slice } from '../../store/slice/sliceTypes';
import { useGetCockpitBundleQuery } from '../../store/api/apiSlice';
import { cockpitBundleArgs } from './bundleArgs';

/** `/dashboard/taskplan` уже читает `?characteristic=`/`?owner=`/`?status=` (ТЗ v20 п.1) —
 * донашиваем текущий разрез, а не открываем план задач «с чистого листа» (ТЗ v21 §3.5). */
export function taskplanHref(slice: Slice, extra?: { status?: string }): string {
  const p = new URLSearchParams({ from: 'cockpit', role: 'ceo' });
  if (slice.characteristic) p.set('characteristic', slice.characteristic);
  if (slice.owner) p.set('owner', slice.owner);
  if (extra?.status) p.set('status', extra.status);
  return `/dashboard/taskplan?${p.toString()}`;
}

export const { Text } = Typography;

export function useCeoBundle(slice: Slice) {
  return useGetCockpitBundleQuery(cockpitBundleArgs('CEO', slice));
}

export function l3Link(href: string, label: string) {
  return (
    <div style={{ marginTop: 12 }}>
      <L3Link href={href}>{label} <RightOutlined style={{ fontSize: 11 }} /></L3Link>
    </div>
  );
}

export function detailTable<T extends object>(rows: T[], columns: any[], empty: string, l3?: { href: string; label: string }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {rows.length
        ? <AppTable<T> tableKey={`ceo-detail:${empty}`} size="small" dataSource={rows} columns={columns}
            rowKey={(r: any) => r.id ?? r.proposalId ?? r.system ?? r.signer ?? r.key} pagination={{ pageSize: 7 }} scroll={{ x: 'max-content' }} />
        : <Text type="secondary">{empty}</Text>}
      {l3 && l3Link(l3.href, l3.label)}
    </Space>
  );
}

export function loadErrorValue(isLoading: boolean, isError: boolean): TileValue | null {
  if (isLoading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
  if (isError) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Не удалось получить данные кокпита' } };
  return null;
}
