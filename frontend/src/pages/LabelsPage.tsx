import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { LabelListItem, Procedure } from '../api/types'
import { useAuth } from '../auth/AuthContext'

function formatTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('vi-VN')
}

export default function LabelsPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [items, setItems] = useState<LabelListItem[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.procedure(key).then(setProcedure).catch(() => setProcedure(null))
  }, [key])

  const load = useCallback(() => {
    setLoading(true)
    api
      .labelsByProcedure(key)
      .then((res) => {
        setItems(res.items)
        setEnabled(res.enabled)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không tải được danh sách nhãn'))
      .finally(() => setLoading(false))
  }, [key])

  useEffect(load, [load])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand compact">
          <div className="brand-mark">AT</div>
          <div>
            <strong>Nhãn đã gán — {procedure?.label ?? key}</strong>
            <span>Các hồ sơ đã có nhãn kết quả đúng của thủ tục này</span>
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

      <main className="content single">
        <div className="eform-bar" style={{ padding: 0, border: 'none', background: 'none' }}>
          <Link to="/thu-tuc" className="back-link">
            ← Chọn thủ tục khác
          </Link>
          <button className="ghost-btn" onClick={load}>
            Tải lại
          </button>
        </div>

        {!enabled && (
          <div className="alert warn">
            Chưa bật MongoDB (<code>APP_MONGO_URI</code>) nên không có nhãn để hiển thị.
          </div>
        )}
        {error && <div className="alert error">{error}</div>}

        <section className="panel">
          <div className="panel-head">
            <h2>Hồ sơ đã gán nhãn</h2>
            <span className="counter">{loading ? 'Đang tải…' : `${items.length} nhãn`}</span>
          </div>

          {!loading && items.length === 0 ? (
            <div className="empty">Thủ tục này chưa có nhãn nào. Gán nhãn từ màn hình xem hồ sơ.</div>
          ) : (
            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>Số trường</th>
                    <th>Người gán</th>
                    <th>Thời điểm</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.itemId}>
                      <td>{it.clientDossierId || it.itemId}</td>
                      <td>{it.fieldCount}</td>
                      <td>{it.labeledBy ?? '—'}</td>
                      <td className="muted-small">{formatTime(it.labeledAt)}</td>
                      <td className="row-actions">
                        <button
                          className="ghost-btn"
                          onClick={() => navigate(`/thu-tuc/${key}/eform?item=${it.itemId}`)}
                        >
                          Xem form + JSON
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
