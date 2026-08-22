import type { BatchField } from './types'

/**
 * Giá trị field không phải lúc nào cũng là chuỗi: component `x-select-area` nhận
 * object {quocGia, tinh, xa, diaChi}. Render thẳng object ra JSX sẽ làm React ném lỗi,
 * nên mọi chỗ hiển thị đều phải đi qua hàm này.
 */
export function displayFieldValue(value: BatchField['value']): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return value.map((item) => displayFieldValue(item as BatchField['value'])).join(', ')
  }

  // Địa chỉ: ghép theo thứ tự đọc tự nhiên, bỏ phần trống
  const area = value as Record<string, unknown>
  const ordered = ['diaChi', 'xa', 'tinh', 'quocGia']
  const parts = ordered.filter((k) => area[k]).map((k) => String(area[k]))
  const rest = Object.keys(area)
    .filter((k) => !ordered.includes(k) && area[k])
    .map((k) => `${k}: ${String(area[k])}`)
  const all = [...parts, ...rest]
  return all.length ? all.join(', ') : JSON.stringify(value)
}
