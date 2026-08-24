/**
 * Cấu hình chạy-thật của giao diện — SỬA TRỰC TIẾP TRÊN MÁY CHỦ, không cần build lại.
 *
 * File này nằm trong `public/` nên Vite chép nguyên xi sang `dist/config.js`.
 * index.html nạp nó TRƯỚC mã ứng dụng, nên đổi giá trị ở đây rồi F5 là ăn ngay
 * (Docker: mount đè file này vào /srv/frontend_dist/config.js).
 */
window.__APP_CONFIG__ = {
  /**
   * Gốc của API backend.
   *
   *   ''                          → cùng origin (mặc định: FastAPI phục vụ luôn giao diện,
   *                                 và khi chạy `npm run dev` thì Vite proxy /api sang :8000)
   *   'http://192.168.1.50:8000'  → backend nằm máy khác
   *   'https://api.tenmien.vn'    → backend sau tên miền riêng
   *
   * Trỏ sang origin khác thì backend phải cho phép origin của giao diện trong
   * APP_CORS_ORIGINS, nếu không trình duyệt sẽ chặn.
   */
  apiBaseUrl: '',

  /**
   * Hết bao nhiêu mili giây thì bỏ một lời gọi API. 0 = chờ đến khi xong.
   * Để 0 là an toàn: bóc tách một hồ sơ có thể mất vài phút.
   */
  requestTimeoutMs: 0,
}
