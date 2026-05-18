import React from 'react';
import { Typography, Card } from 'antd';

const { Title, Text } = Typography;

const AdminFlagsPage: React.FC = () => {
    return (
        <div style={{ padding: '24px' }}>
            <Title level={2}>Настройки системы (Feature Flags)</Title>
            <Card>
                <Text>Данный модуль находится в разработке. Здесь будут располагаться административные переключатели функций.</Text>
            </Card>
        </div>
    );
};

export default AdminFlagsPage;