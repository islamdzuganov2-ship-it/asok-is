/**
 * MeasureDevelopmentPanel.tsx — блок ВЫРАБОТКИ МЕР (не равно профессиональному суждению).
 *
 * Идея (ТЗ): проблемная характеристика может быть уникальной для ИС, но вынося её на уровень
 * топ-менеджмента, мы фиксируем СИСТЕМАТИЧЕСКУЮ проблему по характеристике/подхарактеристикам,
 * которую без решения топ-менеджмента не устранить. Для постановки меры нужна чёткая ФАКТУРА
 * (просевшие подхарактеристики + баллы) и рекомендация ИИ. Мера уходит топ-менеджменту на решение.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import { BulbOutlined, RiseOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { addProposal } from '../store/slices/governanceSlice';
import { ManagerSystem } from '../data/mockDashboards';
import { ragToken, levelLabel } from '../theme/ragPalette';

const { Text, Paragraph } = Typography;

// Рекомендация ИИ по характеристике (фактура для меры). Совпадает по смыслу с REC мок-набора.
const AI_REC: Record<string, string> = {
  'Функциональная пригодность': 'Закрыть разрывы функционального покрытия по критическим требованиям.',
  'Производительность': 'Провести нагрузочное профилирование и оптимизацию узких мест.',
  'Совместимость': 'Стабилизировать интеграционные контракты и окружения.',
  'Удобство использования': 'Доработать UX критических сценариев и валидацию форм.',
  'Надёжность': 'Запустить программу стабилизации и сократить MTTR.',
  'Защищённость': 'Устранить замечания ИБ, усилить контроль доступа и аудит событий.',
  'Сопровождаемость': 'Поднять автоматизацию тестирования (интеграционные тесты, CI-гейты) и снизить техдолг.',
  'Переносимость': 'Стандартизировать установку и среды (IaC).',
};

interface Zone {
  title: string;
  score: number;
  lowSubs: { name: string; score: number }[];
  systematic: boolean;
}

interface Props {
  systemName: string;
  system: ManagerSystem | undefined;
}

const MeasureDevelopmentPanel: React.FC<Props> = ({ systemName, system }) => {
  const dispatch = useDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Менеджер по качеству';
  const [active, setActive] = useState<Zone | null>(null);
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [rec, setRec] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Систематические зоны: характеристика просела (<41%) ИЛИ ≥2 подхарактеристики низкие (<41%).
  const zones: Zone[] = useMemo(() => {
    if (!system) return [];
    return system.characteristics
      .map((c) => {
        const lowSubs = c.metrics.filter((m) => m.score >= 0 && m.score < 41).map((m) => ({ name: m.name, score: m.score }));
        return { title: c.title, score: c.score, lowSubs, systematic: c.score >= 0 && (c.score < 41 || lowSubs.length >= 2) };
      })
      .filter((z) => z.systematic)
      .sort((a, b) => a.score - b.score);
  }, [system]);

  const openMeasure = (z: Zone) => {
    setActive(z);
    setOwner('');
    setDue('');
    setRec(AI_REC[z.title] || 'Сформировать план устранения систематической проблемы.');
  };

  const factualBasis = (z: Zone) =>
    `Систематическая проблема по «${z.title}» (балл ${z.score}%). `
    + (z.lowSubs.length
      ? `Просевшие подхарактеристики: ${z.lowSubs.map((s) => `${s.name} — ${s.score}%`).join('; ')}.`
      : 'Интегральный балл характеристики ниже порога.');

  const createMeasure = () => {
    if (!active) return;
    if (!owner.trim()) { message.error('Укажите ответственного (владелец/менеджер процесса)'); return; }
    const worst = active.lowSubs[0];
    dispatch(addProposal({
      systemName,
      characteristic: active.title,
      metricName: worst ? worst.name : active.title,
      calculatedScore: Math.round(active.score),
      calculatedLevel: levelLabel(active.score),
      rationale: `${factualBasis(active)} Рекомендация ИИ: ${rec.trim()}`,
      createRisk: true,
      riskTitle: `Систематическая проблема: ${active.title}`,
      owner: owner.trim(),
      ownerRole: 'Владелец/менеджер процесса',
      dueDate: due.trim() || undefined,
      expectation: `Систематическая проблема по «${active.title}» не устраняется без решения топ-менеджмента. ${rec.trim()}`,
      createdBy: fullName,
    } as any));
    message.success('Мера выработана и направлена топ-менеджменту на решение');
    setActive(null);
  };

  return (
    <Card
      title={<span><RiseOutlined /> Выработка мер (систематические проблемы → топ-менеджмент)</span>}
      style={{ marginTop: 16 }}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Профессиональное суждение ≠ мера"
        description="Отдельная проблема может быть уникальной для ИС. Но если проблема СИСТЕМАТИЧЕСКАЯ по характеристике/подхарактеристикам — её нельзя устранить без решения топ-менеджмента. Такие зоны ниже — выработайте по ним меру с фактурой и рекомендацией ИИ."
      />
      {zones.length === 0 ? (
        <Text type="secondary">Систематических проблемных зон по этой ИС не выявлено (нет характеристик с систематическим проседанием).</Text>
      ) : (
        <List
          dataSource={showAll ? zones : zones.slice(0, 3)}
          footer={zones.length > 3 ? (
            <div style={{ textAlign: 'center' }}>
              <Button type="link" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Свернуть' : `Показать все (${zones.length})`}
              </Button>
            </div>
          ) : undefined}
          renderItem={(z) => (
            <List.Item
              actions={[<Button key="m" type="primary" icon={<BulbOutlined />} onClick={() => openMeasure(z)}>Выработать меру</Button>]}
            >
              <List.Item.Meta
                title={<Space><Text strong>{z.title}</Text><Tag color={ragToken(z.score).color} style={{ color: '#fff', border: 'none' }}>{z.score}%</Tag><Tag color="volcano">систематически</Tag></Space>}
                description={<Text type="secondary" style={{ fontSize: 13 }}>{factualBasis(z)}</Text>}
              />
            </List.Item>
          )}
        />
      )}

      <Modal
        open={!!active}
        onCancel={() => setActive(null)}
        onOk={createMeasure}
        okText="Выработать меру → топ-менеджменту"
        cancelText="Отмена"
        width={640}
        title={active ? `Мера по систематической проблеме: ${active.title}` : ''}
      >
        {active && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">Фактура (основание меры)</Text>
              <Paragraph style={{ marginBottom: 0 }}>{factualBasis(active)}</Paragraph>
            </div>
            <div>
              <Text type="secondary"><BulbOutlined /> Рекомендация ИИ (можно скорректировать)</Text>
              <Input.TextArea rows={2} value={rec} onChange={(e) => setRec(e.target.value)} />
            </div>
            <Space wrap style={{ width: '100%' }}>
              <div>
                <Text type="secondary">Ответственный (владелец/менеджер процесса)</Text>
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="ФИО владельца/менеджера процесса" style={{ width: 300 }} />
              </div>
              <div>
                <Text type="secondary">Срок</Text>
                <Input value={due} onChange={(e) => setDue(e.target.value)} placeholder="ДД.ММ.ГГГГ" style={{ width: 160 }} />
              </div>
            </Space>
            <Alert type="warning" showIcon message="Мера уйдёт топ-менеджменту на решение (согласование — только ADMIN)." />
          </Space>
        )}
      </Modal>
    </Card>
  );
};

export default MeasureDevelopmentPanel;
