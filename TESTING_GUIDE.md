# Deployment & Testing Guide: Templates Display Feature

## Overview
This document provides step-by-step instructions to deploy and test the new Templates Display feature that shows Excel template data on the Dashboard.

## What Was Implemented

### Problem Statement
- Excel templates with pre-filled data were not visible on the frontend
- Current assessment data from tables was not being displayed
- Users needed a way to see available templates and current data

### Solution
- Backend service to parse Excel template files from project root
- New API endpoint `/api/v1/reports/templates` to serve template data
- Frontend components to display templates in tabbed view on Dashboard
- Automatic loading of all 4 Excel templates

## Files Changed/Created

### Backend Files
```
backend/app/services/templates.py (NEW)
  - load_excel_template(): Generic loader for any Excel file
  - load_metrics_template(): Loads metrics template
  - load_risks_template(): Loads risks/test manager template  
  - load_quality_report_template(): Loads detailed quality report
  - load_system_quality_template(): Loads system quality over time

backend/app/api/v1/reports.py (MODIFIED)
  - Added imports for template service and schemas
  - Added GET /reports/templates endpoint
  - Returns AllTemplatesOut with all 4 templates

backend/app/schemas/assessment.py (MODIFIED)
  - Added TemplateDataOut schema
  - Added AllTemplatesOut schema containing all template data
```

### Frontend Files
```
frontend/src/store/api/apiSlice.ts (MODIFIED)
  - Added AllTemplates interface
  - Added useGetAllTemplatesQuery() hook
  - Exports new hook in module

frontend/src/components/TemplatesDisplay.tsx (NEW)
  - React component for displaying templates
  - Tabbed view for 4 templates
  - Dynamic table generation from Excel data
  - Pagination support

frontend/src/pages/DashboardPage.tsx (MODIFIED)
  - Imports new hook and component
  - Fetches templates data
  - Renders TemplatesDisplay component below heatmap
```

## Installation & Setup

### Backend Setup

1. **Verify dependencies are installed:**
   ```bash
   cd backend
   pip install -r requirements.txt  # or poetry install
   ```

2. **Verify openpyxl is installed** (needed for Excel parsing):
   ```bash
   pip list | grep openpyxl
   # Should show: openpyxl >= 3.0
   ```

3. **Start backend server:**
   ```bash
   cd backend
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   Expected output:
   ```
   Uvicorn running on http://0.0.0.0:8000
   ```

### Frontend Setup

1. **Verify dependencies are installed:**
   ```bash
   cd frontend
   npm install
   ```

2. **Start frontend development server:**
   ```bash
   npm run dev
   ```

   Expected output:
   ```
   VITE v... ready in ... ms
   ➜  Local:   http://localhost:5173/
   ```

## Testing Instructions

### 1. Navigate to Dashboard

1. Start both backend and frontend servers (see above)
2. Open browser to `http://localhost:5173/` (or your frontend URL)
3. Login with your credentials
4. Navigate to Dashboard page

### 2. Verify Templates Are Loaded

1. **Scroll down** below the "Матрица качества (Характеристики ISO 25010)" section
2. You should see a new card titled "Загруженные Шаблоны и Данные"
3. The card should contain 4 tabs:
   - Шаблон Метрик (Metrics Template)
   - Матрица Рисков (Risk Matrix)
   - Детальный Отчет по Метрикам (Quality Report)
   - Качество Системы по Времени (System Quality)

### 3. Test Each Tab

**Tab 1: Шаблон Метрик (Metrics)**
- Click the first tab
- Should show table with data from "шаблон заполнения метрик.xlsx"
- Columns should automatically generate from Excel headers
- Data should be paginated (10 rows per page)

**Tab 2: Матрица Рисков (Risks)**
- Click the second tab  
- Should show risk matrix data
- May be from "шаблон предоставления информации для тест-менеджера после анализа LLM.xlsx"
- Verify columns match Excel structure

**Tab 3: Детальный Отчет (Quality Report)**
- Click the third tab
- Should show data from "шаблон формирования детального отчета по каждой метрике.xlsx"
- Verify all rows display correctly

**Tab 4: Качество Системы (System Quality)**
- Click the fourth tab
- Should show data from "Качество системы в разрезе времени по всем характеристикам.xlsx"
- Verify timeline/quality data displays

### 4. Test Loading States

1. **Empty state**: If an Excel file has no data, tab should show "Нет данных в..."
2. **Pagination**: Try navigating between pages in a tab
3. **Scrolling**: For wide tables, horizontal scroll should appear
4. **Responsiveness**: Resize browser to test responsive layout

### 5. Test API Endpoint Directly

```bash
# Test the new endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/v1/reports/templates

# Should return JSON like:
{
  "metrics": [...],
  "risks": [...],
  "qualityReport": [...],
  "systemQuality": [...]
}
```

## Troubleshooting

### Issue: "Templates tab not showing on Dashboard"

**Solution:**
1. Check browser console for errors (F12 → Console)
2. Verify backend is running: `curl http://localhost:8000/health`
3. Verify API endpoint returns data: `curl http://localhost:8000/api/v1/reports/templates`
4. Check that you're authenticated and have Dashboard access

### Issue: "Loading spinner never disappears"

**Solution:**
1. Check backend logs for errors
2. Verify Excel files exist in project root:
   ```bash
   ls -la *.xlsx
   ```
3. Check browser Network tab (F12 → Network) to see API response
4. Verify openpyxl is installed: `pip list | grep openpyxl`

### Issue: "Tables show 'Нет данных' (No data)"

**Solution:**
1. Verify Excel files have data (not just headers)
2. Check that Excel files are not corrupted
3. Try opening Excel files manually to verify content
4. Check backend logs for parsing errors

### Issue: "Column headers don't match Excel"

**Solution:**
1. Verify Excel has proper headers in first row
2. Check that headers are non-empty strings
3. Backend automatically strips whitespace from headers
4. If headers have special characters, they should display as-is

## Performance Considerations

- Templates are loaded on Dashboard mount
- Data is cached by Redux Toolkit Query (24-hour default)
- Large Excel files (1000+ rows) will show pagination
- Consider adding data export feature if needed

## Future Enhancements

1. **Caching**: Add file modification time check to refresh templates
2. **Real-time updates**: Refresh templates when Excel files are uploaded
3. **Export**: Allow users to export template data to CSV/Excel
4. **Filters**: Add filtering capability within tabs
5. **Merge**: Show templates merged with actual assessment data

## Rollback Instructions

If you need to revert these changes:

```bash
# Backend rollback
git checkout backend/app/api/v1/reports.py
git checkout backend/app/schemas/assessment.py
git rm backend/app/services/templates.py

# Frontend rollback
git checkout frontend/src/store/api/apiSlice.ts
git checkout frontend/src/pages/DashboardPage.tsx
git rm frontend/src/components/TemplatesDisplay.tsx
```

## Verification Checklist

- [ ] Backend server starts without errors
- [ ] Frontend server starts without errors
- [ ] Can navigate to Dashboard
- [ ] Can see "Загруженные Шаблоны и Данные" section
- [ ] Can click through all 4 tabs
- [ ] Tables display data from Excel files
- [ ] Pagination works correctly
- [ ] No console errors in browser
- [ ] No errors in backend logs
- [ ] Responsive design works on mobile

## Support

For issues or questions:
1. Check browser console (F12 → Console tab)
2. Check backend logs
3. Verify all files are in correct locations
4. Run `npm run dev` and `python -m uvicorn` commands exactly as shown above
