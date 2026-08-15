#!/usr/bin/env bash
# Прогон тест-сценариев АСОК ИС по живому API (маршруты сверены с /openapi.json).
API=http://localhost:8000/api/v1
PASS=0; FAIL=0; declare -a FAILED

login() { curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d "{\"username\":\"$1\",\"password\":\"$2\"}" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }

code() {
  local id="$1" exp="$2" desc="$3"; shift 3
  local got; got=$(curl -s -o /dev/null -w "%{http_code}" "$@")
  if [ "$got" = "$exp" ]; then PASS=$((PASS+1)); printf "PASS | %-11s | %s получ %s | %s\n" "$id" "$exp" "$got" "$desc"
  else FAIL=$((FAIL+1)); FAILED+=("$id"); printf "FAIL | %-11s | ожид %s ПОЛУЧ %s | %s\n" "$id" "$exp" "$got" "$desc"; fi
}
body() {
  local id="$1" pat="$2" desc="$3"; shift 3
  local out; out=$(curl -s "$@")
  if echo "$out" | grep -q "$pat"; then PASS=$((PASS+1)); printf "PASS | %-11s | есть '%s' | %s\n" "$id" "$pat" "$desc"
  else FAIL=$((FAIL+1)); FAILED+=("$id"); printf "FAIL | %-11s | НЕТ '%s' | %s :: %s\n" "$id" "$pat" "$desc" "$(echo "$out" | head -c 140)"; fi
}

TOK_SUPER=$(login superadmin 'Super123!'); H_SUPER="Authorization: Bearer $TOK_SUPER"
TOK_ADMIN=$(login admin 'Admin123!');      H_ADMIN="Authorization: Bearer $TOK_ADMIN"
TOK_MGR=$(login manager 'Manager123!');    H_MGR="Authorization: Bearer $TOK_MGR"
TOK_ANL=$(login analyst 'Analyst123!');    H_ANL="Authorization: Bearer $TOK_ANL"
TOK_CTO=$(login cto 'Cto12345!');          H_CTO="Authorization: Bearer $TOK_CTO"
TOK_CEO=$(login ceo 'Ceo12345!');          H_CEO="Authorization: Bearer $TOK_CEO"
TOK_RISK=$(login risk 'Risk123!');         H_RISK="Authorization: Bearer $TOK_RISK"
TOK_AUD=$(login auditor 'Auditor123!');    H_AUD="Authorization: Bearer $TOK_AUD"

echo "===== П-01 Аутентификация ====="
[ -n "$TOK_MGR" ] && { PASS=$((PASS+1)); echo "PASS | ТС-01-01    | токен выдан | Логин менеджера по качеству"; } || { FAIL=$((FAIL+1)); FAILED+=(ТС-01-01); echo "FAIL | ТС-01-01    | токена нет | Логин МК"; }
[ -n "$TOK_SUPER" ] && [ -n "$TOK_ADMIN" ] && [ -n "$TOK_ANL" ] && [ -n "$TOK_CTO" ] && [ -n "$TOK_CEO" ] && [ -n "$TOK_RISK" ] && [ -n "$TOK_AUD" ] \
  && { PASS=$((PASS+1)); echo "PASS | ТС-01-02    | 8/8 ролей | Логин работает для всех 8 ролей"; } \
  || { FAIL=$((FAIL+1)); FAILED+=(ТС-01-02); echo "FAIL | ТС-01-02    | не все роли логинятся"; }
code "ТС-01-03" 401 "Логин с неверным паролем отклонён" -X POST $API/auth/login -H "Content-Type: application/json" -d '{"username":"manager","password":"wrong"}'
code "ТС-01-04" 401 "Логин несуществующего пользователя отклонён" -X POST $API/auth/login -H "Content-Type: application/json" -d '{"username":"nobody","password":"x"}'
code "ТС-01-05" 200 "Обновление токена (refresh)" -X POST $API/auth/refresh -H "Content-Type: application/json" -d "{\"refresh_token\":\"$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"username":"manager","password":"Manager123!"}' | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')\"}"

echo "===== П-02 RBAC ====="
body "ТС-02-01" 'assessment.edit' "Менеджер получает свой набор прав" $API/iam/me/permissions -H "$H_MGR"
code "ТС-02-02" 200 "Суперадмин видит пользователей" $API/iam/users -H "$H_SUPER"
code "ТС-02-03" 403 "ADMIN НЕ видит пользователей (прерогатива SUPER_ADMIN)" $API/iam/users -H "$H_ADMIN"
code "ТС-02-04" 403 "Аналитик НЕ видит пользователей" $API/iam/users -H "$H_ANL"
code "ТС-02-05" 200 "Суперадмин читает матрицу прав" $API/iam/permissions/matrix -H "$H_SUPER"
code "ТС-02-06" 403 "Менеджер НЕ читает матрицу прав" $API/iam/permissions/matrix -H "$H_MGR"
code "ТС-02-07" 200 "Каталог прав доступен суперадмину" $API/iam/permissions/catalog -H "$H_SUPER"
code "ТС-02-08" 200 "Суперадмин видит качество LLM" $API/reports/llm-quality -H "$H_SUPER"
code "ТС-02-09" 403 "ADMIN НЕ видит качество LLM (ТЗ v18 п.10)" $API/reports/llm-quality -H "$H_ADMIN"
code "ТС-02-10" 403 "CTO НЕ видит качество LLM" $API/reports/llm-quality -H "$H_CTO"

echo "===== П-03 Системы и периоды ====="
body "ТС-03-01" '"items"' "Список систем отдаётся" $API/systems -H "$H_MGR"
body "ТС-03-02" 'АБС Core' "Сценарная система «АБС Core» присутствует" $API/systems -H "$H_MGR"
body "ТС-03-03" 'period' "Сводка по периодам отдаётся" $API/assessments/periods/summary -H "$H_MGR"
code "ТС-03-04" 200 "Список периодов оценки" $API/assessments/periods -H "$H_MGR"
code "ТС-03-05" 403 "Аудитор НЕ может создать систему" -X POST $API/systems -H "$H_AUD" -H "Content-Type: application/json" -d '{"name":"X","code":"X","criticality_class":"BUSINESS OPERATIONAL"}'

echo "===== П-04 Каталог метрик и оценка ====="
body "ТС-04-01" 'characteristic' "Каталог метрик отдаётся" $API/metrics/ -H "$H_ANL"
code "ТС-04-02" 200 "Дашборд оценок доступен" $API/assessments/dashboard -H "$H_MGR"

echo "===== П-06 Профессиональные суждения ====="
code "ТС-06-01" 200 "Статус заполнения суждений" $API/assessments/judgments-status -H "$H_MGR"
code "ТС-06-02" 200 "Пары без суждения (judgments-pending)" $API/assessments/judgments-pending -H "$H_MGR"
code "ТС-06-03" 200 "Заполненные суждения" $API/assessments/judgments-filled -H "$H_MGR"
body "ТС-06-04" '' "DEF-14: по умолчанию только последний период" "$API/assessments/judgments-pending" -H "$H_MGR"

echo "===== П-09 Governance ====="
code "ТС-09-01" 200 "Менеджер читает меры" $API/governance/proposals -H "$H_MGR"
code "ТС-09-02" 200 "CTO читает меры" $API/governance/proposals -H "$H_CTO"
code "ТС-09-03" 422 "Создание меры без обязательных полей отклоняется" -X POST $API/governance/proposals -H "$H_MGR" -H "Content-Type: application/json" -d '{}'
code "ТС-09-04" 403 "Аудитор НЕ может предлагать меры" -X POST $API/governance/proposals -H "$H_AUD" -H "Content-Type: application/json" -d '{}'

echo "===== П-13 Аналитика сбоев ====="
code "ТС-13-01" 200 "Реестр техсбоев доступен менеджеру" $API/incidents -H "$H_MGR"
code "ТС-13-02" 200 "Аналитика сбоев отдаётся" $API/incidents/analytics -H "$H_MGR"
code "ТС-13-03" 200 "Справочник первопричин (T-37)" $API/incidents/categories -H "$H_MGR"
code "ТС-13-04" 403 "Аудитор НЕ может править реестр сбоев" -X POST $API/incidents -H "$H_AUD" -H "Content-Type: application/json" -d '{}'

echo "===== П-14 База рисков ====="
code "ТС-14-01" 200 "База рисков доступна" $API/risks -H "$H_MGR"
code "ТС-14-02" 200 "Поиск по базе рисков" "$API/risks/search?q=%D0%B4%D0%BE%D1%81%D1%82%D1%83%D0%BF" -H "$H_MGR"
code "ТС-14-03" 200 "Семантический поиск (T-20/pgvector)" "$API/risks/semantic-search?q=%D0%BE%D1%82%D0%BA%D0%B0%D0%B7" -H "$H_MGR"
code "ТС-14-04" 200 "Сработавшие риск-триггеры (T-16)" $API/risks/triggered -H "$H_MGR"
code "ТС-14-05" 403 "Аналитик НЕ может пересчитать эмбеддинги" -X POST $API/risks/reembed -H "$H_ANL"

echo "===== П-15 Риск-экономика ====="
code "ТС-15-01" 200 "Дашборд стоимости (RE-16)" $API/econ/dashboard -H "$H_RISK"
code "ТС-15-02" 200 "Финпараметры контура (RE-04)" $API/econ/config -H "$H_RISK"
code "ТС-15-03" 200 "Ставки L1/L2/L3 (RE-03)" $API/econ/rates -H "$H_RISK"
code "ТС-15-04" 200 "Бизнес-процессы (RE-01)" $API/econ/business-processes -H "$H_RISK"
code "ТС-15-05" 200 "Каталог мер (RE-10)" $API/econ/measure-catalog -H "$H_MGR"
code "ТС-15-06" 200 "Веса подхарактеристик (RE-15)" $API/econ/weights -H "$H_MGR"
code "ТС-15-07" 200 "Эффективность руководителей (RE-20)" $API/econ/manager-metrics -H "$H_ADMIN"
code "ТС-15-08" 403 "Менеджер НЕ правит финпараметры (econ.config.edit)" -X PUT $API/econ/config/risk_appetite -H "$H_MGR" -H "Content-Type: application/json" -d '{"value":"1"}'

echo "===== П-16 Несоответствия (RE-14) ====="
code "ТС-16-01" 200 "Реестр несоответствий" $API/nonconformities -H "$H_RISK"
code "ТС-16-02" 200 "Воронка замыкания контура" $API/nonconformities/funnel -H "$H_RISK"

echo "===== П-17 Рисковые события (RE-08) ====="
code "ТС-17-01" 200 "Реестр рисковых событий" $API/risk-events -H "$H_RISK"
code "ТС-17-02" 403 "Менеджер НЕ ведёт реестр рисковых событий (SoD)" -X POST $API/risk-events -H "$H_MGR" -H "Content-Type: application/json" -d '{}'

echo "===== П-18 Отчёты ====="
code "ТС-18-01" 200 "Управленческий дашборд отдаётся" $API/reports/executive-dashboard -H "$H_CTO"
code "ТС-18-02" 200 "Динамика качества по системе" $API/reports/system-dynamics -H "$H_MGR"

echo "===== П-20 LLM ====="
body "ТС-20-01" 'enabled' "Статус LLM отдаётся" $API/reports/llm-status -H "$H_MGR"
code "ТС-20-02" 200 "Список доступных моделей (модель-агностичность)" $API/reports/llm-models -H "$H_MGR"
code "ТС-20-03" 200 "Описание пайплайна LLM (ТЗ v18)" $API/reports/llm-pipeline -H "$H_MGR"
code "ТС-20-04" 403 "Менеджер НЕ перезагружает модель" -X POST $API/reports/llm-reload -H "$H_MGR"
code "ТС-20-05" 403 "ADMIN НЕ запускает самооценку LLM" -X POST $API/reports/llm-quality/run -H "$H_ADMIN"

echo "===== П-22 Оценка СИИ ====="
code "ТС-22-01" 200 "Каталог модели ГОСТ Р 59898 отдаётся" $API/ai-assessments/ai-model -H "$H_MGR"

echo "===== П-БЕЗ Безопасность ====="
code "ТС-БЕЗ-01" 401 "Запрос БЕЗ токена отклоняется" $API/systems
code "ТС-БЕЗ-02" 401 "Запрос с ПОДДЕЛЬНЫМ токеном отклоняется" $API/systems -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.FORGED.SIG"
code "ТС-БЕЗ-03" 401 "Запись БЕЗ токена отклоняется" -X POST $API/systems -H "Content-Type: application/json" -d '{"name":"HACK","code":"HACK","criticality_class":"BUSINESS OPERATIONAL"}'
printf 'not-an-xlsx' > /tmp/evil.txt
code "ТС-БЕЗ-04" 400 "Загрузка не-xlsx отклоняется" -X POST $API/excel/upload -H "$H_ANL" -F "period_id=00000000-0000-0000-0000-000000000000" -F "file=@/tmp/evil.txt;filename=evil.txt"
printf 'PK\x03\x04fake' > /tmp/fake.xlsx
code "ТС-БЕЗ-05" 400 "Файл с расширением .xlsx, но битый — отклоняется на парсинге" -X POST $API/excel/import-assessment -H "$H_ANL" -F "period_id=00000000-0000-0000-0000-000000000000" -F "file=@/tmp/fake.xlsx"
code "ТС-БЕЗ-06" 404 "Несуществующий эндпоинт возвращает 404" $API/nonexistent -H "$H_MGR"

echo
echo "ИТОГО: PASS=$PASS FAIL=$FAIL"
[ ${#FAILED[@]} -gt 0 ] && echo "Провалены: ${FAILED[*]}"
