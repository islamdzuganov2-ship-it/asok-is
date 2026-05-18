### GlobalHealthDonut (ECharts Pie/Donut)
- radius: ['40%', '70%'] — donut форма
- Цвета по RAG: зелёный ≥0.81, жёлтый 0.41-0.80, красный <0.41
- legend: vertical left, tooltip с процентами
- window resize handler + chart.dispose() в cleanup

### HeatmapMatrix (ECharts Heatmap)
- Ось X: 9 характеристик ISO 25010
- Ось Y: Информационные системы
- visualMap: 0-5 (Невозможно измерить → Высокий)
- Цветовая шкала от красного к тёмно-зелёному
- Высота: max(300, systems.length * 40 + 100) — адаптивная

### ProblematicSystemsList
- Ant Design Table топ-3 ИС по числу низких метрик
- Теги критичности: MISSION CRITICAL → red, BUSINESS CRITICAL → orange
- Число низких метрик → Text type="danger"

### Компоновка
- Row/Col с gutter=[16,16]
- Donut (Col lg={10}) + Проблемные ИС (Col lg={14})
- Heatmap на всю ширину (Col xs={24})
- AiInsightBanner внизу

Skeleton loading при isLoading из useGetSystemsQuery