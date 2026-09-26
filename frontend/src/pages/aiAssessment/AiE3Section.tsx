/**
 * AiE3Section.tsx — условия испытаний СИИ (ГОСТ Р 59898-2021, разд. 7.2, 9; BL-001 E3):
 * тестовые наборы и выбросы, паритет сред, экспертная группа. Над вкладками — сводка готовности:
 * чего не хватает, чтобы результатам оценки можно было доверять.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Tabs } from 'antd';
import { premiumCard } from '../../theme/premium';
import { aiApi, type TestConditions } from './aiE3Api';
import type { AiGroup } from './aiModel';
import AiDatasetsTab from './AiDatasetsTab';
import AiParityTab from './AiParityTab';
import AiExpertTab from './AiExpertTab';

export const AiE3Section: React.FC<{ periodId: string; model: AiGroup[]; onValuesChanged: () => void }> = ({
  periodId, model, onValuesChanged,
}) => {
  const [cond, setCond] = useState<TestConditions | null>(null);
  const refresh = useCallback(() => {
    aiApi<TestConditions>(`/${periodId}/test-conditions`).then(setCond).catch(() => setCond(null));
  }, [periodId]);
  useEffect(refresh, [refresh]);

  return (
    <Card {...premiumCard('slate', { marginTop: 16 })} title="Условия испытаний (разд. 7.2, 9 ГОСТ Р 59898)">
      {cond && (
        <Alert style={{ marginBottom: 12 }} type={cond.ready ? 'success' : 'warning'} showIcon
          message={cond.ready ? 'Условия испытаний подтверждены: набор, выбросы, паритет сред, экспертная группа'
            : 'Условия испытаний подтверждены не полностью'}
          description={cond.ready ? undefined : <ul style={{ margin: 0, paddingLeft: 18 }}>{cond.gaps.map((g) => <li key={g}>{g}</li>)}</ul>} />
      )}
      <Tabs items={[
        { key: 'datasets', label: 'Тестовые наборы и выбросы', children: <AiDatasetsTab periodId={periodId} onChanged={refresh} /> },
        { key: 'parity', label: 'Паритет сред', children: <AiParityTab periodId={periodId} onChanged={refresh} /> },
        { key: 'experts', label: 'Экспертная группа', children: (
          <AiExpertTab periodId={periodId} model={model} onApplied={() => { refresh(); onValuesChanged(); }} />
        ) },
      ]} />
    </Card>
  );
};

export default AiE3Section;
