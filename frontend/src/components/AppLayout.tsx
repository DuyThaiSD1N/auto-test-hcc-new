import { Link, NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { homePath } from '../auth/home'
import Logo from './Logo'

/**
 * Khung chung của mọi trang sau khi đăng nhập: thanh điều hướng bên trái +
 * thanh tiêu đề dính ở trên. Trang chỉ cần lo phần nội dung của mình.
 *
 * `fullBleed` cho trang eForm - nó tự chia đôi màn hình nên không cần lề.
 */
export default function AppLayout({
  title,
  subtitle,
  actions,
  children,
  fullBleed = false,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  fullBleed?: boolean
}) {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isUploader = user?.role === 'uploader'

  const initials = (user?.full_name || user?.username || '?')
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <div className="shell">
      <aside className="sidebar">
        {/* Logo góc trái = lối về trang chủ (danh sách thủ tục), thay cho nút
            "Chọn thủ tục khác" trước đây nằm rải rác trong từng trang */}
        <Link to={homePath(user)} className="sidebar-brand" title="Về trang chủ">
          <div className="brand-mark">
            <Logo />
          </div>
          <div>
            <strong>Auto Test</strong>
            <span>Hành chính công</span>
          </div>
        </Link>

        <nav className="sidebar-nav">
          {/* Tài khoản chuyên tải tài liệu chỉ có một việc: bỏ hồ sơ vào kho */}
          {!isUploader && (
            <>
              <div className="sidebar-section">Thử nghiệm</div>
              <NavItem to="/thu-tuc" label="Thủ tục" icon={<IconList />} />
              <NavItem to="/lich-su" label="Lịch sử" icon={<IconHistory />} />
            </>
          )}
          <div className="sidebar-section">Tài liệu</div>
          <NavItem to="/kho-tai-lieu" label="Kho tài liệu" icon={<IconFolder />} />
          {isAdmin && (
            <>
              <div className="sidebar-section">Quản trị</div>
              <NavItem to="/tai-khoan" label="Tài khoản" icon={<IconUsers />} />
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="avatar">{initials}</div>
          <div className="who">
            <strong>{user?.full_name}</strong>
            <span>
              @{user?.username} ·{' '}
              {isAdmin ? 'Quản trị' : isUploader ? 'Tải tài liệu' : 'Người dùng'}
            </span>
          </div>
          <button className="icon-btn" onClick={logout} title="Đăng xuất">
            <IconLogout />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="topbar-actions">{actions}</div>}
        </header>
        <div className={fullBleed ? 'page full' : 'page'}>{children}</div>
      </div>
    </div>
  )
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} end={false}>
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

/* Biểu tượng vẽ thẳng bằng SVG - không kéo thêm thư viện icon nào. */

function IconList() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 19v-1a4 4 0 0 0-3-3.9M16.5 4.2a3.2 3.2 0 0 1 0 5.9" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}
