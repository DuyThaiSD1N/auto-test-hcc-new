/**
 * Logo con robot của hệ thống — vẽ thẳng bằng SVG nên nét sắc ở mọi cỡ và
 * đổi màu theo `currentColor` (đang dùng màu trắng trên nền gradient xanh).
 */
export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Ăng-ten */}
      <circle cx="32" cy="6.5" r="4.5" fill="currentColor" stroke="none" />
      <path d="M32 11v6" strokeLinecap="round" />

      {/* Tai hai bên */}
      <rect x="3.5" y="26.5" width="9" height="15" rx="1.5" />
      <rect x="51.5" y="26.5" width="9" height="15" rx="1.5" />

      {/* Đầu */}
      <rect x="12.5" y="17.5" width="39" height="39" rx="9" />

      {/* Mắt */}
      <circle cx="24" cy="31" r="4.6" fill="currentColor" stroke="none" />
      <circle cx="40" cy="31" r="4.6" fill="currentColor" stroke="none" />

      {/* Miệng: khung hở đáy + hai vạch chia thành ba răng */}
      <path d="M19.5 44.5h25v12" />
      <path d="M19.5 44.5v12" />
      <path d="M28 45v11M36 45v11" strokeWidth="4" />
    </svg>
  )
}
