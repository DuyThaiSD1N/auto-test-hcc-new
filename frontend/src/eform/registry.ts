/**
 * Thủ tục nào đã có biểu mẫu eForm dựng sẵn trong `frontend/public/eform/`.
 * Thêm thủ tục mới: bỏ file HTML vào thư mục đó rồi khai thêm một dòng ở đây.
 */
export const EFORMS: Record<string, string> = {
  'trich-luc-ks': '/eform/trich-luc-ks.html',
  'xac-nhan-tinh-trang-hon-nhan': '/eform/xac-nhan-tinh-trang-hon-nhan.html',
}

export function eformUrl(key: string): string | null {
  return EFORMS[key] ?? null
}
