import React, { useState } from 'react';
import { Alert, Button, Card, Space, Typography, Upload, message } from 'antd';
import { FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useImportAssessmentExcelMutation, useImportWorkbookMutation } from '../store/api/apiSlice';

const { Text } = Typography;

interface ExcelUploadBlockProps {
  periodId: string;
  onImported?: () => void;
}

const ExcelUploadBlock: React.FC<ExcelUploadBlockProps> = ({ periodId, onImported }) => {
  const [importAssessment, { isLoading: importingMetrics }] = useImportAssessmentExcelMutation();
  const [importWorkbook, { isLoading: importingWorkbook }] = useImportWorkbookMutation();
  const [lastResult, setLastResult] = useState<string | null>(null);

  const uploadProps: UploadProps = {
    accept: '.xlsx',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const metrics = await importAssessment({ id: periodId, file }).unwrap();
        const workbook = await importWorkbook({ id: periodId, file }).unwrap();
        setLastResult(
          `Метрики: ${metrics.imported}, пропущено: ${metrics.skipped}. ` +
          `Матрицы: риски ${workbook.matrices.risks}, недостатки ${workbook.matrices.defects}, план ${workbook.matrices.plans}.`
        );
        message.success('Файл загружен и разобран');
        onImported?.();
      } catch (error: any) {
        const detail = error?.data?.detail || error?.message || 'Ошибка импорта файла';
        message.error(detail);
      }
      return false;
    },
  };

  return (
    <Card size="small">
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <FileExcelOutlined style={{ color: '#1F3864' }} />
            <Text strong>Загрузка данных из Excel</Text>
          </Space>
          <Upload {...uploadProps}>
            <Button
              icon={<UploadOutlined />}
              loading={importingMetrics || importingWorkbook}
            >
              Загрузить .xlsx
            </Button>
          </Upload>
        </Space>
        {lastResult && <Alert type="success" showIcon message={lastResult} />}
      </Space>
    </Card>
  );
};

export default ExcelUploadBlock;
