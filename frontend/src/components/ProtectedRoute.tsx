import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function ProtectedRoute({
  children,
  adminOnly = false,
}: {
  children: ReactNode
  adminOnly?: boolean
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="page-loading">Đang kiểm tra phiên đăng nhập…</div>
  if (!user) return <Navigate to="/dang-nhap" replace state={{ from: location.pathname }} />
  // Tài khoản thường vào thẳng URL của trang quản trị thì đưa về trang chính
  if (adminOnly && user.role !== 'admin') return <Navigate to="/thu-tuc" replace />
  return <>{children}</>
}
