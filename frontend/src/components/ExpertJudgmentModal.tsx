import React from 'react';
import { Form, Input, Modal, Select } from 'antd';
import { message } from '../theme/appMessage';
import { ExpertJudgmentDto, useSubmitExpertJudgmentMutation } from '../store/api/apiSlice';
import FieldHint from './FieldHint';

interface ExpertJudgmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    metricId: string;
    calculatedLevel: string;
}

const { TextArea } = Input;

export const ExpertJudgmentModal: React.FC<ExpertJudgmentModalProps> = ({
    isOpen,
    onClose,
    metricId,
    calculatedLevel,
}) => {
    const [form] = Form.useForm();
    const [submitJudgment, { isLoading }] = useSubmitExpertJudgmentMutation();

    const handleFinish = async (values: Partial<ExpertJudgmentDto>) => {
        try {
            await submitJudgment({
                metricId,
                calculatedLevel,
                justificationText: values.justificationText!,
                adjustedLevel: values.adjustedLevel,
                linkedRiskTask: values.linkedRiskTask,
            }).unwrap();
            message.success('Экспертное суждение сохранено');
            form.resetFields();
            onClose();
        } catch {
            message.error('Ошибка при сохранении суждения');
        }
    };

    return (
        <Modal
            title="Экспертная корректировка"
            open={isOpen}
            onCancel={onClose}
            onOk={() => form.submit()}
            confirmLoading={isLoading}
            okText="Сохранить"
            cancelText="Отмена"
        >
            <Form form={form} layout="vertical" onFinish={handleFinish}>
                <Form.Item label={<FieldHint title="Уровень, автоматически рассчитанный системой по формуле метрики — до вашей корректировки.">Расчетный уровень</FieldHint>}>
                    <Input disabled value={calculatedLevel} />
                </Form.Item>
                <Form.Item name="adjustedLevel" label={<FieldHint title="Заполняйте, только если экспертно не согласны с расчётным уровнем. Пусто — остаётся расчётный уровень без изменений.">Ручная корректировка</FieldHint>}>
                    <Select
                        allowClear
                        placeholder="Выберите новый уровень"
                        options={[
                            { value: 'Высокий уровень', label: 'Высокий уровень' },
                            { value: 'Выше среднего', label: 'Выше среднего' },
                            { value: 'Средний уровень', label: 'Средний уровень' },
                            { value: 'Ниже среднего', label: 'Ниже среднего' },
                            { value: 'Низкий уровень', label: 'Низкий уровень' },
                            { value: 'Невозможно измерить', label: 'Невозможно измерить' },
                        ]}
                    />
                </Form.Item>
                <Form.Item
                    name="justificationText"
                    label={<FieldHint title="Обязательно: почему расчётный уровень скорректирован (или подтверждён) экспертно — минимум 10 символов, это остаётся в истории оценки.">Обоснование</FieldHint>}
                    rules={[{ required: true, min: 10, message: 'Укажите обоснование не короче 10 символов' }]}
                >
                    <TextArea rows={4} />
                </Form.Item>
                <Form.Item name="linkedRiskTask" label={<FieldHint title="Необязательно: ссылка на задачу в трекере (Jira/СУЗ), если корректировка связана с уже заведённым риском или инцидентом.">Ссылка на задачу</FieldHint>}>
                    <Input placeholder="https://jira.domain.local/browse/TASK-123" />
                </Form.Item>
            </Form>
        </Modal>
    );
};
