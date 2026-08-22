import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Procedure } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export default function ProceduresPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Chong goi API lien tuc khi go phim
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .procedures(debounced)
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Không tải được danh sách thủ tục')
        setItems([])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debounced])

  const selected = useMemo(
    () => items.find((p) => p.key === selectedKey) ?? null,
    [items, selectedKey],
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand compact">
          <div className="brand-mark">AT</div>
          <div>
            <strong>Auto Test Hành chính công</strong>
            <span>Chọn thủ tục cần thử nghiệm</span>
          </div>
        </div>
        <div className="user-box">
          <div className="user-info">
            <strong>{user?.full_name}</strong>
            <span>@{user?.username}</span>
          </div>
          <button className="ghost-btn" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </header>

      <main className="content">
        <section className="list-pane">
          <div className="toolbar">
            <div className="search-box">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm thủ tục theo tên hoặc mã (gõ không dấu cũng được)…"
              />
            </div>
            <span className="counter">{loading ? 'Đang tải…' : `${items.length} thủ tục`}</span>
          </div>

          {error && <div className="alert error">{error}</div>}

          {!loading && !error && items.length === 0 && (
            <div className="empty">Không tìm thấy thủ tục nào khớp với “{query}”.</div>
          )}

          <ul className="procedure-list">
            {items.map((p) => {
              const active = p.key === selectedKey
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    className={`procedure-item${active ? ' active' : ''}`}
                    onClick={() => setSelectedKey(p.key)}
                    aria-pressed={active}
                  >
                    <span className="radio" aria-hidden="true" />
                    <span className="procedure-label">{p.label}</span>
                    {p.code && <span className="code-badge">{p.code}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <aside className="detail-pane">
          {selected ? (
            <div className="detail-card">
              <span className="detail-eyebrow">Thủ tục đã chọn</span>
              <h2>{selected.label}</h2>
              <dl className="detail-meta">
                <div>
                  <dt>Mã thủ tục</dt>
                  <dd>{selected.code ?? 'Không có'}</dd>
                </div>
                <div>
                  <dt>Chọn cơ quan</dt>
                  <dd>{selected.needsAgencySelect ? 'Có' : 'Không'}</dd>
                </div>
                <div>
                  <dt>Tự động xác nhận</dt>
                  <dd>{selected.autoConfirm ? 'Có' : 'Không'}</dd>
                </div>
              </dl>
              <a className="detail-link" href={selected.url} target="_blank" rel="noreferrer">
                Mở trang thủ tục gốc ↗
              </a>
              <button
                type="button"
                className="primary-btn"
                onClick={() => navigate(`/thu-tuc/${selected.key}`)}
              >
                Bắt đầu thử nghiệm
              </button>
              <p className="hint">Tải hồ sơ lên để hệ thống bóc tách dữ liệu tự động.</p>
            </div>
          ) : (
            <div className="detail-card placeholder">
              <h2>Chưa chọn thủ tục</h2>
              <p>Chọn một thủ tục ở danh sách bên trái để xem thông tin và bắt đầu thử nghiệm.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}
