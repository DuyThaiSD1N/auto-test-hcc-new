/**
 * Đọc cấu hình chạy-thật từ `public/config.js` (đã nạp vào `window.__APP_CONFIG__`).
 *
 * Vì là file tĩnh chứ không phải biến build-time, sửa xong chỉ cần F5 — không phải
 * build lại giao diện. Thiếu file hoặc thiếu khóa thì lùi về mặc định an toàn:
 * gọi API cùng origin, không đặt hạn thời gian.
 */

export interface AppConfig {
  apiBaseUrl: string
  requestTimeoutMs: number
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>
  }
}

const DEFAULTS: AppConfig = {
  apiBaseUrl: '',
  requestTimeoutMs: 0,
}

function read(): AppConfig {
  const raw = typeof window === 'undefined' ? undefined : window.__APP_CONFIG__
  const base = typeof raw?.apiBaseUrl === 'string' ? raw.apiBaseUrl.trim() : DEFAULTS.apiBaseUrl
  const timeout =
    typeof raw?.requestTimeoutMs === 'number' && raw.requestTimeoutMs >= 0
      ? raw.requestTimeoutMs
      : DEFAULTS.requestTimeoutMs
  return {
    // Bỏ dấu "/" cuối để ghép đường dẫn không thành "//api"
    apiBaseUrl: base.replace(/\/+$/, ''),
    requestTimeoutMs: timeout,
  }
}

export const appConfig: AppConfig = read()

/** Đường dẫn đầy đủ tới một endpoint, vd apiUrl('/auth/login') */
export function apiUrl(path: string): string {
  return `${appConfig.apiBaseUrl}/api${path}`
}
