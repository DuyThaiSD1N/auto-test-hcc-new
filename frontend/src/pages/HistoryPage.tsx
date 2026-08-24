import { Fragment, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { displayFieldValue } from '../api/fieldValue'
import type {
  BatchField,
  HistoryItem,
  HistoryJob,
  HistoryJobDetail,
  Procedure,
} from '../api/types'
import { eformUrl } from '../eform/registry'
import AppLayout from '../components/AppLayout'

/** Dữ liệu đã điền của một hồ sơ: nhãn đã sửa tay nếu có, không thì JSON bóc tách */
interface FilledData {
  fields: BatchField[]
  source: 'nhan' | 'boc-tach'
  note: string
}

const PROVIDER_LABEL: Record<string, string> = {
  internal: 'BE nội bộ',
  batch: 'API theo lô',
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

function shortTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('vi-VN')
}

/** Khoảng thời gian giữa hai mốc, dạng người đọc được ("12,4 giây", "2 phút 5 giây") */
function duration(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} giây`
  const phut = Math.floor(ms / 60_000)
  return `${phut} phút ${Math.round((ms % 60_000) / 1000)} giây`
}

export default function HistoryPage() {
  const navigate = useNavigate()

  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openJob, setOpenJob] = useState<HistoryJobDetail | null>(null)
  const [procFilter, setProcFilter] = useState('')
  // Tìm theo mã test / tên phiên / jobId
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [procList, setProcList] = useState<Procedure[]>([])

  const [openItem, setOpenItem] = useState<string | null>(null)
  const [filled, setFilled] = useState<Record<string, FilledData | 'dang-tai'>>({})

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(() => {
    setLoading(true)
    api
      .historyJobs(200, procFilter, debounced)
      .then((res) => {
        setJobs(res.items)
        setEnabled(res.enabled)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không tải được lịch sử'))
      .finally(() => setLoading(false))
  }, [procFilter, debounced])

  useEffect(load, [load])

  // Danh sách thủ tục để lọc (kèm nhãn dễ đọc)
  useEffect(() => {
    api.procedures().then((r) => setProcList(r.items)).catch(() => setProcList([]))
  }, [])

  const procLabel = (key: string | null) =>
    procList.find((p) => p.key === key)?.label ?? key ?? '—'

  async function toggle(jobId: string) {
    if (openJob?.jobId === jobId) {
      setOpenJob(null)
      return
    }
    setOpenItem(null)
    try {
      setOpenJob(await api.historyJob(jobId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được chi tiết phiên')
    }
  }

  /**
   * Xem lại "đã điền những gì" ngay tại chỗ. Ưu tiên nhãn đã sửa tay — đó mới là
   * dữ liệu cuối cùng điền vào form (EformPage cũng nạp theo đúng thứ tự này).
   */
  async function toggleItem(item: HistoryItem) {
    if (openItem === item.itemId) {
      setOpenItem(null)
      return
    }
    setOpenItem(item.itemId)
    const cached = filled[item.itemId]
    if (!item.hasResult || (cached && cached !== 'dang-tai')) return

    setFilled((prev) => ({ ...prev, [item.itemId]: 'dang-tai' }))
    try {
      if (item.labelStatus) {
        const label = await api.getLabel(item.itemId)
        setFilled((prev) => ({
          ...prev,
          [item.itemId]: {
            fields: label.fields,
            source: 'nhan',
            note: `sửa bởi ${label.labeledBy ?? '?'} lúc ${formatTime(label.labeledAt)}`,
          },
        }))
        return
      }
      const res = await api.historyResult(item.itemId)
      setFilled((prev) => ({
        ...prev,
        [item.itemId]: {
          fields: res.result?.fields ?? [],
          source: 'boc-tach',
          note: `lưu lúc ${formatTime(res.savedAt)}`,
        },
      }))
    } catch (err) {
      setFilled((prev) => {
        const next = { ...prev }
        delete next[item.itemId]
        return next
      })
      setError(err instanceof Error ? err.message : 'Không đọc được dữ liệu đã điền')
    }
  }

  // Lịch sử phiên là dữ liệu chỉ-đọc: không có nút xóa ở đây nữa.
  // Muốn dọn hồ sơ chưa gán nhãn thì làm ở worklist gán nhãn của thủ tục.

  return (
    <AppLayout
      title="Lịch sử phiên quét"
      subtitle="Đã điền những gì, chạy ra sao, hồ sơ nào lỗi"
      actions={
        <>
          <input
            type="search"
            className="search-inline"
            placeholder="Tìm mã test, tên phiên…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="filter-inline">
            <span>Thủ tục:</span>
            <select value={procFilter} onChange={(e) => setProcFilter(e.target.value)}>
              <option value="">Tất cả</option>
              {procList.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-btn" onClick={load}>
            Tải lại
          </button>
        </>
      }
    >
        {!enabled && (
          <div className="alert warn">
            Chưa bật MongoDB (<code>APP_MONGO_URI</code>) nên không có lịch sử. Các phiên vẫn chạy
            bình thường, chỉ không lưu lại được.
          </div>
        )}

        {error && (
          <div className="alert error dismissible">
            <span>{error}</span>
            <button className="ghost-btn" onClick={() => setError(null)}>
              Đóng
            </button>
          </div>
        )}

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
                    <th>Mã test</th>
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
                        <span className="muted-small mono">{job.jobId}</span>
                      </td>
                      <td>
                        {job.testCode ? (
                          <span className="mono">{job.testCode}</span>
                        ) : (
                          <span className="muted-small">—</span>
                        )}
                      </td>
                      <td>{procLabel(job.procedure)}</td>
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
                          {openJob?.jobId === job.jobId ? 'Ẩn' : 'Xem chi tiết'}
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
          <>
            <section className="panel">
              <div className="panel-head">
                <h2>Tiến trình “{openJob.name || openJob.jobId}”</h2>
                <span className="counter">{openJob.items.length} hồ sơ</span>
              </div>

              <div className="fact-grid">
                <div>
                  <dt>Trạng thái</dt>
                  <dd>
                    <span className={`status-pill s-${openJob.status}`}>{openJob.status}</span>
                  </dd>
                </div>
                <div>
                  <dt>Kết quả</dt>
                  <dd>
                    {openJob.counts?.done ?? 0} xong · {openJob.counts?.failed ?? 0} lỗi /{' '}
                    {openJob.counts?.total ?? 0} hồ sơ
                  </dd>
                </div>
                <div>
                  <dt>Mã test</dt>
                  <dd className="mono">{openJob.testCode || '—'}</dd>
                </div>
                <div>
                  <dt>Nguồn bóc tách</dt>
                  <dd>{PROVIDER_LABEL[openJob.provider] ?? openJob.provider}</dd>
                </div>
                <div>
                  <dt>Tạo lúc</dt>
                  <dd>{formatTime(openJob.createdAt)}</dd>
                </div>
                <div>
                  <dt>Bắt đầu chạy</dt>
                  <dd>{formatTime(openJob.startedAt)}</dd>
                </div>
                <div>
                  <dt>Kết thúc</dt>
                  <dd>
                    {formatTime(openJob.finishedAt)}
                    {duration(openJob.startedAt, openJob.finishedAt) && (
                      <span className="muted-small">
                        {' '}
                        (chạy {duration(openJob.startedAt, openJob.finishedAt)})
                      </span>
                    )}
                  </dd>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Hồ sơ trong phiên</h2>
                <span className="counter">bấm “Xem chi tiết” để coi đã điền những gì</span>
              </div>
              <div className="table-scroll">
                <table className="dossier-table">
                  <thead>
                    <tr>
                      <th>Mã hồ sơ</th>
                      <th>File</th>
                      <th>Trạng thái</th>
                      <th>Xử lý</th>
                      <th>Đã điền</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {openJob.items.map((item) => {
                      const data = filled[item.itemId]
                      const isOpen = openItem === item.itemId
                      // Hồ sơ cũ có thể thiếu procedure -> lấy của phiên quét
                      const procedure = item.procedure ?? openJob.procedure
                      const took = duration(item.startedAt, item.finishedAt)
                      return (
                        <Fragment key={item.itemId}>
                          <tr className={isOpen ? 'row-open' : ''}>
                            <td>{item.clientDossierId}</td>
                            <td>
                              <div className="file-names">
                                {(item.files ?? []).map((f) => f.name).join(', ') || '—'}
                              </div>
                              <span className="muted-small">{item.fileCount ?? 0} file</span>
                            </td>
                            <td>
                              <span className={`status-pill s-${item.status}`}>{item.status}</span>
                              {item.error && (
                                <div className="muted-small error-text">{item.error}</div>
                              )}
                            </td>
                            <td className="muted-small">
                              <div>{shortTime(item.startedAt)}</div>
                              <div>
                                {took ? `mất ${took}` : 'chưa chạy'}
                                {item.attempts ? ` · ${item.attempts} lần thử` : ''}
                              </div>
                            </td>
                            <td>
                              {item.hasResult ? (
                                <>
                                  <div>{item.resultFieldCount ?? 0} trường</div>
                                  {item.labelStatus && (
                                    <span className={`status-pill s-${item.labelStatus}`}>
                                      {item.labelStatus === 'done'
                                        ? 'nhãn hoàn thiện'
                                        : 'nhãn nháp'}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="muted-small">Chưa có kết quả</span>
                              )}
                            </td>
                            <td className="row-actions">
                              <button className="ghost-btn" onClick={() => toggleItem(item)}>
                                {isOpen ? 'Ẩn' : 'Xem chi tiết'}
                              </button>
                              {item.hasResult && procedure && (
                                <button
                                  className="ghost-btn"
                                  onClick={() =>
                                    navigate(`/thu-tuc/${procedure}/eform?item=${item.itemId}`)
                                  }
                                  title={
                                    eformUrl(procedure)
                                      ? 'Mở form đã điền + JSON bóc tách'
                                      : 'Thủ tục chưa có eForm — vẫn xem được JSON bóc tách'
                                  }
                                >
                                  Mở form + JSON
                                </button>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={6}>
                                {item.hasResult ? (
                                  !data || data === 'dang-tai' ? (
                                    <span className="muted-small">Đang tải dữ liệu…</span>
                                  ) : (
                                    <>
                                      <div className="filled-head">
                                        <strong>
                                          {data.source === 'nhan'
                                            ? 'Dữ liệu đã điền — bản sửa tay'
                                            : 'Dữ liệu đã điền — bóc tách tự động'}
                                        </strong>
                                        <span className="muted-small">
                                          {data.fields.length} trường · {data.note}
                                        </span>
                                      </div>
                                      <div className="fields-box">
                                        {data.fields.length === 0 && (
                                          <span className="muted-small">
                                            Không bóc tách được trường nào.
                                          </span>
                                        )}
                                        {data.fields.map((f, i) => (
                                          <div className="field-row" key={`${f.name}-${i}`}>
                                            <span className="field-name">{f.name}</span>
                                            <span className="field-value">
                                              {displayFieldValue(f.value)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  )
                                ) : (
                                  <span className="muted-small">
                                    Hồ sơ này không có kết quả bóc tách nào được lưu.
                                  </span>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
    </AppLayout>
  )
}
