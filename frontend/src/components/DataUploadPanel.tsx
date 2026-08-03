/**
 * DataUploadPanel.tsx — панель загрузки файлов оценок/ТС (ТЗ v16, T-50/T-51/T-43, Приложение F).
 *
 * Единый компонент для вкладок «Загрузка оценок» и «Загрузка ТС» раздела «Внесение данных»:
 *   • информационная подсказка по формату (типы файлов, поля, синонимы заголовков, правила);
 *   • «Скачать шаблон CSV» (заголовки + пример строки — заполнять вручную);
 *   • загрузка .csv/.xlsx с КЛИЕНТСКИМ предпросмотром CSV: заголовки нестандартизированного файла
 *     сопоставляются с нашими полями по синонимам (матчинг из uploadSpecs.matchColumn), показывается
 *     таблица распознанных строк и отчёт о недостающих обязательных колонках.
 *
 * Фактическое создание оценок/сбоев в БД выполняется на бэкенде (режим LLM) — здесь предпросмотр и
 * подготовка (парсинг XLSX — на сервере). Такой разрез позволяет проверить формат и сопоставление
 * до записи в хранилище.
 */
import React, { useState } from 'react';
import { Alert, Button, Card, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined, FileTextOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { useImportIncidentsMutation } from '../store/api/apiSlice';
import { matchColumn, type UploadSpec } from '../constants/uploadSpecs';

const { Text, Paragraph, Title } = Typography;

const csvCell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Минимальный CSV-парсер (разделитель «;» или «,», кавычки ""), без внешних зависимостей. */
function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const nl = t.indexOf('\n');
  const firstLine = nl >= 0 ? t.slice(0, nl) : t;
  const delim = firstLine.split(';').length >= firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i += 1; } else inQ = false; } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

interface PreviewState {
  fileName: string;
  total: number;
  mappedCols: { key: string; label: string; fileHeader: string }[];
  unmatchedHeaders: string[];
  missingRequired: string[];
  rows: Record<string, string>[];
}

const DataUploadPanel: React.FC<{ spec: UploadSpec }> = ({ spec }) => {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const isLive = useSelector((s: RootState) => s.ui.dataMode === 'live');
  const [importIncidents, { isLoading: importing }] = useImportIncidentsMutation();
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  // T-43: импорт распознанных строк ТС в БД (режим LLM). Ключи строк — snake_case (system_name…),
  // бэкенд-схема принимает их через populate_by_name.
  const doImport = async () => {
    if (!preview) return;
    try {
      const res = await importIncidents(preview.rows).unwrap();
      setImportResult(res);
      message.success(`Импортировано: ${res.created}, пропущено: ${res.skipped}`);
    } catch (e: any) {
      message.error(e?.data?.detail || 'Не удалось импортировать в БД');
    }
  };

  const downloadTemplate = () => {
    const headers = spec.columns.map((c) => c.label);
    const example = spec.columns.map((c) => c.example);
    const csv = '﻿' + [headers, example].map((r) => r.map(csvCell).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = spec.templateName;
    a.click();
    URL.revokeObjectURL(url);
    message.success('Шаблон скачан — заполните и загрузите обратно');
  };

  const handleFile = (file: File): boolean => {
    if (!/\.csv$/i.test(file.name)) {
      message.info('XLSX разбирается на сервере при загрузке (режим LLM). Для предпросмотра в браузере используйте CSV.');
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const grid = parseCsv(String(reader.result || ''));
        if (grid.length < 1) { message.error('Файл пуст'); return; }
        const headers = grid[0];
        // Сопоставление заголовков файла ↔ наши колонки (по синонимам).
        const mappedCols: PreviewState['mappedCols'] = [];
        const colIndex: Record<string, number> = {};
        const unmatchedHeaders: string[] = [];
        headers.forEach((h, i) => {
          const col = matchColumn(h, spec);
          if (col && !(col.key in colIndex)) {
            colIndex[col.key] = i;
            mappedCols.push({ key: col.key, label: col.label, fileHeader: h });
          } else if (!col && h.trim()) unmatchedHeaders.push(h);
        });
        const missingRequired = spec.columns.filter((c) => c.required && !(c.key in colIndex)).map((c) => c.label);
        const rows = grid.slice(1).map((r) => {
          const obj: Record<string, string> = {};
          mappedCols.forEach((mc) => { obj[mc.key] = r[colIndex[mc.key]] ?? ''; });
          return obj;
        });
        setImportResult(null);
        setPreview({ fileName: file.name, total: rows.length, mappedCols, unmatchedHeaders, missingRequired, rows });
        if (missingRequired.length) message.warning(`Не сопоставлены обязательные колонки: ${missingRequired.join(', ')}`);
        else message.success(`Распознано строк: ${rows.length}. Обязательные колонки сопоставлены.`);
      } catch {
        message.error('Не удалось разобрать CSV. Проверьте формат по инструкции.');
      }
    };
    reader.readAsText(file, 'utf-8');
    return false; // предотвращаем авто-загрузку — только клиентский предпросмотр
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <Title level={4} style={{ marginTop: 0 }}>{spec.title}</Title>

      {/* Информационная подсказка по формату */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Требования к файлу"
        description={(
          <div>
            <Paragraph style={{ marginBottom: 8 }}><b>Тип файла:</b> {spec.fileTypes}</Paragraph>
            <Text strong>Колонки (заголовки можно называть любым из синонимов):</Text>
            <Table
              size="small"
              style={{ marginTop: 8, marginBottom: 8 }}
              pagination={false}
              rowKey="key"
              dataSource={spec.columns}
              columns={[
                {
                  title: 'Поле', dataIndex: 'label', width: 200,
                  render: (v: string, r) => <Space size={6}><Text strong>{v}</Text>{r.required && <Tag color="red">обязательное</Tag>}</Space>,
                },
                { title: 'Синонимы заголовка', dataIndex: 'synonyms', render: (s: string[]) => s.join(', ') },
                { title: 'Формат', dataIndex: 'format' },
              ]}
            />
            <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
              {spec.notes.map((n) => <li key={n}><Text type="secondary">{n}</Text></li>)}
            </ul>
          </div>
        )}
      />

      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>Скачать шаблон CSV</Button>
      </Space>

      <Upload.Dragger accept=".csv,.xlsx,.xls" showUploadList={false} beforeUpload={handleFile} multiple={false}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Перетащите файл сюда или нажмите для выбора</p>
        <p className="ant-upload-hint">.csv — предпросмотр в браузере; .xlsx — разбор на сервере (режим LLM)</p>
      </Upload.Dragger>

      {preview && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={<Space><FileTextOutlined /><Text strong>Предпросмотр: {preview.fileName}</Text></Space>}
        >
          {preview.missingRequired.length ? (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message={`Не сопоставлены обязательные колонки: ${preview.missingRequired.join(', ')}`}
              description="Переименуйте заголовки в файле по инструкции (или используйте шаблон) и загрузите снова." />
          ) : (
            <Alert type="success" showIcon style={{ marginBottom: 12 }}
              message={`Распознано строк: ${preview.total}. Все обязательные колонки сопоставлены.`}
              description="В режиме LLM запись в БД выполнит бэкенд после загрузки; сейчас показан предпросмотр." />
          )}
          {preview.unmatchedHeaders.length > 0 && (
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              Не распознаны (будут проигнорированы): {preview.unmatchedHeaders.join(', ')}
            </Paragraph>
          )}
          {spec.kind === 'incidents' && preview.missingRequired.length === 0 && (
            <Space style={{ marginBottom: 12 }} wrap>
              <Button type="primary" icon={<CloudUploadOutlined />} loading={importing} disabled={!isLive} onClick={doImport}>
                Импортировать в БД ({preview.total})
              </Button>
              {!isLive && <Text type="secondary" style={{ fontSize: 12 }}>Импорт в БД доступен в режиме LLM (реальная БД)</Text>}
            </Space>
          )}
          {spec.kind === 'assessments' && preview.missingRequired.length === 0 && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message="Импорт оценок в БД — в разработке (T-50). Сейчас доступны предпросмотр и проверка формата." />
          )}
          {importResult && (
            <Alert
              type={importResult.created > 0 ? 'success' : 'warning'} showIcon style={{ marginBottom: 12 }}
              message={`Импортировано: ${importResult.created}, пропущено: ${importResult.skipped}`}
              description={importResult.errors.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {importResult.errors.slice(0, 10).map((e, i) => <li key={i}><Text type="secondary" style={{ fontSize: 12 }}>{e}</Text></li>)}
                </ul>
              ) : undefined}
            />
          )}
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={preview.rows.slice(0, 20)}
            pagination={preview.rows.length > 20 ? { pageSize: 20 } : false}
            scroll={{ x: true }}
            columns={preview.mappedCols.map((mc) => ({
              title: <span>{mc.label}{mc.fileHeader !== mc.label ? <Text type="secondary" style={{ fontSize: 11 }}> ← {mc.fileHeader}</Text> : null}</span>,
              dataIndex: mc.key,
              ellipsis: true,
            }))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>Показаны первые {Math.min(20, preview.rows.length)} из {preview.total} строк.</Text>
        </Card>
      )}
    </div>
  );
};

export default DataUploadPanel;
