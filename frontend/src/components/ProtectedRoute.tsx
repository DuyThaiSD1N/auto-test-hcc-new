import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { homePath } from '../auth/home'

export default function ProtectedRoute({
  children,
  adminOnly = false,
  roles,
}: {
  children: ReactNode
  adminOnly?: boolean
  /** Vai trò được vào trang này; để trống = ai đăng nhập cũng vào được */
  roles?: string[]
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="page-loading">Đang kiểm tra phiên đăng nhập…</div>
  if (!user) return <Navigate to="/dang-nhap" replace state={{ from: location.pathname }} />
  // Vào thẳng URL không thuộc phần việc của mình thì đưa về trang chủ của vai trò đó
  if (adminOnly && user.role !== 'admin') return <Navigate to={homePath(user)} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homePath(user)} replace />
  return <>{children}</>
}
