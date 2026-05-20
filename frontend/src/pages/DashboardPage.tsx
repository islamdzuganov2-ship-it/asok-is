/**
 * Дашборд (C-Level & Manager View).
 * Реализует Global Health Score (Donut), Матрицу качества (Heatmap) и ТОП проблемных ИС (Table).
 */
import React, { useMemo } from 'react';
import { Row, Col, Card, Table, Typography, Tag, Spin, Alert } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useGetExecutiveDashboardQuery, useGetAllTemplatesQuery } from '../store/api/apiSlice';
import TemplatesDisplay from '../components/TemplatesDisplay';

const { Title, Text } = Typography;

export const DashboardPage: React.FC = () => {
    const { data, isLoading, isError } = useGetExecutiveDashboardQuery();
    const { data: templates, isLoading: templatesLoading } = useGetAllTemplatesQuery();

    // Расчет высоты для тепловой карты на лету
    const heatmapHeight = useMemo(() => {
        if (!data?.yAxisLabels) return 300;
        return Math.max(300, data.yAxisLabels.length * 40 + 100);
    }, [data?.yAxisLabels]);

    if (isLoading) return <Spin size="large" style={{ display: 'flex', margin: '20vh auto' }} />;
    if (isError || !data) return <Alert message="Ошибка загрузки данных дашборда" type="error" />;

    // 1. Конфиг для Global Health Score (Donut)
    const donutOptions = {
        title: {
            text: `${data.globalHealthScore}%`,
            left: 'center',
            top: 'center',
            textStyle: { fontSize: 36, fontWeight: 'bold', color: '#1F3864' }
        },
        tooltip: { trigger: 'item', formatter: '{b}: {c}%' },
        legend: { orient: 'vertical', left: 'left' },
        color: ['#52c41a', '#faad14', '#f5222d'], // RAG цвета
        series: [
            {
                name: 'Индекс здоровья',
                type: 'pie',
                radius: ['40%', '70%'],
                avoidLabelOverlap: false,
                itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                data: [
                    { value: data.globalHealthScore, name: 'Соответствие эталону' },
                    { value: 100 - data.globalHealthScore, name: 'Технический долг' }
                ]
            }
        ]
    };

    // 2. Конфиг для Матрицы качества (Heatmap)
    const heatmapOptions = {
        tooltip: { position: 'top' },
        grid: { height: '70%', top: '10%', left: '15%', right: '5%' },
        xAxis: { type: 'category', data: data.xAxisLabels, splitArea: { show: true }, axisLabel: { interval: 0, rotate: 30 } },
        yAxis: { type: 'category', data: data.yAxisLabels, splitArea: { show: true } },
        visualMap: {
            min: 0,
            max: 5,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '0%',
            inRange: { color: ['#f5222d', '#faad14', '#52c41a', '#237804'] }
        },
        series: [{
            name: 'Качество (0-5)',
            type: 'heatmap',
            data: data.heatmapData,
            label: { show: true },
            emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
        }]
    };

    // 3. Колонки для таблицы проблемных ИС (AntD Table)
    const columns = [
        { title: 'Система', dataIndex: 'name', key: 'name', width: '40%' },
        { 
            title: 'Критичность', 
            dataIndex: 'criticality', 
            key: 'criticality',
            render: (val: string) => {
                const color = val === 'MISSION CRITICAL' ? 'red' : val === 'BUSINESS CRITICAL' ? 'orange' : 'blue';
                return <Tag color={color}>{val}</Tag>;
            }
        },
        { 
            title: 'Низких метрик', 
            dataIndex: 'lowMetricsCount', 
            key: 'lowMetricsCount',
            render: (val: number) => <Text type="danger" strong>{val} ед.</Text>
        }
    ];

    // Берем данные напрямую из API (бекенд уже отправляет этот массив)
    const problematicSystemsList = data.problematicSystems || [];

    return (
        <div>
            <Title level={2} style={{ color: '#1F3864' }}>Панель управления (Executive View)</Title>
            
            <Row gutter={[16, 16]}>
                {/* Левая колонка: Donut Chart */}
                <Col xs={24} lg={10}>
                    <Card title="Global Health Score" style={{ height: '100%' }}>
                        <ReactECharts option={donutOptions} style={{ height: '300px' }} />
                    </Card>
                </Col>

                {/* Правая колонка: Проблемные ИС */}
                <Col xs={24} lg={14}>
                    <Card title="Топ проблемных ИС" style={{ height: '100%' }}>
                        <Table 
                            dataSource={problematicSystemsList}
                            columns={columns} 
                            rowKey="id"
                            pagination={false}
                            size="small"
                        />
                    </Card>
                </Col>

                {/* Нижний блок: Heatmap */}
                <Col xs={24}>
                    <Card title="Матрица качества (Характеристики ISO 25010)">
                        <ReactECharts 
                            option={heatmapOptions} 
                            style={{ height: `${heatmapHeight}px` }} 
                        />
                    </Card>
                </Col>

                {/* Шаблоны и предзаполненные данные */}
                <Col xs={24}>
                    <TemplatesDisplay templates={templates} isLoading={templatesLoading} />
                </Col>
            </Row>
        </div>
    );
};

export default DashboardPage;