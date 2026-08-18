import './style.css';
import { startApp } from '@/render/app';

const mount = document.getElementById('app');
if (!mount) {
  throw new Error('Chybí #app v index.html.');
}

await startApp(mount);
