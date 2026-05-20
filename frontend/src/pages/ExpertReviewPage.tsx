import React, { useState } from 'react';
import { Alert, Button, Card, Progress, Space, Spin, Table, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { CalculatedMetric, useGetCalculatedMetricsQuery } from '../store/api/apiSlice';
import { ExpertJudgmentModal } from '../components/ExpertJudgmentModal';

const { Title, Text } = Typography;

export const ExpertReviewPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { data: metrics, isLoading, isError } = useGetCalculatedMetricsQuery(id!, { skip: !id });
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        metricId: string;
        currentLevel: string;
    }>({ isOpen: false, metricId: '', currentLevel: '' });

    const handleChallenge = (record: CalculatedMetric) => {
        setModalConfig({
            isOpen: true,
            metricId: record.id,
            currentLevel: record.systemLevel,
        });
    };

    const getLevelColor = (level: string) => {
        if (level.includes('Высок')) return 'success';
        if (level.includes('Сред')) return 'warning';
        if (level.includes('Низ') || level.includes('невозможно')) return 'error';
        return 'default';
    };

    if (isLoading) {
        return <Spin size="large" style={{ display: 'flex', margin: '20vh auto' }} />;
    }
    if (isError) {
        return <Alert type="error" showIcon message="Не удалось загрузить рассчитанные метрики" />;
    }

    const columns = [
        { title: 'Метрика', dataIndex: 'name', key: 'name', width: '30%' },
        {
            title: 'Расчет',
            dataIndex: 'calculatedX',
            key: 'calculatedX',
            width: '18%',
            render: (value: number) => (
                <Progress percent={value} size="small" status={value < 41 ? 'exception' : value < 81 ? 'normal' : 'success'} />
            ),
        },
        {
            title: 'Системный уровень',
            dataIndex: 'systemLevel',
            key: 'systemLevel',
            width: '18%',
            render: (value: string) => <Tag color={getLevelColor(value)}>{value}</Tag>,
        },
        {
            title: 'Комментарий',
            key: 'expertComment',
            width: '22%',
            render: (_: unknown, record: CalculatedMetric) => (
                <Space direction="vertical" size="small">
                    {record.adjustedLevel && <Tag color={getLevelColor(record.adjustedLevel)}>{record.adjustedLevel}</Tag>}
                    <Text type="secondary" style={{ fontSize: 12 }}>{record.expertComment || 'Нет комментария'}</Text>
                </Space>
            ),
        },
        {
            title: 'Действия',
            key: 'actions',
            width: '12%',
            render: (_: unknown, record: CalculatedMetric) => (
                <Button type={record.calculatedX < 41 ? 'primary' : 'default'} danger={record.calculatedX < 41} onClick={() => handleChallenge(record)}>
                    Оспорить
                </Button>
            ),
        },
    ];

    return (
        <div>
            <Title level={3}>Экспертиза и утверждение оценки</Title>
            <Card style={{ marginBottom: 24 }}>
                <Text>Метрики ниже 41% требуют управленческого внимания и могут быть скорректированы экспертным суждением.</Text>
            </Card>
            <Table
                dataSource={metrics || []}
                columns={columns}
                rowKey="id"
                pagination={false}
                bordered
                rowClassName={(record) => record.calculatedX < 41 ? 'red-zone-row' : ''}
            />
            <ExpertJudgmentModal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                metricId={modalConfig.metricId}
                calculatedLevel={modalConfig.currentLevel}
            />
            <style>{`.red-zone-row { background-color: #fff1f0; }`}</style>
        </div>
    );
};

export default ExpertReviewPage;
