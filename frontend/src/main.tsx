import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import ruRU from 'antd/locale/ru_RU'

const App = () => (
  <ConfigProvider locale={ruRU}>
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h1>🏦 АСОК ИС</h1>
      <p>Автоматизированная Система Оценки Качества ИС</p>
      <p style={{ color: '#52c41a', fontSize: 18 }}>
        ✅ Система успешно запущена!
      </p>
      <p style={{ marginTop: 20 }}>
        Backend API: <a href="http://localhost:8000/docs" target="_blank">http://localhost:8000/docs</a>
      </p>
    </div>
  </ConfigProvider>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)