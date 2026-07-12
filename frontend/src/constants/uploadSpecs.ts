/**
 * uploadSpecs.ts — спецификации форматов файлов для загрузки (ТЗ v16, Приложение F).
 *
 * Единый источник для: (1) информационной подсказки в UI (какие поля, синонимы заголовков,
 * форматы), (2) генерации шаблона CSV, (3) сопоставления колонок нестандартизированного файла
 * из внешнего ITSM/ЕХД/DWH с нашими полями (автоугадывание по синонимам).
 *
 * Используется в components/DataUploadPanel.tsx (вкладки «Загрузка оценок» / «Загрузка ТС»).
 */
export interface UploadColumn {
  key: string;
  label: string;        // наша колонка (человекочитаемо)
  synonyms: string[];   // допустимые заголовки в файле (RU/EN, разные ITSM)
  required: boolean;
  format: string;       // краткое описание формата/значений
  example: string;      // пример значения (идёт в шаблон)
}

export interface UploadSpec {
  kind: 'assessments' | 'incidents';
  title: string;
  fileTypes: string;
  templateName: string;
  columns: UploadColumn[];
  notes: string[];
}

// F.1 — Загрузка оценок
export const ASSESSMENT_UPLOAD_SPEC: UploadSpec = {
  kind: 'assessments',
  title: 'Загрузка оценок (Excel/CSV)',
  fileTypes: '.xlsx (первый лист) или .csv (UTF-8, разделитель «;»). Первая строка — заголовки.',
  templateName: 'shablon_ocenki.csv',
  columns: [
    { key: 'system', label: 'Система (ИС)', synonyms: ['Система', 'ИС', 'Информационная система', 'System'], required: true, format: 'название ИС, как в реестре систем', example: 'АБС «Ядро»' },
    { key: 'period', label: 'Период', synonyms: ['Период', 'Квартал', 'Period'], required: true, format: 'Q1-2026 / 2026-Q1 / 01.2026', example: 'Q2-2026' },
    { key: 'characteristic', label: 'Характеристика', synonyms: ['Характеристика', 'Characteristic'], required: true, format: 'из 8 названий модели ISO/IEC 25010', example: 'Надёжность' },
    { key: 'metric', label: 'Метрика (подхарактеристика)', synonyms: ['Метрика', 'Подхарактеристика', 'Metric'], required: true, format: 'из модели качества', example: 'Завершённость по зрелости' },
    { key: 'value_a', label: 'A (числитель)', synonyms: ['A', 'Числитель', 'Факт'], required: true, format: 'число', example: '48' },
    { key: 'value_b', label: 'B (знаменатель)', synonyms: ['B', 'Знаменатель', 'База'], required: true, format: 'число > 0 (0/пусто → «невозможно измерить»)', example: '50' },
    { key: 'comment', label: 'Комментарий', synonyms: ['Комментарий', 'Обоснование', 'Comment'], required: false, format: 'текст', example: 'Плановый прогон регресса' },
    { key: 'expert_comment', label: 'Проф. суждение', synonyms: ['Проф. суждение', 'Профессиональное суждение', 'Expert comment'], required: false, format: 'текст (обязателен, если B пусто)', example: '' },
    { key: 'formula', label: 'Формула', synonyms: ['Формула', 'Formula'], required: false, format: 'DIRECT (A/B) или INVERSE (1−A/B); иначе берётся из модели', example: 'DIRECT' },
  ],
  notes: [
    'Значение метрики считается по формуле модели: DIRECT = A/B, INVERSE = 1 − A/B.',
    'Пустой или нулевой B → метрика «невозможно измерить» (требует причину + проф. суждение + меру).',
    'Строки с неизвестной системой/характеристикой/метрикой отклоняются с указанием причины; остальные принимаются.',
    'XLSX разбирается на сервере при загрузке (режим LLM); предпросмотр в браузере — для CSV.',
  ],
};

// F.2 — Загрузка техсбоев (ТС)
export const INCIDENT_UPLOAD_SPEC: UploadSpec = {
  kind: 'incidents',
  title: 'Загрузка техсбоев (Excel/CSV) — при отсутствии интеграции с ITSM',
  fileTypes: '.xlsx / .csv (UTF-8, «;»). Первая строка — заголовки. Поля из ITSM/ЕХД/DWH не обязаны совпадать с нашими — сопоставление по синонимам ниже.',
  templateName: 'shablon_ts.csv',
  columns: [
    { key: 'system_name', label: 'Система (ИС)', synonyms: ['Система', 'ИС', 'CI', 'Сервис', 'Affected CI', 'System'], required: true, format: 'текст', example: 'CRM ОПК' },
    { key: 'title', label: 'Краткое описание', synonyms: ['Краткое описание', 'Тема', 'Summary', 'Subject'], required: true, format: 'текст', example: 'Регрессия расчёта скидок после релиза' },
    { key: 'occurred_at', label: 'Дата возникновения', synonyms: ['Дата возникновения', 'Открыт', 'Opened', 'Created', 'Start'], required: true, format: 'ДД.ММ.ГГГГ [ЧЧ:ММ] или ISO YYYY-MM-DD', example: '10.02.2026 09:00' },
    { key: 'category', label: 'Первопричина', synonyms: ['Первопричина', 'Категория', 'Root cause', 'Cause', 'Тип'], required: true, format: 'текст → RELEASE/INFRASTRUCTURE/PERFORMANCE/NETWORK/POWER/OTHER', example: 'Привнесено релизом' },
    { key: 'severity', label: 'Критичность', synonyms: ['Критичность', 'Priority', 'Severity', 'Приоритет'], required: false, format: 'critical/high/medium/low (или P1..P4)', example: 'high' },
    { key: 'resolved_at', label: 'Дата восстановления', synonyms: ['Дата восстановления', 'Закрыт', 'Resolved', 'Closed', 'End'], required: false, format: 'дата/время (пусто → сбой открыт)', example: '11.02.2026 05:00' },
    { key: 'root_cause', label: 'Корневая причина', synonyms: ['Корневая причина', 'RCA', 'Root cause description'], required: false, format: 'текст', example: 'Некорректная миграция правил ценообразования' },
    { key: 'admission_cause', label: 'Причина допущения', synonyms: ['Причина допущения'], required: false, format: 'текст', example: 'Не выполнен приёмочный прогон' },
    { key: 'responsible_unit', label: 'Виновное направление', synonyms: ['Виновное направление', 'Подразделение', 'Assignment group'], required: false, format: 'текст', example: 'Разработка CRM' },
    { key: 'preventive_measures', label: 'Меры по неповторению', synonyms: ['Меры по неповторению', 'Corrective actions'], required: false, format: 'текст', example: 'Обязательный регресс перед релизом' },
    { key: 'release_ref', label: 'Релиз/версия', synonyms: ['Релиз', 'Версия', 'Change', 'RFC'], required: false, format: 'текст', example: 'CRM 4.2.0' },
  ],
  notes: [
    'Даты: ДД.ММ.ГГГГ, ДД.ММ.ГГГГ ЧЧ:ММ или ISO-8601. Некорректная дата возникновения → строка отклоняется.',
    'MTTR не загружается — вычисляется как (Дата восстановления − Дата возникновения).',
    'Первопричина сопоставляется по синонимам; нераспознанное значение → OTHER + исходный текст.',
    'Приоритет P1/P2/P3/P4 → critical/high/medium/low.',
    'Дедупликация по (Система + Краткое описание + Дата возникновения).',
    'XLSX разбирается на сервере; предпросмотр в браузере — для CSV.',
  ],
};

// Нормализация заголовка для сопоставления (регистр, ё/е, небуквенные символы).
const normHeader = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

/** Сопоставить заголовок файла с нашей колонкой по синонимам (или null). */
export function matchColumn(header: string, spec: UploadSpec): UploadColumn | null {
  const h = normHeader(header);
  return spec.columns.find((c) =>
    [c.key, c.label, ...c.synonyms].some((syn) => normHeader(syn) === h)) ?? null;
}
