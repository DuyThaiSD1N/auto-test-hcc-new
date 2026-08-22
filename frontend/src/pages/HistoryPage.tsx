import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { HistoryJob, HistoryJobDetail } from '../api/types'
import { eformUrl } from '../eform/registry'
import { useAuth } from '../auth/AuthContext'

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

const PROVIDER_LABEL: Record<string, string> = {
  internal: 'BE nội bộ',
  batch: 'API theo lô',
}

export default function HistoryPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openJob, setOpenJob] = useState<HistoryJobDetail | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .historyJobs()
      .then((res) => {
        setJobs(res.items)
        setEnabled(res.enabled)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không tải được lịch sử'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  async function toggle(jobId: string) {
    if (openJob?.jobId === jobId) {
      setOpenJob(null)
      return
    }
    try {
      setOpenJob(await api.historyJob(jobId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được chi tiết phiên')
    }
  }

  async function remove(jobId: string) {
    try {
      await api.deleteHistoryJob(jobId)
      if (openJob?.jobId === jobId) setOpenJob(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được phiên')
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand compact">
          <div className="brand-mark">AT</div>
          <div>
            <strong>Lịch sử phiên quét</strong>
            <span>Kết quả bóc tách đã lưu trong cơ sở dữ liệu</span>
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
            ← Danh sách thủ tục
          </Link>
          <button className="ghost-btn" onClick={load}>
            Tải lại
          </button>
        </div>

        {!enabled && (
          <div className="alert warn">
            Chưa bật MongoDB (<code>APP_MONGO_URI</code>) nên không có lịch sử. Các phiên vẫn chạy
            bình thường, chỉ không lưu lại được.
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        <section className="panel">
          <div className="panel-head">
            <h2>Phiên đã lưu</h2>
            <span className="counter">{loading ? 'Đang tải…' : `${jobs.length} phiên`}</span>
          </div>

          {!loading && jobs.length === 0 ? (
            <div className="empty">Chưa có phiên nào được lưu.</div>
          ) : (
            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Tên phiên</th>
                    <th>Thủ tục</th>
                    <th>Nguồn</th>
                    <th>Kết quả</th>
                    <th>Lưu lúc</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.jobId} className={openJob?.jobId === job.jobId ? 'row-open' : ''}>
                      <td>
                        <div>{job.name || job.jobId}</div>
                        <span className="muted-small">{job.jobId}</span>
                      </td>
                      <td>{job.procedure}</td>
                      <td>{PROVIDER_LABEL[job.provider] ?? job.provider}</td>
                      <td>
                        <span className={`status-pill s-${job.status}`}>{job.status}</span>
                        <div className="muted-small">
                          {job.counts?.done ?? 0} xong
                          {job.counts?.failed ? ` · ${job.counts.failed} lỗi` : ''} /{' '}
                          {job.counts?.total ?? 0}
                        </div>
                      </td>
                      <td className="muted-small">{formatTime(job.savedAt)}</td>
                      <td className="row-actions">
                        <button className="ghost-btn" onClick={() => toggle(job.jobId)}>
                          {openJob?.jobId === job.jobId ? 'Ẩn' : 'Xem hồ sơ'}
                        </button>
                        <button className="ghost-btn" onClick={() => remove(job.jobId)}>
                          Xóa
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {openJob && (
          <section className="panel">
            <div className="panel-head">
              <h2>Hồ sơ trong “{openJob.name || openJob.jobId}”</h2>
              <span className="counter">{openJob.items.length} hồ sơ</span>
            </div>
            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>File</th>
                    <th>Trạng thái</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {openJob.items.map((item) => (
                    <tr key={item.itemId}>
                      <td>{item.clientDossierId}</td>
                      <td>
                        <div className="file-names">
                          {(item.files ?? []).map((f) => f.name).join(', ') || '—'}
                        </div>
                        <span className="muted-small">{item.fileCount ?? 0} file</span>
                      </td>
                      <td>
                        <span className={`status-pill s-${item.status}`}>{item.status}</span>
                        {item.error && <div className="muted-small error-text">{item.error}</div>}
                      </td>
                      <td className="row-actions">
                        {item.hasResult && item.procedure && eformUrl(item.procedure) && (
                          <button
                            className="ghost-btn"
                            onClick={() =>
                              navigate(`/thu-tuc/${item.procedure}/eform?item=${item.itemId}`)
                            }
                          >
                            Mở eForm
                          </button>
                        )}
                        {!item.hasResult && <span className="muted-small">Chưa có kết quả</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
