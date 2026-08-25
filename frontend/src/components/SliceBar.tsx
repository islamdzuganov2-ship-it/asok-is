/**
 * SliceBar.tsx — панель сквозного разреза (ТЗ v21 §3.4).
 *
 * Свёрнута по умолчанию (строка-резюме) — руководитель, которому разрез не нужен, не видит
 * шести контролов. Активные фильтры показываются чипами даже свёрнутой (§3.4): цифра на
 * экране никогда не должна читаться как «весь портфель», когда это не так.
 */
import React, { useState } from 'react';
import { Button, Select, Space, Tag, Typography } from 'antd';
import { DownOutlined, LinkOutlined, UpOutlined } from '@ant-design/icons';
import { useSlice, sliceSummaryText } from '../store/slice/sliceUrl';
import { activeFilterCount } from '../store/slice/sliceTypes';
import { useGetSystemsQuery } from '../store/api/apiSlice';
import { QUALITY_MODEL } from '../constants/qualityModel';
import { message } from '../theme/appMessage';
import { PREMIUM, SPACE, TYPE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Text } = Typography;

const CRIT_OPTIONS = [
  { value: 'MC', label: 'Mission Critical' },
  { value: 'BC', label: 'Business Critical' },
  { value: 'BO', label: 'Business Operational' },
];

const LENS_OPTIONS = [
  { value: 'score', label: 'Балл качества' },
  { value: 'ale', label: 'ALE под риском' },
  { value: 'delta', label: 'ΔALE снимаемый мерами' },
  { value: 'coverage', label: 'Покрытие мерами' },
];

const SliceBar: React.FC = () => {
  const [slice, patch, reset] = useSlice();
  const [expanded, setExpanded] = useState(false);
  const { data: systemsResp } = useGetSystemsQuery();
  const systemOptions = (systemsResp?.items ?? []).map((s) => ({ value: s.id, label: s.name }));
  const count = activeFilterCount(slice);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => message.success('Ссылка на разрез скопирована'))
      .catch(() => message.error('Не удалось скопировать ссылку'));
  };

  return (
    <div style={{
      border: `1px solid ${PREMIUM.border}`, borderRadius: PREMIUM.radiusSm,
      background: BRAND.surface, padding: `${SPACE.snug}px ${SPACE.cozy}px`, marginTop: SPACE.base,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.cozy, flexWrap: 'wrap' }}>
        <Space wrap size={SPACE.tight}>
          <Text style={{ ...TYPE.caption, color: BRAND.inkSoft }}>Разрез: {sliceSummaryText(slice)}</Text>
          {slice.characteristic && <Tag>{slice.characteristic}</Tag>}
          {slice.owner && <Tag>{slice.owner}</Tag>}
          {slice.criticality.map((c) => <Tag key={c}>{c}</Tag>)}
        </Space>
        <Space size={SPACE.tight}>
          {count > 0 && <Button size="small" onClick={reset}>Сбросить</Button>}
          <Button size="small" icon={<LinkOutlined />} onClick={copyLink}>Скопировать ссылку</Button>
          <Button size="small" type="text" icon={expanded ? <UpOutlined /> : <DownOutlined />} onClick={() => setExpanded((v) => !v)}>
            Разрез{count > 0 ? ` (${count})` : ''}
          </Button>
        </Space>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.cozy, marginTop: SPACE.cozy }}>
          <Select
            allowClear mode="multiple" placeholder="ИС (весь портфель)" style={{ minWidth: 220 }}
            options={systemOptions} value={slice.systems}
            onChange={(v) => patch({ systems: v })}
          />
          <Select
            allowClear mode="multiple" placeholder="Класс критичности" style={{ minWidth: 200 }}
            options={CRIT_OPTIONS} value={slice.criticality}
            onChange={(v) => patch({ criticality: v as typeof slice.criticality })}
          />
          <Select
            allowClear placeholder="Характеристика" style={{ minWidth: 200 }}
            options={QUALITY_MODEL.map((c) => ({ value: c.title, label: c.title }))}
            value={slice.characteristic ?? undefined}
            onChange={(v) => patch({ characteristic: v ?? null, subcharacteristic: null })}
          />
          <Select
            placeholder="Линза" style={{ minWidth: 200 }}
            options={LENS_OPTIONS} value={slice.lens}
            onChange={(v) => patch({ lens: v })}
          />
        </div>
      )}
    </div>
  );
};

export default SliceBar;
