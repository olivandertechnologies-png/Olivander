import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WandProvider } from './components/OlivanderWand';
import './styles/tokens.css';
import './styles/global.css';
import './styles/dashboard.css';

const saved = localStorage.getItem('olivander_theme') || 'light';
document.documentElement.classList.toggle('dark', saved === 'dark');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WandProvider>
      <App />
    </WandProvider>
  </React.StrictMode>,
);
