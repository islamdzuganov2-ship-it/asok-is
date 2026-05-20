/**
 * ТЗ: Структуры данных, соответствующие приложенным Excel-файлам:
 * 1. Таблица возможных рисков
 * 2. Перечень недостатков ИС
 * 3. План обеспечения качества
 */

export interface RiskRecord {
    id: string;
    characteristic: string;
    subCharacteristic: string;
    riskDescription: string;
    riskConsequence: string;
    mitigation: string;
}

export interface DefectRecord {
    id: string;
    characteristic: string;
    qualityMetric: string;
    digitalMetric: string;
    defectDescription: string;
}

export interface QualityPlanRecord {
    id: string;
    characteristic: string;
    subCharacteristic: string;
    taskDescription: string;
    internalDocument: string;
    assignee: string;
    deadline: string;
}

// Заглушки на основе структуры предоставленных шаблонов
export const mockRisksData: RiskRecord[] = [
    {
        id: '1',
        characteristic: 'Функциональная пригодность',
        subCharacteristic: 'Функциональное покрытие',
        riskDescription: 'Неполное покрытие требований автотестами',
        riskConsequence: 'Риск отказов и (или) нарушения функционирования ИС',
        mitigation: 'Увеличить штат QA-автоматизаторов, внедрить обязательное покрытие для критичных модулей',
    }
];

export const mockDefectsData: DefectRecord[] = [
    {
        id: '1',
        characteristic: 'Функциональная пригодность',
        qualityMetric: 'Уровень автоматизации',
        digitalMetric: '20%',
        defectDescription: 'Низкий уровень АТ вызван ограниченными ресурсами в условиях большого объема кейсов',
    },
    {
        id: '2',
        characteristic: 'Совместимость',
        qualityMetric: 'Покрытие интеграций',
        digitalMetric: '92%',
        defectDescription: 'Отсутствует интеграция с 1С-ЗУП (в процессе реализации)',
    }
];

export const mockPlanData: QualityPlanRecord[] = [
    {
        id: '1',
        characteristic: 'Надежность',
        subCharacteristic: 'Полнота резервных копий',
        taskDescription: 'Обеспечить 100% выполнение плана резервного копирования',
        internalDocument: 'Распоряжение 77-НШ',
        assignee: 'Иванов И.И. (Архитектор БД)',
        deadline: 'Q3 2026',
    }
];