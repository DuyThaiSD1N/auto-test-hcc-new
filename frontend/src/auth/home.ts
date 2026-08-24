import type { User } from '../api/types'

/**
 * Trang chủ theo vai trò: tài khoản chuyên tải tài liệu chỉ làm việc ở kho,
 * đưa họ thẳng vào đó thay vì danh sách thủ tục.
 */
export function homePath(user: Pick<User, 'role'> | null | undefined): string {
  return user?.role === 'uploader' ? '/kho-tai-lieu' : '/thu-tuc'
}
