import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import App from './App';
// Самостоятельно хостится (не CDN) — офлайн-режим в Docker не должен зависеть от сети.
// Только вес (wght), без italic/opsz: кириллица + латиница, вариативный 100–900 в одном файле.
import '@fontsource-variable/inter/wght.css';
import './styles/themes.css';
import './styles/a11y-overrides.css';
import './styles/ui.css';
import './styles/dashboard-grid.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);