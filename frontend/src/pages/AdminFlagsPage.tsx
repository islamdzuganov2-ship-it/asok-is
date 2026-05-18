import React from 'react';
import { Typography, Card } from 'antd';

const { Title, Text } = Typography;

const AdminFlagsPage: React.FC = () => {
    return (
        <div style={{ padding: '24px' }}>
            <Title level={2}>Настройки системы (Admin)</Title>
            <Card>
                <Text>Модуль управления флагами функций и административными настройками.</Text>
            </Card>
        </div>
    );
};

export default AdminFlagsPage;