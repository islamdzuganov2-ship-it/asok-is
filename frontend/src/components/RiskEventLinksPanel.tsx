/**
 * RiskEventLinksPanel.tsx — карточка взаимосвязи ТС-мера-экономика-качество (БТ-322).
 *
 * Разворачивающаяся строка рискового события: сюда стягиваются все четыре стороны связи —
 * техсбои (ТС), меры, экономика (ALE виден в самой строке таблицы) и качество (характеристики
 * ГОСТ 25010). Раньше все три связи существовали только в бэкенде (POST .../incidents|measures|
 * subchars) — фронт их не вызывал, эмпти-стейт таблицы просил «привяжите техсбои», а привязать
 * было нечем. Здесь — просмотр и привязка/отвязка по каждой из трёх связей.
 *
 * Вынесено из RiskEconomicsPage отдельным модулем: страница контура и без того держит четыре
 * рабочие вкладки, и панель на 10 КБ в ней просто терялась.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { message } from '../theme/appMessage';
import { SPACE, TYPE } from '../theme/premium';
import { numericText } from '../theme/table';
import { fmtMoney, econApi as api } from '../dashboards/scopes/EconScope';

const { Text } = Typography;

/** Минимум полей рискового события, нужный панели связей. */
export interface RiskEventLite { id: string; aleAvg?: number | null }

interface RiskEventSubcharLink { id: string; characteristic: string; subcharacteristic: string }
interface RiskEventIncidentLink {
  id: string; incidentId: string; title: string; systemName: string; occurredAt: string; costTotal?: number | null;
}
interface RiskEventMeasureLink {
  id: string; proposalId: string; title: string; status: string; aleReductionShare?: number | null;
}
interface RiskEventLinks {
  subchars: RiskEventSubcharLink[]; incidents: RiskEventIncidentLink[]; measures: RiskEventMeasureLink[];
}
interface IncidentOption { id: string; title: string; systemName: string }
interface ProposalOption { id: string; systemName: string; riskTitle?: string | null; metricName?: string | null }

export const RiskEventLinksPanel: React.FC<{ event: RiskEventLite; onChanged: () => void }> = ({ event, onChanged }) => {
  const [links, setLinks] = useState<RiskEventLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [incidentOptions, setIncidentOptions] = useState<IncidentOption[]>([]);
  const [proposalOptions, setProposalOptions] = useState<ProposalOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [subcharOpen, setSubcharOpen] = useState(false);
  const [subcharForm] = Form.useForm();
  const [incidentPickId, setIncidentPickId] = useState<string | undefined>();
  const [measurePickId, setMeasurePickId] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, incs, props] = await Promise.all([
        api<RiskEventLinks>(`/risk-events/${event.id}/links`),
        api<IncidentOption[]>('/incidents'),
        api<ProposalOption[]>('/governance/proposals'),
      ]);
      setLinks(l);
      setIncidentOptions(incs);
      setProposalOptions(props);
    } catch (e: any) {
      message.error(`Не удалось загрузить связи риска: ${e.message}`);
    } finally { setLoading(false); }
  }, [event.id]);
  useEffect(() => { load(); }, [load]);

  const addSubchar = async () => {
    try {
      const v = await subcharForm.validateFields();
      setBusy(true);
      await api(`/risk-events/${event.id}/subchars`, { method: 'POST', body: JSON.stringify(v) });
      subcharForm.resetFields(); setSubcharOpen(false); await load(); onChanged();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(`Не удалось привязать характеристику: ${e.message}`);
    } finally { setBusy(false); }
  };

  const addIncident = async () => {
    if (!incidentPickId) return;
    setBusy(true);
    try {
      await api(`/risk-events/${event.id}/incidents`, { method: 'POST', body: JSON.stringify({ incidentId: incidentPickId }) });
      setIncidentPickId(undefined); await load(); onChanged();
    } catch (e: any) { message.error(`Не удалось привязать техсбой: ${e.message}`); }
    finally { setBusy(false); }
  };

  const addMeasure = async () => {
    if (!measurePickId) return;
    setBusy(true);
    try {
      await api(`/risk-events/${event.id}/measures`, { method: 'POST', body: JSON.stringify({ proposalId: measurePickId }) });
      setMeasurePickId(undefined); await load(); onChanged();
    } catch (e: any) { message.error(`Не удалось привязать меру: ${e.message}`); }
    finally { setBusy(false); }
  };

  const unlink = async (kind: 'subchars' | 'incidents' | 'measures', linkId: string) => {
    setBusy(true);
    try {
      await api(`/risk-events/${event.id}/${kind}/${linkId}`, { method: 'DELETE' });
      await load(); onChanged();
    } catch (e: any) { message.error(`Не удалось отвязать: ${e.message}`); }
    finally { setBusy(false); }
  };

  if (loading || !links) return <div style={{ padding: SPACE.base }}><Spin size="small" /></div>;

  const linkedIncidentIds = new Set(links.incidents.map((i) => i.incidentId));
  const linkedProposalIds = new Set(links.measures.map((m) => m.proposalId));

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%', padding: `${SPACE.tight}px ${SPACE.base}px` }}>
      <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
        Взаимосвязь этого риска: техсбои (ТС) → экономика (ALE {fmtMoney(event.aleAvg)}/год, см. столбцы выше) → качество
        (характеристики) → меры по устранению.
      </Text>

      <div>
        <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>Качество — привязанные характеристики</Text>
        <div style={{ marginTop: SPACE.tight }}>
          <Space wrap size={[8, 8]}>
            {links.subchars.map((s) => (
              <Tag key={s.id} closable onClose={() => unlink('subchars', s.id)}>{s.characteristic} · {s.subcharacteristic}</Tag>
            ))}
            {!subcharOpen ? (
              <Button size="small" icon={<PlusOutlined />} onClick={() => setSubcharOpen(true)}>Привязать характеристику</Button>
            ) : (
              <Form form={subcharForm} layout="inline" onFinish={addSubchar} style={{ display: 'flex', alignItems: 'flex-start' }}>
                <Form.Item name="characteristic" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                  <Input placeholder="Характеристика" size="small" style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name="subcharacteristic" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                  <Input placeholder="Подхарактеристика" size="small" style={{ width: 170 }} />
                </Form.Item>
                <Button size="small" type="primary" htmlType="submit" loading={busy}>Добавить</Button>
                <Button size="small" onClick={() => { setSubcharOpen(false); subcharForm.resetFields(); }}>Отмена</Button>
              </Form>
            )}
          </Space>
        </div>
      </div>

      <div>
        <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>Технические сбои (ТС)</Text>
        <div style={{ marginTop: SPACE.tight }}>
          {links.incidents.length === 0 ? (
            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Не привязано ни одного техсбоя.</Text>
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {links.incidents.map((i) => (
                <Space key={i.id} style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                  <Text style={{ fontSize: TYPE.bodySm.fontSize }}>
                    {i.title} · {i.systemName} · {dayjs(i.occurredAt).format('DD.MM.YYYY')}
                  </Text>
                  <Space size={8}>
                    {i.costTotal != null && <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize, ...numericText }}>{fmtMoney(i.costTotal)}</Text>}
                    <Button size="small" type="text" danger onClick={() => unlink('incidents', i.id)}>Отвязать</Button>
                  </Space>
                </Space>
              ))}
            </Space>
          )}
          <Space style={{ marginTop: SPACE.tight }} wrap>
            <Select
              size="small" showSearch style={{ width: 320 }} placeholder="Выбрать техсбой"
              value={incidentPickId} onChange={setIncidentPickId}
              filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={incidentOptions.filter((o) => !linkedIncidentIds.has(o.id))
                .map((o) => ({ value: o.id, label: `${o.title} · ${o.systemName}` }))}
            />
            <Button size="small" onClick={addIncident} disabled={!incidentPickId} loading={busy}>Привязать</Button>
          </Space>
        </div>
      </div>

      <div>
        <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>Меры</Text>
        <div style={{ marginTop: SPACE.tight }}>
          {links.measures.length === 0 ? (
            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Мер не привязано.</Text>
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {links.measures.map((m) => (
                <Space key={m.id} style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                  <Text style={{ fontSize: TYPE.bodySm.fontSize }}>{m.title}</Text>
                  <Space size={8}>
                    <Tag>{m.status}</Tag>
                    <Button size="small" type="text" danger onClick={() => unlink('measures', m.id)}>Отвязать</Button>
                  </Space>
                </Space>
              ))}
            </Space>
          )}
          <Space style={{ marginTop: SPACE.tight }} wrap>
            <Select
              size="small" showSearch style={{ width: 320 }} placeholder="Выбрать меру"
              value={measurePickId} onChange={setMeasurePickId}
              filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={proposalOptions.filter((o) => !linkedProposalIds.has(o.id))
                .map((o) => ({ value: o.id, label: `${o.riskTitle || o.metricName || 'Мера'} · ${o.systemName}` }))}
            />
            <Button size="small" onClick={addMeasure} disabled={!measurePickId} loading={busy}>Привязать</Button>
          </Space>
        </div>
      </div>
    </Space>
  );
};


export default RiskEventLinksPanel;
