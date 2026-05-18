/**
 * Апогей восприятия (Executive Dashboard) для C-Level.
 * Отображает Global Health Score, AI Insights и Heatmap Matrix (ТЗ п.3.3).
 */
import React from 'react';
import { Card, Row, Col, Typography, Alert, Spin } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useGetExecutiveDashboardQuery } from '../store/api/apiSlice';

const { Title, Paragraph } = Typography;

export const ExecutiveDashboard: React.FC = () => {
    const { data, isLoading, isError } = useGetExecutiveDashboardQuery();

    if (isLoading) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: '20vh' }} />;
    if (isError || !data) return <Alert message="Ошибка загрузки данных дашборда" type="error" />;

    /**
     * Конфигурация для кольцевой диаграммы (Donut Chart) Global Health Score.
     */
    const donutOptions = {
        title: {
            text: `${data.globalHealthScore}%`,
            left: 'center',
            top: 'center',
            textStyle: { fontSize: 32, fontWeight: 'bold' }
        },
        tooltip: { trigger: 'item' },
        series: [
            {
                type: 'pie',
                radius: ['60%', '80%'],
                avoidLabelOverlap: false,
                itemStyle: {
                    borderRadius: 10,
                    borderColor: '#fff',
                    borderWidth: 2
                },
                label: { show: false },
                data: [
                    { value: data.globalHealthScore, name: 'Качество', itemStyle: { color: '#52c41a' } },
                    { value: 100 - data.globalHealthScore, name: 'Дефицит', itemStyle: { color: '#f5222d' } }
                ]
            }
        ]
    };

    /**
     * Конфигурация для тепловой карты (Heatmap Matrix).
     */
    const heatmapOptions = {
        tooltip: { position: 'top' },
        grid: { height: '50%', top: '10%' },
        xAxis: { type: 'category', data: data.xAxisLabels, splitArea: { show: true } },
        yAxis: { type: 'category', data: data.yAxisLabels, splitArea: { show: true } },
        visualMap: {
            min: 0,
            max: 100,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '15%',
            inRange: { color: ['#f5222d', '#faad14', '#52c41a'] } // От красного к зеленому
        },
        series: [{
            name: 'Качество',
            type: 'heatmap',
            data: data.heatmapData,
            label: { show: true },
            emphasis: {
                itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' }
            }
        }]
    };

    return (
        <div style={{ padding: '24px' }}>
            <Title level={2}>Executive Dashboard (C-Level)</Title>
            
            <Row gutter={[24, 24]}>
                {/* Global Health Score */}
                <Col span={8}>
                    <Card title="Global Health Score" style={{ height: '100%' }}>
                        <ReactECharts option={donutOptions} style={{ height: '300px' }} />
                    </Card>
                </Col>

                {/* AI Insights Component */}
                <Col span={16}>
                    <Card title="🤖 AI Insights (Резюме по ландшафту)" style={{ height: '100%' }}>
                        <Paragraph style={{ fontSize: '16px', lineHeight: '1.6' }}>
                            {data.aiInsights}
                        </Paragraph>
                    </Card>
                </Col>

                {/* Heatmap Matrix */}
                <Col span={24}>
                    <Card title="Heatmap Matrix (Матрица качества)">
                        <ReactECharts option={heatmapOptions} style={{ height: '500px' }} />
                    </Card>
                </Col>
            </Row>
        </div>
    );
};