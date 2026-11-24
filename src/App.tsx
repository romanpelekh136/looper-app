import { useEffect, useState } from 'react';
import { Keyboard, Music2, Settings, Youtube } from 'lucide-react';
import { getAppInfo, isTauriRuntime } from './lib/api';
import { formatTime } from './lib/time';
import { parseYouTubeUrl } from './lib/youtube';
import type { AppInfo } from './types';

export function App() {
  const [urlInput, setUrlInput] = useState('');
  const [urlStatus, setUrlStatus] = useState<string | null>(null);
  const [globalHotkeysEnabled, setGlobalHotkeysEnabled] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    getAppInfo()
      .then(setAppInfo)
      .catch(() => {
        // Ignore when running outside Tauri shell
      });
  }, []);

  const handleLoadUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseYouTubeUrl(urlInput);
    if (!parsed) {
      setUrlStatus('Невалідне посилання YouTube. Вставте watch?v=, youtu.be/ або shorts/.');
      return;
    }
    const startHint =
      parsed.startSec !== undefined ? ` (початок: ${formatTime(parsed.startSec)})` : '';
    setUrlStatus(
      `ID відео: ${parsed.videoId}${startHint}. Завантаження через yt-dlp буде додано на Етапі 2.`,
    );
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <Music2 size={20} className="brand-icon" />
          <span>Guitar YouTube Looper</span>
          {appInfo && <span className="version-badge">v{appInfo.version}</span>}
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`pill-button ${globalHotkeysEnabled ? 'active' : ''}`}
            onClick={() => setGlobalHotkeysEnabled((prev) => !prev)}
            title="Увімкнути або вимкнути глобальні гарячі клавіші"
          >
            <Keyboard size={16} />
            <span>Глобальні клавіші: {globalHotkeysEnabled ? 'УВІМК' : 'ВИМК'}</span>
          </button>

          <button type="button" className="icon-button" title="Налаштування (скоро)">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="library-sidebar">
          <div className="sidebar-header">
            <h2>Бібліотека</h2>
            <span className="muted-count">0 пісень</span>
          </div>
          <div className="sidebar-empty">
            <p>Тут з&apos;являться збережені пісні та їхні A–B лупи.</p>
          </div>
        </aside>

        <main className="workspace-main">
          <form className="url-bar" onSubmit={handleLoadUrl}>
            <Youtube size={18} className="url-icon" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Вставте посилання на YouTube (youtube.com/watch?v=... або youtu.be/...)"
              aria-label="YouTube URL"
            />
            <button type="submit" className="primary-button">
              Відкрити
            </button>
          </form>

          {urlStatus && <div className="status-banner">{urlStatus}</div>}

          <section className="player-stage">
            <div className="player-placeholder">
              <Music2 size={44} className="placeholder-icon" />
              <h3>Плеєр готовий до підключення</h3>
              <p>
                Каркас проєкту ініціалізовано.
                {appInfo ? ` Дані зберігаються у: ${appInfo.dataDir}` : ' Режим попереднього перегляду в браузері.'}
              </p>
            </div>
          </section>

          <section className="ab-panel">
            <div className="ab-header">
              <span>Діапазон A–B</span>
              <span className="mono-time">00:00.0 — 00:00.0</span>
            </div>
            <p className="ab-hint">
              Повзунки A–B, ручний ввід (мм:сс.д / секунди), кнопки ±0.1 с / ±0.5 с та контроль
              швидкості будуть реалізовані на наступних етапах.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
