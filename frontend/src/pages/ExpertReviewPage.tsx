### Таблица метрик
- Колонки: ID, X (4 знака), Уровень (Tag с RAG цветом), Комментарий, Источник, Кнопка "Судить"
- rowClassName: строки с Низким/Ниже среднего → ant-table-row-danger

### Modal IExpertJudgment
- Открывается по кнопке "Судить" (EditOutlined)
- Показывает текущий уровень и X в шапке
- Form поля:
  1. adjusted_level — Select с 7 вариантами (эмодзи RAG + текст), required
  2. justification_text — TextArea 4 строки, min 10 символов, maxLength 5000, showCount, required
  3. linked_risk_task — Input опциональный, placeholder Jira URL
- Кнопка "Применить корректировку": type=primary, loading при isSubmitting
- destroyOnClose + form.resetFields() при закрытии

### Обработка ответа
- useCreateExpertJudgmentMutation → unwrap()
- Успех → message.success + закрытие модала
- Ошибка → message.error
- RTK Query автоматически инвалидирует теги Metrics + ExpertJudgments → refetch таблицы