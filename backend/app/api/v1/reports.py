 GET /reports/{period_id}/xlsx — Excel через openpyxl, RAG-заливка ячеек уровня качества, агрегатная строка по уровням
- GET /reports/{period_id}/json — JSON с meta + metrics
- GET /reports/{period_id}/csv — CSV с UTF-8 BOM для MS Excel
- PDF отключён за Feature Flag FEATURE_PDF_REPORTS
- StreamingResponse для всех форматов (не буферизует в памяти сервера)
- RAG цвета: Высокий=FF52C41A, Выше ср.=FF73D13D, Средний=FFFAAD14, Ниже ср.=FFFA8C16, Низкий=FFF5222D, Нет=FFD9D9D9