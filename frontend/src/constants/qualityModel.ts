/**
 * qualityModel.ts — единый источник модели качества ИС (ISO/IEC 25010):
 * 8 характеристик и их подхарактеристики с типом формулы.
 *
 * ВАЖНО: держать синхронно с backend/app/constants/quality_model.py.
 * Этот список используется и для генерации мок-данных (data/mockScaleData.ts),
 * и для каскадных списков «Характеристика → Подхарактеристика», и для проверки
 * полноты оценки во вкладке «Внесение данных».
 */

export type Formula = 'DIRECT' | 'INVERSE';

export interface QualitySub {
  name: string;
  formula: Formula;
  /** Единица измерения объёма — используется только генератором мок-данных. */
  unit?: string;
}

export interface QualityCharacteristic {
  /** Полное название характеристики. */
  title: string;
  /** Короткая метка (для шапки теплокарты). */
  abbr: string;
  subs: QualitySub[];
}

export const QUALITY_MODEL: QualityCharacteristic[] = [
  { title: 'Функциональная пригодность', abbr: 'Функц.', subs: [
    { name: 'Функциональная полнота', formula: 'INVERSE', unit: 'требований' },
    { name: 'Функциональная корректность', formula: 'DIRECT', unit: 'проверок' },
    { name: 'Функциональная целесообразность', formula: 'DIRECT', unit: 'сценариев' },
  ] },
  { title: 'Производительность', abbr: 'Произв.', subs: [
    { name: 'Временные характеристики (отклик)', formula: 'INVERSE', unit: 'замеров' },
    { name: 'Использование ресурсов', formula: 'INVERSE', unit: 'узлов' },
    { name: 'Ёмкость (пропускная способность)', formula: 'DIRECT', unit: 'операций' },
  ] },
  { title: 'Совместимость', abbr: 'Совмест.', subs: [
    { name: 'Сосуществование', formula: 'DIRECT', unit: 'окружений' },
    { name: 'Интероперабельность', formula: 'DIRECT', unit: 'интеграций' },
  ] },
  { title: 'Удобство использования', abbr: 'Удобство', subs: [
    { name: 'Узнаваемость уместности', formula: 'DIRECT', unit: 'функций' },
    { name: 'Изучаемость', formula: 'DIRECT', unit: 'сценариев' },
    { name: 'Управляемость', formula: 'DIRECT', unit: 'операций' },
    { name: 'Защита от ошибок пользователя', formula: 'DIRECT', unit: 'форм' },
    { name: 'Эстетика интерфейса', formula: 'DIRECT', unit: 'экранов' },
    { name: 'Доступность (accessibility)', formula: 'DIRECT', unit: 'требований' },
  ] },
  { title: 'Надёжность', abbr: 'Надёжн.', subs: [
    { name: 'Зрелость (плотность дефектов)', formula: 'INVERSE', unit: 'функц. точек' },
    { name: 'Доступность (uptime)', formula: 'DIRECT', unit: 'часов' },
    { name: 'Отказоустойчивость', formula: 'DIRECT', unit: 'отказов' },
    { name: 'Восстанавливаемость (MTTR)', formula: 'INVERSE', unit: 'инцидентов' },
  ] },
  { title: 'Защищённость', abbr: 'Защищ.', subs: [
    { name: 'Конфиденциальность', formula: 'DIRECT', unit: 'проверок' },
    { name: 'Целостность', formula: 'DIRECT', unit: 'проверок' },
    { name: 'Неотказуемость', formula: 'DIRECT', unit: 'операций' },
    { name: 'Подотчётность (аудит)', formula: 'DIRECT', unit: 'событий' },
    { name: 'Аутентичность', formula: 'DIRECT', unit: 'проверок' },
  ] },
  { title: 'Сопровождаемость', abbr: 'Сопров.', subs: [
    { name: 'Модульность', formula: 'DIRECT', unit: 'модулей' },
    { name: 'Повторное использование', formula: 'DIRECT', unit: 'компонентов' },
    { name: 'Анализируемость', formula: 'DIRECT', unit: 'логов' },
    { name: 'Модифицируемость', formula: 'DIRECT', unit: 'изменений' },
    { name: 'Тестируемость', formula: 'DIRECT', unit: 'тест-кейсов' },
  ] },
  { title: 'Переносимость', abbr: 'Переност.', subs: [
    { name: 'Адаптируемость', formula: 'DIRECT', unit: 'сред' },
    { name: 'Устанавливаемость', formula: 'INVERSE', unit: 'установок' },
    { name: 'Заменяемость', formula: 'DIRECT', unit: 'компонентов' },
  ] },
];

/** Список из 8 названий характеристик (для верхнего выпадающего списка). */
export const CHARACTERISTICS: string[] = QUALITY_MODEL.map((c) => c.title);

/** Подхарактеристики выбранной характеристики (для каскадного списка). */
export const subsOf = (title: string): QualitySub[] =>
  QUALITY_MODEL.find((c) => c.title === title)?.subs ?? [];

export interface QualityPair {
  characteristic: string;
  subcharacteristic: string;
  formula: Formula;
}

/** Плоский список всех пар (характеристика × подхарактеристика) — 31 пара. */
export const QUALITY_PAIRS: QualityPair[] = QUALITY_MODEL.flatMap((c) =>
  c.subs.map((s) => ({ characteristic: c.title, subcharacteristic: s.name, formula: s.formula })),
);

/** Полное число подхарактеристик (эталон полноты оценки). */
export const TOTAL_SUBS: number = QUALITY_PAIRS.length;

/** Тип формулы для пары — DIRECT по умолчанию, если пара не из модели. */
export const formulaFor = (characteristic: string, subcharacteristic: string): Formula =>
  QUALITY_PAIRS.find(
    (p) => p.characteristic === characteristic && p.subcharacteristic === subcharacteristic,
  )?.formula ?? 'DIRECT';
