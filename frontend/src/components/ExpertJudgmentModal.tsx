/**
 * Компонент модального окна для эвристической корректировки метрик (Экран Менеджера).
 * Реализует паттерн Management by Exception (ТЗ п.3.2).
 */
import React from 'react';
import { Modal, Form, Select, Input, message } from 'antd';
import { useSubmitExpertJudgmentMutation, ExpertJudgmentDto } from '../store/api/apiSlice';

interface ExpertJudgmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    metricId: string;
    calculatedLevel: 'Низкий' | 'Средний' | 'Высокий';
}

const { TextArea } = Input;
const { Option } = Select;

export const ExpertJudgmentModal: React.FC<ExpertJudgmentModalProps> = ({
    isOpen,
    onClose,
    metricId,
    calculatedLevel
}) => {
    const [form] = Form.useForm();
    const [submitJudgment, { isLoading }] = useSubmitExpertJudgmentMutation();

    /**
     * Обработчик отправки формы.
     * Валидирует данные и отправляет мутацию на Backend.
     * @param values - Данные формы, соответствующие DTO.
     */
    const handleFinish = async (values: Partial<ExpertJudgmentDto>) => {
        try {
            await submitJudgment({
                metricId,
                calculatedLevel,
                justificationText: values.justificationText!,
                adjustedLevel: values.adjustedLevel,
                linkedRiskTask: values.linkedRiskTask
            }).unwrap();
            message.success('Профессиональное суждение успешно сохранено');
            form.resetFields();
            onClose();
        } catch (error) {
            message.error('Ошибка при сохранении суждения');
        }
    };

    return (
        <Modal
            title="Эвристическая корректировка (Проф. суждение)"
            open={isOpen}
            onCancel={onClose}
            onOk={() => form.submit()}
            confirmLoading={isLoading}
            okText="Сохранить"
            cancelText="Отмена"
        >
            <Form form={form} layout="vertical" onFinish={handleFinish}>
                <Form.Item label="Расчетный уровень (Система)">
                    <Input disabled value={calculatedLevel} />
                </Form.Item>

                <Form.Item 
                    name="adjustedLevel" 
                    label="Ручная корректировка (Уровень)"
                >
                    <Select placeholder="Выберите новый уровень (если требуется)">
                        <Option value="Низкий">Низкий</Option>
                        <Option value="Средний">Средний</Option>
                        <Option value="Высокий">Высокий</Option>
                    </Select>
                </Form.Item>

                <Form.Item 
                    name="justificationText" 
                    label="Обоснование (Обязательно)"
                    rules={[{ required: true, message: 'Необходимо указать причину корректировки или невозможности измерения' }]}
                >
                    <TextArea rows={4} placeholder="Введите проф. суждение..." />
                </Form.Item>

                <Form.Item 
                    name="linkedRiskTask" 
                    label="Ссылка на задачу (СУЗ/Jira)"
                >
                    <Input placeholder="https://jira.domain.local/browse/TASK-123" />
                </Form.Item>
            </Form>
        </Modal>
    );
};