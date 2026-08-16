/**
 * ActionInsightModal.tsx — компактное модальное окно топ-менеджмента (R1.5 ТЗ v9).
 * По клику на проблемную ИС показывает «нативно понятно»:
 *   • Кто виноват (владелец/ответственный)
 *   • С кого спрашивать (эскалация)
 *   • Рекомендуемые действия
 *   • Меры менеджера по качеству, ожидающие одобрения (с пояснением «что ждут и почему»)
 * Минимум текста и цвета, спокойные тона.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Typography, Tag, Divider, List, Empty, Space, Button, Spin } from 'antd';
import {
  UserOutlined, RiseOutlined, BulbOutlined, ClockCircleOutlined, RightOutlined, DollarOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useSelector, shallowEqual } from 'react-redux';
import { selectVisibleProposals, type Proposal } from '../store/slices/governanceSlice';
import { ragToken, levelLabel, solidTagStyle, RAG, BRAND, ACCENT } from '../theme/ragPalette';
import { SPACE, TYPE } from '../theme/premium';
import { guidanceFor } from '../constants/characteristicGuidance';
import type { ExecSystemInsight } from '../data/mockDashboards';
import { MeasureDecisionModal } from './MeasureDecisionModal';

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// ТЗ v19 п.4: риски + меры + деньги для ячейки теплокарты (ИС × характеристика).
interface CellMeasure {
  proposalId: string; title: string; status: string;
  aleReductionShare: number | null; rosi: number | null; verdict: string | null;
}
interface CellRisk {
  id: string; code: string; title: string; aleAvg: number | null; aleP90: number | null;
  status: string; subcharacteristics: string[]; measures: CellMeasure[];
}
interface CellDetail { systemName: string; characteristic: string; totalAle: number; risks: CellRisk[] }

const fmtMoney = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} ₽`;

const { Title, Text, Paragraph } = Typography;

const norm = (s?: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

interface Props {
  open: boolean;
  system: ExecSystemInsight | null;
  /** Если задана — карточка сфокусирована на характеристике: резюме/рекомендация/действия/меры — по ней. */
  characteristic?: string;
  /** Балл выбранной характеристики для этой ИС (для корректного заголовка карточки характеристики). */
  characteristicScore?: number;
  onClose: () => void;
}

const Block: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon, title, children,
}) => (
  <div style={{ marginBottom: SPACE.base }}>
    <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
      {icon} {title}
    </Text>
    {/* ui-audit-ignore UI-05 — подпись блока и содержимое склеены намеренно: 2px убирают
        разрыв между строкой-меткой и её значением. */}
    <div style={{ marginTop: 2 }}>{children}</div>
  </div>
);

export const ActionInsightModal: React.FC<Props> = ({ open, system, characteristic, characteristicScore, onClose }) => {
  const visible = useSelector(selectVisibleProposals, shallowEqual);
  const proposals = visible.filter((p) => p.systemName === system?.name);
  const [decisionProposal, setDecisionProposal] = useState<Proposal | null>(null);

  // ТЗ v19 п.4: риски и деньги по ЭТОЙ ячейке (ИС × характеристика) — до раннего return, иначе
  // хук вызывался бы условно (system иногда null) и нарушал бы порядок хуков между рендерами.
  const [cell, setCell] = useState<CellDetail | null>(null);
  const [cellLoading, setCellLoading] = useState(false);
  useEffect(() => {
    if (!open || !system || !characteristic) { setCell(null); return; }
    let alive = true;
    setCellLoading(true);
    const token = localStorage.getItem('token');
    const url = new URL(`${VITE_API}/risk-events/by-cell`, window.location.origin);
    url.searchParams.set('system_name', system.name);
    url.searchParams.set('characteristic', characteristic);
    fetch(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CellDetail) => { if (alive) setCell(d); })
      .catch(() => { if (alive) setCell(null); })  // обогащение, не критический путь — модалка работает и без денег
      .finally(() => { if (alive) setCellLoading(false); });
    return () => { alive = false; };
  }, [open, system?.name, characteristic]);

  if (!system) return null;
  const tok = ragToken(system.score);

  // T-56: карточка, открытая ПО ХАРАКТЕРИСТИКЕ, показывает резюме/рекомендацию/действия ИМЕННО этой
  // характеристики (а не системное «Интегральная оценка… Наиболее просевшая характеристика — X»).
  const g = guidanceFor(characteristic);
  const hasCharScore = characteristicScore != null && characteristicScore >= 0;
  const charTok = hasCharScore ? ragToken(characteristicScore as number) : null;
  const summaryText = characteristic
    ? `Характеристика «${characteristic}» по ИС «${system.name}» — `
      + `${hasCharScore ? `${characteristicScore}% (${levelLabel(characteristicScore as number).toLowerCase()})` : 'невозможно измерить'}.`
      + `${g ? ` ${g.rationale}` : ''}`
    : system.aiSummary;
  const recommendationText = characteristic && g ? g.action : system.recommendation;
  const actionsList = characteristic && g ? g.actions : system.actions;

  // Если карточка открыта по характеристике — показываем меры только по ней.
  const pending = proposals.filter((p) =>
    p.status === 'PENDING_APPROVAL'
    && (!characteristic || norm(p.characteristic) === norm(characteristic)));

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={520} title={null}>
      <Space align="center" style={{ marginBottom: 4 }} wrap>
        <Title level={5} style={{ margin: 0 }}>{system.name}</Title>
        {characteristic && charTok ? (
          <Tag style={solidTagStyle(charTok.strong)}>
            {characteristicScore}% · {charTok.label}
          </Tag>
        ) : (
          <Tag style={solidTagStyle(tok.strong)}>
            {system.score}% · {tok.label}
          </Tag>
        )}
        {characteristic && <Tag>{characteristic}</Tag>}
      </Space>
      <Paragraph type="secondary" style={{ fontSize: TYPE.bodySm.fontSize, marginTop: 8 }}>
        {summaryText}
      </Paragraph>

      <Block icon={<BulbOutlined />} title="Рекомендация">
        <Text strong>{recommendationText}</Text>
      </Block>

      <Space size={32} style={{ display: 'flex', flexWrap: 'wrap' }}>
        <Block icon={<UserOutlined />} title="Кто отвечает">
          <Text>{system.owner}</Text>
        </Block>
        <Block icon={<RiseOutlined />} title="С кого спрашивать">
          <Text>{system.escalateTo}</Text>
        </Block>
      </Space>

      <Block icon={<BulbOutlined />} title="Рекомендуемые действия">
        <List
          size="small"
          dataSource={actionsList}
          split={false}
          renderItem={(a, i) => (
            <List.Item style={{ padding: `${SPACE.tight}px 0`, border: 'none' }}>
              <Text>{i + 1}. {a}</Text>
            </List.Item>
          )}
        />
      </Block>

      {characteristic && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
            <DollarOutlined /> Риски и деньги по «{characteristic}»
          </Text>
          <div style={{ marginTop: 8 }}>
            {cellLoading ? (
              <Spin size="small" />
            ) : !cell || cell.risks.length === 0 ? (
              <Text type="secondary" style={{ fontSize: TYPE.bodySm.fontSize }}>
                Риски по этой характеристике не заведены в реестре.
              </Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Text strong style={{ color: RAG.bad.strong }}>
                  Суммарный ALE: {fmtMoney(cell.totalAle)} / год
                </Text>
                {cell.risks.map((r) => (
                  <div key={r.id} style={{ background: BRAND.surfaceSoft, borderRadius: 8, padding: 10 }}>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start">
                      <Space size={4}>
                        <WarningOutlined style={{ color: RAG.medium.strong }} />
                        <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>{r.title}</Text>
                      </Space>
                      {r.aleAvg != null && (
                        <Tag color="red">{fmtMoney(r.aleAvg)}/год</Tag>
                      )}
                    </Space>
                    <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize, display: 'block', marginTop: 2 }}>
                      {r.code} · {r.subcharacteristics.join(', ')}
                    </Text>
                    {r.measures.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {r.measures.map((m) => (
                          <div key={m.proposalId} style={{ fontSize: TYPE.caption.fontSize, marginTop: 2 }}>
                            <Tag style={{ fontSize: TYPE.micro.fontSize }} color={ACCENT.slate.color}>мера</Tag>
                            <Text style={{ fontSize: TYPE.caption.fontSize }}>{m.title}</Text>
                            {m.aleReductionShare != null && (
                              <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
                                {' '}· снимает {Math.round(m.aleReductionShare * 100)}% ALE
                              </Text>
                            )}
                            {m.rosi != null && (
                              <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
                                {' '}· ROSI {m.rosi.toFixed(1)}
                              </Text>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </Space>
            )}
          </div>
        </>
      )}

      <Divider style={{ margin: '12px 0' }} />

      <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
        <ClockCircleOutlined /> Меры{characteristic ? ` по характеристике «${characteristic}»` : ''}, ожидающие вашего решения
      </Text>

      {pending.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={characteristic ? 'По этой характеристике мер на решение нет' : 'Нет мер на одобрение'}
          style={{ margin: '8px 0' }}
        />
      ) : (
        <List<Proposal>
          style={{ marginTop: 8 }}
          dataSource={pending}
          renderItem={(p: Proposal) => (
            <List.Item
              onClick={() => setDecisionProposal(p)}
              style={{ display: 'block', cursor: 'pointer', background: tok.soft, borderRadius: 8, padding: 12, marginBottom: 8, border: `1px solid ${tok.border}` }}
            >
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text strong>{p.riskTitle || p.metricName}</Text>
                <Button type="link" size="small" style={{ padding: 0 }}>
                  Рассмотреть <RightOutlined />
                </Button>
              </Space>
              <Paragraph style={{ fontSize: TYPE.bodySm.fontSize, margin: '4px 0' }}>{p.expectation}</Paragraph>
              <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
                Обоснование: {p.rationale}
              </Text>
            </List.Item>
          )}
        />
      )}

      <MeasureDecisionModal
        open={!!decisionProposal}
        proposal={decisionProposal}
        onClose={() => setDecisionProposal(null)}
      />
    </Modal>
  );
};

export default ActionInsightModal;
