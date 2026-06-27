/**
 * ProfessionalJudgmentModal.tsx — модал «Профессиональное суждение» менеджера по качеству.
 * Реализует R2.3 / R2.4 / R2.5 ТЗ v9:
 *  - обоснование (профессиональное суждение) по метрике/под-характеристике;
 *  - опциональная постановка задачи: карточка риска + ответственный + срок;
 *  - результат уходит топ-менеджменту как мера со статусом «ожидает одобрения»,
 *    с явной формулировкой «что ожидается и почему».
 */
import React, { useEffect } from 'react';
import { Modal, Form, Input, Checkbox, Select, DatePicker, Typography, Tag, Space } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { addProposal } from '../store/slices/governanceSlice';
import { RootState } from '../store';
import { ragToken, levelLabel } from '../theme/ragPalette';

const { TextArea } = Input;
const { Text } = Typography;

const LEVELS = [
  'Высокий уровень',
  'Уровень выше среднего',
  'Средний уровень',
  'Уровень ниже среднего',
  'Низкий уровень',
  'Невозможно измерить',
];

export interface JudgmentTarget {
  systemName: string;
  characteristic: string;
  metricName: string;
  score: number;
}

interface Props {
  open: boolean;
  target: JudgmentTarget | null;
  onClose: () => void;
}

export const ProfessionalJudgmentModal: React.FC<Props> = ({ open, target, onClose }) => {
  const [form] = Form.useForm();
  const dispatch = useDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Менеджер по качеству';
  const createRisk = Form.useWatch('createRisk', form);

  useEffect(() => {
    if (open && target) {
      form.setFieldsValue({
        rationale: '',
        createRisk: true,
        riskTitle: `Снижение качества: ${target.characteristic}`,
        owner: '',
        ownerRole: '',
        dueDate: null,
        adjustedLevel: undefined,
      });
    }
  }, [open, target, form]);

  if (!target) return null;
  const tok = ragToken(target.score);

  const handleOk = async () => {
    const v = await form.validateFields();
    // Формулировка «что ожидается от ЛПР и почему» — для понятности топ-менеджменту (R2.5)
    const expectation =
      `Прошу одобрить меру по «${target.characteristic}» ИС «${target.systemName}». ` +
      `Метрика «${target.metricName}» = ${target.score}% (${levelLabel(target.score)}). ` +
      (v.createRisk
        ? `Предлагается завести риск «${v.riskTitle}»${v.owner ? `, ответственный — ${v.owner}${v.ownerRole ? ` (${v.ownerRole})` : ''}` : ''}` +
          `${v.dueDate ? `, срок — ${dayjs(v.dueDate).format('DD.MM.YYYY')}` : ''}.`
        : 'Корректировка экспертной оценки без заведения риска.');

    dispatch(
      addProposal({
        systemName: target.systemName,
        characteristic: target.characteristic,
        metricName: target.metricName,
        calculatedScore: target.score,
        calculatedLevel: levelLabel(target.score),
        adjustedLevel: v.adjustedLevel,
        rationale: v.rationale,
        createRisk: !!v.createRisk,
        riskTitle: v.createRisk ? v.riskTitle : undefined,
        owner: v.createRisk ? v.owner : undefined,
        ownerRole: v.createRisk ? v.ownerRole : undefined,
        dueDate: v.createRisk && v.dueDate ? dayjs(v.dueDate).format('DD.MM.YYYY') : undefined,
        expectation,
        createdBy: fullName,
      }),
    );
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="Профессиональное суждение"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="Применить корректировку"
      cancelText="Отмена"
      width={520}
      destroyOnClose
    >
      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
        <Text type="secondary">Метрика</Text>
        <Space>
          <Text strong>{target.metricName}</Text>
          <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>
            {target.score}% · {tok.label}
          </Tag>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {target.systemName} · {target.characteristic}
        </Text>
      </Space>

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="rationale"
          label="Комментарий (обоснование)"
          rules={[{ required: true, min: 10, message: 'Укажите обоснование не короче 10 символов' }]}
        >
          <TextArea
            rows={3}
            placeholder="Напр.: недостаточно ресурса автотестеров для автоматизации тест-кейсов регрессионной модели…"
          />
        </Form.Item>

        <Form.Item name="adjustedLevel" label="Ручная корректировка уровня (необязательно)">
          <Select allowClear placeholder="Оставить расчётный уровень" options={LEVELS.map((l) => ({ value: l, label: l }))} />
        </Form.Item>

        <Form.Item name="createRisk" valuePropName="checked" style={{ marginBottom: createRisk ? 8 : 0 }}>
          <Checkbox>Создать карточку риска (постановка задачи)</Checkbox>
        </Form.Item>

        {createRisk && (
          <>
            <Form.Item name="riskTitle" label="Риск" rules={[{ required: true, message: 'Укажите формулировку риска' }]}>
              <Input placeholder="Напр.: Нарушение непрерывности предоставления данных" />
            </Form.Item>
            <Form.Item name="owner" label="Ответственный (ФИО)" rules={[{ required: true, message: 'Укажите ответственного' }]}>
              <Input placeholder="Иванов И.И." />
            </Form.Item>
            <Form.Item name="ownerRole" label="Должность ответственного" rules={[{ required: true, message: 'Укажите должность' }]}>
              <Input placeholder="Напр.: Руководитель ИТ-блока" />
            </Form.Item>
            <Form.Item name="dueDate" label="Срок">
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}
      </Form>

      <Text type="secondary" style={{ fontSize: 12 }}>
        После применения мера уйдёт топ-менеджменту со статусом «ожидает одобрения».
      </Text>
    </Modal>
  );
};

export default ProfessionalJudgmentModal;
