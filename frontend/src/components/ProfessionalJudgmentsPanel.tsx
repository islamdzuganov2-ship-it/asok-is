/**
 * ProfessionalJudgmentsPanel.tsx — профессиональные суждения по КАЖДОЙ подхарактеристике.
 *
 * Задача менеджера по качеству (НЕ мера). Обязательны все 31; висит напоминание со сроком
 * «до конца первого месяца квартала». На основе суждений LLM формирует заключение и маппит
 * их на базу рисков (самообучение: суждения накапливаются и передаются модели как контекст).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Collapse, Input, Modal, Progress, Space, Tag, Typography, message, List, Spin,
} from 'antd';
import { RobotOutlined, SaveOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { QUALITY_MODEL } from '../constants/qualityModel';
import {
  useGetJudgmentsQuery, useSaveJudgmentsMutation, useLazyGetJudgmentConclusionQuery,
  type JudgmentItem,
} from '../store/api/apiSlice';

const { Text, Paragraph } = Typography;

/** Срок заполнения суждений — конец первого месяца квартала периода (Q{n}-{year}). */
function judgmentDeadline(period: string): Date | null {
  const m = /Q([1-4])-(\d{4})/.exec(period || '');
  if (!m) return null;
  const firstMonth = (Number(m[1]) - 1) * 3; // Q1→янв, Q2→апр, Q3→июл, Q4→окт
  return new Date(Number(m[2]), firstMonth + 1, 0); // последний день первого месяца квартала
}
const fmt = (d: Date) => d.toLocaleDateString('ru-RU');

interface Props {
  periodId: string;
  periodLabel: string;
}

const ProfessionalJudgmentsPanel: React.FC<Props> = ({ periodId, periodLabel }) => {
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const canEdit = ['QUALITY_MANAGER', 'ADMIN'].includes(role);

  const { data, isFetching } = useGetJudgmentsQuery(periodId, { skip: !periodId });
  const [saveJudgments, { isLoading: saving }] = useSaveJudgmentsMutation();
  const [fetchConclusion, { data: conclusion, isFetching: concLoading }] = useLazyGetJudgmentConclusionQuery();
  const [concOpen, setConcOpen] = useState(false);

  // Локальные правки: ключ «характеристика|||подхарактеристика» → текст суждения.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const key = (c: string, s: string) => `${c}|||${s}`;

  const saved = useMemo(() => {
    const map: Record<string, string> = {};
    (data?.items || []).forEach((j) => { map[key(j.characteristic, j.subcharacteristic)] = j.judgment_text; });
    return map;
  }, [data]);

  useEffect(() => { setEdits({}); }, [periodId, data]);

  const textOf = (c: string, s: string) => (edits[key(c, s)] ?? saved[key(c, s)] ?? '');
  const dirtyCount = Object.keys(edits).filter((k) => (edits[k] ?? '') !== (saved[k] ?? '')).length;

  const deadline = judgmentDeadline(periodLabel);
  const overdue = deadline ? new Date() > deadline : false;
  const filled = data?.filled ?? 0;
  const total = data?.total ?? 31;
  const complete = data?.complete ?? false;

  const handleSave = async () => {
    const items: JudgmentItem[] = Object.entries(edits)
      .filter(([k, v]) => (v ?? '').trim() && v !== saved[k])
      .map(([k, v]) => {
        const [characteristic, subcharacteristic] = k.split('|||');
        return { characteristic, subcharacteristic, judgment_text: v.trim() };
      });
    if (!items.length) { message.info('Нет изменений для сохранения'); return; }
    try {
      await saveJudgments({ id: periodId, items }).unwrap();
      setEdits({});
      message.success(`Сохранено суждений: ${items.length}`);
    } catch (e: any) {
      message.error(e?.status === 403 ? 'Суждения вносит менеджер по качеству' : 'Не удалось сохранить');
    }
  };

  return (
    <Card
      title={<span><RobotOutlined /> Профессиональные суждения (задача менеджера по качеству)</span>}
      styles={{ body: { paddingTop: 12 } }}
      extra={canEdit && (
        <Space>
          <Button icon={<SaveOutlined />} type="primary" loading={saving} disabled={dirtyCount === 0} onClick={handleSave}>
            Сохранить {dirtyCount > 0 ? `(${dirtyCount})` : ''}
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => { setConcOpen(true); fetchConclusion(periodId); }}>
            Заключение LLM
          </Button>
        </Space>
      )}
    >
      <Alert
        type={complete ? 'success' : overdue ? 'error' : 'warning'}
        showIcon
        icon={<ClockCircleOutlined />}
        style={{ marginBottom: 12 }}
        message={complete
          ? 'Профессиональные суждения заполнены полностью'
          : `Заполните профессиональные суждения по каждой подхарактеристике (${filled}/${total})`}
        description={deadline
          ? <span>Срок (до конца первого месяца квартала): <b>{fmt(deadline)}</b>{overdue && !complete ? ' — просрочено' : ''}. Суждение обязательно у каждой из {total} подхарактеристик.</span>
          : 'Суждение обязательно у каждой подхарактеристики.'}
      />
      <Progress percent={Math.round((filled / total) * 100)} status={complete ? 'success' : 'active'} format={() => `${filled}/${total}`} />

      <Collapse
        style={{ marginTop: 12 }}
        items={QUALITY_MODEL.map((c) => {
          const done = c.subs.filter((s) => (saved[key(c.title, s.name)] || '').trim()).length;
          return {
            key: c.title,
            label: (
              <Space>
                <Text strong>{c.title}</Text>
                <Tag color={done >= c.subs.length ? 'green' : 'gold'}>{done}/{c.subs.length}</Tag>
              </Space>
            ),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {c.subs.map((s) => {
                  const has = (textOf(c.title, s.name) || '').trim().length > 0;
                  return (
                    <div key={s.name}>
                      <Text style={{ fontSize: 13 }}>
                        {s.name} {!has && <Tag color="orange" style={{ fontSize: 10 }}>нужно суждение</Tag>}
                      </Text>
                      <Input.TextArea
                        rows={2}
                        value={textOf(c.title, s.name)}
                        disabled={!canEdit}
                        placeholder="Профессиональное суждение: что по сути с этой подхарактеристикой, причины, риски…"
                        onChange={(e) => setEdits((prev) => ({ ...prev, [key(c.title, s.name)]: e.target.value }))}
                      />
                    </div>
                  );
                })}
              </Space>
            ),
          };
        })}
      />

      <Modal
        open={concOpen}
        onCancel={() => setConcOpen(false)}
        footer={null}
        width={680}
        title={<span><RobotOutlined /> Заключение LLM по профессиональным суждениям</span>}
      >
        {(concLoading || isFetching) ? (
          <div><Spin /> <Text type="secondary">Генерация заключения на локальной модели (может занять ~1 мин)…</Text></div>
        ) : conclusion ? (
          <>
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{conclusion.conclusion}</Paragraph>
            {conclusion.mapped_risks?.length > 0 && (
              <>
                <Text strong>Маппинг на базу рисков:</Text>
                <List
                  size="small"
                  dataSource={conclusion.mapped_risks}
                  renderItem={(r) => (
                    <List.Item>
                      <Text><Tag>{r.characteristic}</Tag>{r.title}{r.mitigation ? ` — ${r.mitigation}` : ''}</Text>
                    </List.Item>
                  )}
                />
              </>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              Суждений учтено: {conclusion.judgments_count}. LLM: {conclusion.llm ? 'да' : 'fallback'}.
            </Text>
          </>
        ) : <Text type="secondary">Нажмите «Заключение LLM», чтобы сформировать.</Text>}
      </Modal>
    </Card>
  );
};

export default ProfessionalJudgmentsPanel;
