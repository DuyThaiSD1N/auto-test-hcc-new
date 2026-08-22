import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="page-loading">Đang kiểm tra phiên đăng nhập…</div>
  if (!user) return <Navigate to="/dang-nhap" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
