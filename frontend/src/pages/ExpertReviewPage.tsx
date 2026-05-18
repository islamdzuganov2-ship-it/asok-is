/**
 * Экран "Экспертиза и ревью" (Роль: Менеджер по качеству, Администратор).
 * Реализует паттерн Management by Exception (ТЗ п.3.2).
 * Отображает рассчитанные ядром метрики, подсвечивает проблемные зоны (<40%) 
 * и позволяет применять эвристические корректировки.
 */
import React, { useState } from 'react';
import { Table, Typography, Tag, Button, Space, Card, Progress } from 'antd';
import { useParams } from 'react-router-dom';
import { ExpertJudgmentModal } from '../components/ExpertJudgmentModal';

const { Title, Text } = Typography;

// DTO для отображения рассчитанных метрик (в реальности приходит из API)
interface CalculatedMetric {
    id: string;
    name: string;
    calculatedX: number; // От 0 до 100%
    systemLevel: 'Низкий' | 'Средний' | 'Высокий';
    adjustedLevel?: 'Низкий' | 'Средний' | 'Высокий';
    expertComment?: string;
}

export const ExpertReviewPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    
    // Стейт для управления модальным окном проф. суждения
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        metricId: string;
        currentLevel: 'Низкий' | 'Средний' | 'Высокий';
    }>({ isOpen: false, metricId: '', currentLevel: 'Средний' });

    // Mock-данные (ожидается использование useGetCalculatedMetricsQuery(id))
    const [metrics] = useState<CalculatedMetric[]>([
        { id: '1', name: 'Плотность дефектов', calculatedX: 85, systemLevel: 'Высокий' },
        { id: '2', name: 'Покрытие автотестами', calculatedX: 35, systemLevel: 'Низкий' },
        { id: '3', name: 'Частота релизов', calculatedX: 55, systemLevel: 'Средний', adjustedLevel: 'Высокий', expertComment: 'Согласовано с архитектором: специфика legacy системы.' },
    ]);

    /**
     * Обработчик открытия модального окна для оспаривания оценки.
     */
    const handleChallenge = (record: CalculatedMetric) => {
        setModalConfig({
            isOpen: true,
            metricId: record.id,
            currentLevel: record.systemLevel
        });
    };

    /**
     * Закрытие модального окна и рефетч данных (в реальном приложении через invalidateTags).
     */
    const handleModalClose = () => {
        setModalConfig({ ...modalConfig, isOpen: false });
        // Здесь должен быть refetch() если бы мы использовали RTK Query
    };

    /**
     * Функция для определения цвета тега уровня.
     */
    const getLevelColor = (level: string) => {
        switch (level) {
            case 'Высокий': return 'success';
            case 'Средний': return 'warning';
            case 'Низкий': return 'error';
            default: return 'default';
        }
    };

    const columns = [
        { 
            title: 'Метрика', 
            dataIndex: 'name', 
            key: 'name',
            width: '25%',
        },
        {
            title: 'Расчет (Ядро)',
            dataIndex: 'calculatedX',
            key: 'calculatedX',
            width: '15%',
            render: (val: number) => (
                <Progress 
                    percent={val} 
                    size="small" 
                    status={val < 40 ? 'exception' : val < 80 ? 'normal' : 'success'} 
                />
            )
        },
        {
            title: 'Системный уровень',
            dataIndex: 'systemLevel',
            key: 'systemLevel',
            width: '15%',
            render: (val: string) => <Tag color={getLevelColor(val)}>{val}</Tag>
        },
        {
            title: 'Корректировка (Суждение)',
            key: 'adjustedLevel',
            width: '25%',
            render: (_: any, record: CalculatedMetric) => {
                if (record.adjustedLevel) {
                    return (
                        <Space direction="vertical" size="small">
                            <Tag color={getLevelColor(record.adjustedLevel)}>{record.adjustedLevel} (Ручн.)</Tag>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{record.expertComment}</Text>
                        </Space>
                    );
                }
                return <Text type="secondary">Нет корректировок</Text>;
            }
        },
        {
            title: 'Действия',
            key: 'actions',
            width: '20%',
            render: (_: any, record: CalculatedMetric) => (
                <Button 
                    type={record.calculatedX < 40 ? "primary" : "default"} 
                    danger={record.calculatedX < 40}
                    onClick={() => handleChallenge(record)}
                >
                    Оспорить (Суждение)
                </Button>
            )
        }
    ];

    return (
        <div>
            <Title level={3}>Экспертиза и утверждение оценки (ID: {id})</Title>
            
            <Card style={{ marginBottom: 24 }}>
                <Text strong type="danger">Внимание: </Text>
                <Text>Метрики с результатом ниже 40% (Красная зона) требуют обязательного анализа. Вы можете принять системный расчет или применить эвристическую корректировку.</Text>
            </Card>

            <Table 
                dataSource={metrics} 
                columns={columns} 
                rowKey="id" 
                pagination={false}
                bordered
                // Подсветка строк в красной зоне (ТЗ п.3.2)
                rowClassName={(record) => record.calculatedX < 40 && !record.adjustedLevel ? 'red-zone-row' : ''}
            />

            <ExpertJudgmentModal 
                isOpen={modalConfig.isOpen}
                onClose={handleModalClose}
                metricId={modalConfig.metricId}
                calculatedLevel={modalConfig.currentLevel}
            />

            {/* Добавляем стили прямо в компонент для подсветки */}
            <style>{`
                .red-zone-row {
                    background-color: #fff1f0;
                }
            `}</style>
        </div>
    );
};

export default ExpertReviewPage;