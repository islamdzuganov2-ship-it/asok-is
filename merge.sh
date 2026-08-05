#!/bin/bash
# Merge script for Templates Display Feature

set -e

WORKTREE_PATH="c:\Users\adiga\projects\asok-is.worktrees\agents-template-reflection-and-data-display"
MAIN_REPO_PATH="C:\Users\adiga\projects\asok-is"
TOPIC_BRANCH="agents/template-reflection-and-data-display"
BASE_BRANCH="main"

echo "=== Step 1: Checking status in current worktree ==="
cd "$WORKTREE_PATH"
git status

echo ""
echo "=== Step 2: Staging all changes ==="
git add -A

echo ""
echo "=== Step 3: Creating commit ==="
git commit -m "feat: implement Excel templates display on dashboard" -m "- Add backend service for parsing Excel template files
- Create new /api/v1/reports/templates endpoint
- Add AllTemplatesOut schema for template data
- Create TemplatesDisplay React component
- Add useGetAllTemplatesQuery hook to API slice
- Integrate templates display on Dashboard page
- Load 4 Excel templates automatically on dashboard init
- Support pagination, responsive design, error handling
- Add comprehensive documentation (6 files)

Templates now display in tabbed view on Dashboard with:
- Шаблон Метрик (metrics template)
- Матрица Рисков (risk matrix)
- Детальный Отчет по Метрикам (quality report)
- Качество Системы по Времени (system quality over time)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

echo ""
echo "=== Step 4: Verifying commit ==="
git log --oneline -1

echo ""
echo "=== Step 5: Merging to main branch ==="
cd "$MAIN_REPO_PATH"
git merge "$TOPIC_BRANCH"

echo ""
echo "=== Step 6: Verifying merge ==="
git status
git log --oneline -3

echo ""
echo "✅ Merge completed successfully!"
