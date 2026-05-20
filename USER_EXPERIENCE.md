# User Experience: Templates Display Feature

## What Users Will See

### Before (Previous State)
- Dashboard shows only:
  1. Global Health Score (Donut chart)
  2. Top problematic systems (Table)
  3. Quality matrix heatmap (ISO 25010 characteristics)
- Excel templates were not visible to users
- Pre-filled data from Excel files was not displayed

### After (New Implementation)
- Dashboard now shows everything from before, PLUS:
  4. **NEW: "Загруженные Шаблоны и Данные" (Loaded Templates and Data) Section**
     - Located below the quality matrix heatmap
     - Contains tabbed view of all template data
     - Shows current/pre-filled data from Excel files

## New Dashboard Section Details

### Section Title
"Загруженные Шаблоны и Данные" (Loaded Templates and Data)

### Content - 4 Tabs

#### Tab 1: "Шаблон Метрик" (Metrics Template)
- **Source**: `шаблон заполнения метрик.xlsx`
- **Contains**: Metrics with characteristics and subcharacteristics
- **Display**: Table with dynamic columns based on Excel headers
- **Features**: 
  - Pagination (10 rows per page)
  - Horizontal scroll for wide tables
  - All data visible from the template file

#### Tab 2: "Матрица Рисков" (Risk Matrix)
- **Source**: Risk-related templates from Excel files
- **Contains**: System risks, consequences, mitigation measures
- **Display**: Structured risk information
- **Features**:
  - Automatic column generation from Excel data
  - Page navigation for large datasets
  - Complete risk assessment data

#### Tab 3: "Детальный Отчет по Метрикам" (Quality Report)
- **Source**: `шаблон формирования детального отчета по каждой метрике.xlsx`
- **Contains**: Detailed metrics by characteristic
- **Display**: Comprehensive quality report data
- **Features**:
  - All metrics with their detailed information
  - Sortable and paginated view
  - Full data visibility

#### Tab 4: "Качество Системы по Времени" (System Quality Over Time)
- **Source**: `Качество системы в разрезе времени по всем характеристикам.xlsx`
- **Contains**: Quality metrics tracked over time
- **Display**: Time-series quality data
- **Features**:
  - Historical quality metrics
  - All characteristics and time periods
  - Complete quality timeline

## User Interactions

### Initial View
```
┌─────────────────────────────────────────────────────────────┐
│ Dashboard                                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Global Health Score]    [Top Problematic Systems]         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    Quality Matrix (Heatmap)                 │
├─────────────────────────────────────────────────────────────┤
│  ┌─ Загруженные Шаблоны и Данные ──────────────────────┐   │
│  │  [Шаблон Метрик] [Матрица Рисков] ...              │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │ Таблица с данными из Excel                   │   │   │
│  │  │ Пред.  | След.                              │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Tab Click Behavior
1. User clicks any tab (Metrics, Risks, Quality Report, System Quality)
2. Tab content loads (instant if cached, or brief loading spinner)
3. Table displays with all columns and rows from Excel file
4. User can:
   - Scroll horizontally (if table is wide)
   - Paginate through data (10 rows per page)
   - View all cells with ellipsis for long text

## Key Features from User Perspective

✅ **Easy Access** - Templates visible directly on Dashboard, no need to navigate elsewhere

✅ **Automatic Loading** - All data pre-loaded from Excel files, no manual data entry

✅ **Organized View** - Separated into 4 logical tabs for different template types

✅ **No Data Loss** - All Excel data preserved and displayed in structured tables

✅ **Current Data Display** - Pre-filled data from Excel files is immediately visible

✅ **Responsive** - Works on desktop, tablet, and mobile devices

✅ **Easy Navigation** - Simple tabbed interface, self-explanatory

## Excel Files Displayed

The system automatically loads and displays these Excel files:

1. **шаблон заполнения метрик.xlsx**
   - Metrics template for filling in characteristic and subcharacteristic values

2. **шаблон предоставления информации для тест-менеджера после анализа LLM.xlsx**
   - Information template for test manager after LLM analysis

3. **шаблон формирования детального отчета по каждой метрике.xlsx**
   - Detailed report template for each metric

4. **Качество системы в разрезе времени по всем характеристикам.xlsx**
   - System quality template showing data across time and characteristics

5. **таблица для заполнения v8.1.xlsx**
   - Additional data entry template (version 8.1)

## Benefits

### For Test Managers/QA
- Quickly see all available metrics and templates
- Understand data structure and required fields
- Reference templates while filling in assessments

### For Quality Managers/Decision Makers  
- View current quality assessment data
- See pre-populated template information
- Make informed decisions based on visible metrics

### For System Administrators
- All templates visible in one place
- Easy to audit what data is available
- Templates automatically loaded without manual configuration

## Technical Notes

- **Loading Time**: Templates load on Dashboard page render
- **Caching**: Data is cached for 24 hours (customizable)
- **Update Frequency**: Refresh page or navigate away/back to reload
- **Data Format**: Original Excel format converted to JSON for web display
- **Compatibility**: Works with any Excel format (.xlsx)

## No Breaking Changes

✅ All existing Dashboard features remain unchanged
✅ Existing assessment workflows unaffected
✅ API backward compatible
✅ Optional feature (doesn't interfere with other functionality)

## Next Steps

Users can now:
1. View available templates on Dashboard
2. Reference current/pre-filled data
3. Use template information when creating new assessments
4. See how data should be structured in the system
