// In the desktop app, AI requests go through the native HTTP client so every provider works (browsers block
// some providers' APIs with CORS) and local model servers can be reached. In a browser the normal fetch is used.
import { setFetch } from './providers';

let done = false;
export async function initAITransport() {
  if (done) return;
  done = true;
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const http = await import('@tauri-apps/plugin-http');
    setFetch(http.fetch as typeof fetch);
  } catch { /* keep the web view's fetch */ }
}
