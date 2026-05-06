import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
