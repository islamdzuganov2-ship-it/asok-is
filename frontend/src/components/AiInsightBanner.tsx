import React from 'react';
import { Alert } from 'antd';

interface AiInsightBannerProps {
    insight?: string;
}

export const AiInsightBanner: React.FC<AiInsightBannerProps> = ({ insight }) => {
    if (!insight) {
        return null;
    }

    return <Alert type="info" showIcon message={insight} />;
};

export default AiInsightBanner;
