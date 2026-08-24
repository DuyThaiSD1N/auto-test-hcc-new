import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { PoolItem, Procedure } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import AppLayout from '../components/AppLayout'
import { groupByFolder, readDropped } from '../upload/dropFolders'

const FALLBACK_SUFFIXES = ['.pdf', '.jpg', '.jpeg', '.png', '.docx']

/** Bỏ dấu để gõ "trich luc" cũng tìm ra "Trích lục" */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

/** Một hồ sơ đang soạn, chưa gửi lên kho */
interface Draft {
  uid: string
  clientDossierId: string
  note: string
  files: File[]
}

/**
 * Kho tài liệu — màn hình của tài khoản chuyên tải hồ sơ.
 *
 * Việc ở đây tách hẳn khỏi việc chạy thử: người tải chỉ lo bỏ hồ sơ vào kho và
 * phân loại đúng thủ tục; người chạy test vào trang thủ tục chọn "Lấy từ kho".
 */
export default function PoolPage() {
  const { user } = useAuth()
  const canEdit = user?.role === 'uploader' || user?.role === 'admin'

  const [procList, setProcList] = useState<Procedure[]>([])
  const [procedure, setProcedure] = useState('')
  const [filter, setFilter] = useState('')
  const [items, setItems] = useState<PoolItem[]>([])
  const [enabled, setEnabled] = useState(true)
  const [accepted, setAccepted] = useState<string[]>(FALLBACK_SUFFIXES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const [drafts, setDrafts] = useState<Draft[]>([])
  // Ô tìm thủ tục: 31 thủ tục nên phải gõ mới tìm nhanh được
  const [procQuery, setProcQuery] = useState('')
  const [procOpen, setProcOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const counter = useRef(1)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .poolItems(filter || undefined)
      .then((res) => {
        setItems(res.items)
        setEnabled(res.enabled)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không tải được kho'))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(load, [load])

  useEffect(() => {
    api.procedures().then((r) => setProcList(r.items)).catch(() => setProcList([]))
    api
      .poolStatus()
      .then((s) => s.acceptedSuffixes?.length && setAccepted(s.acceptedSuffixes))
      .catch(() => undefined)
  }, [])

  const procLabel = useCallback(
    (keyName: string) => procList.find((p) => p.key === keyName)?.label ?? keyName,
    [procList],
  )

  // Lọc theo tên/mã, bỏ dấu; chưa gõ gì thì hiện 8 thủ tục đầu cho đỡ rợp mắt
  const procMatches = useMemo(() => {
    const q = fold(procQuery.trim())
    if (!q) return procList.slice(0, 8)
    return procList.filter((p) => fold(`${p.label} ${p.code ?? ''}`).includes(q)).slice(0, 30)
  }, [procList, procQuery])

  const byProcedure = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((it) => map.set(it.procedure, (map.get(it.procedure) ?? 0) + 1))
    return map
  }, [items])

  // ------------------------------------------------------------- soạn hồ sơ

  function addFiles(list: FileList | null, splitEach: boolean) {
    if (!list?.length) return
    const picked = Array.from(list)
    const rejected = picked.filter(
      (f) => !accepted.some((ext) => f.name.toLowerCase().endsWith(ext)),
    )
    if (rejected.length) {
      setError(`Bỏ qua ${rejected.length} file không nhận được (chấp nhận ${accepted.join(', ')}).`)
    }
    const usable = picked.filter((f) => !rejected.includes(f))
    if (!usable.length) return

    const groups = splitEach ? usable.map((f) => [f]) : [usable]
    const created = groups.map((files) => {
      const index = counter.current++
      // Tên hồ sơ mặc định lấy theo tên file đầu tiên cho dễ nhận ra
      const base = files[0].name.replace(/\.[^.]+$/, '').slice(0, 60)
      return { uid: `d${index}`, clientDossierId: base || `ho-so-${index}`, note: '', files }
    })
    setDrafts((prev) => [...prev, ...created])
  }

  /**
   * Mỗi thư mục con = một hồ sơ. Dùng chung cho nút "chọn thư mục"
   * (webkitRelativePath) và kéo-thả nhiều thư mục.
   */
  function addNamedFiles(pairs: { file: File; path: string }[]) {
    const usable = pairs.filter(({ file }) =>
      accepted.some((ext) => file.name.toLowerCase().endsWith(ext)),
    )
    const skipped = pairs.length - usable.length
    if (skipped > 0) {
      setError(`Bỏ qua ${skipped} file không nhận được (chấp nhận ${accepted.join(', ')}).`)
    }
    if (!usable.length) return

    const created: Draft[] = []
    for (const [folder, files] of groupByFolder(usable)) {
      const index = counter.current++
      // File kéo lẻ (không nằm trong thư mục nào) gom thành một hồ sơ chung
      const name = folder
        ? folder.replace(/[^\w.-]+/g, '-').slice(0, 60)
        : files[0].name.replace(/\.[^.]+$/, '').slice(0, 60) || `ho-so-${index}`
      created.push({ uid: `d${index}`, clientDossierId: name, note: '', files })
    }
    setDrafts((prev) => [...prev, ...created])
  }

  function addFolders(list: FileList | null) {
    if (!list?.length) return
    addNamedFiles(
      Array.from(list).map((file) => ({
        file,
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      })),
    )
  }

  /** Kéo-thả nhiều thư mục cùng lúc, đọc đệ quy cả thư mục con */
  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    setError(null)
    try {
      const pairs = await readDropped(e.dataTransfer)
      if (pairs.length) addNamedFiles(pairs)
    } catch {
      setError('Không đọc được thư mục kéo vào. Thử lại hoặc dùng nút chọn thư mục.')
    }
  }

  function patch(uid: string, change: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.uid === uid ? { ...d, ...change } : d)))
  }

  async function submit() {
    if (!procedure) {
      setError('Chọn thủ tục cho lô hồ sơ này trước đã.')
      return
    }
    setSending(true)
    setError(null)
    setNotice(null)
    let ok = 0
    const failed: string[] = []
    for (const d of drafts) {
      try {
        await api.addToPool(procedure, d.clientDossierId.trim(), d.files, d.note)
        ok += 1
      } catch (err) {
        failed.push(`${d.clientDossierId}: ${err instanceof Error ? err.message : 'lỗi'}`)
      }
    }
    setSending(false)
    setDrafts([])
    setNotice(`Đã đưa ${ok} hồ sơ vào kho cho thủ tục “${procLabel(procedure)}”.`)
    if (failed.length) setError(`Không đưa được ${failed.length} hồ sơ — ${failed.join('; ')}`)
    load()
  }

  async function remove(item: PoolItem) {
    setError(null)
    try {
      await api.deletePoolItem(item.poolId)
      setNotice(`Đã xóa “${item.clientDossierId}” khỏi kho.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được hồ sơ')
    }
  }

  const totalDraftFiles = drafts.reduce((sum, d) => sum + d.files.length, 0)

  return (
    <AppLayout
      title="Kho tài liệu"
      subtitle="Tải hồ sơ lên và phân loại theo thủ tục để bên chạy thử lấy ra dùng"
      actions={
        <>
          <label className="filter-inline">
            <span>Lọc thủ tục:</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
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
          Chưa bật MongoDB (<code>APP_MONGO_URI</code>) nên chưa có kho tài liệu.
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
      {notice && <div className="alert ok">{notice}</div>}

      {canEdit && (
        <section className="panel">
          <div className="panel-head">
            <h2>Thêm hồ sơ vào kho</h2>
            <span className="counter">
              {drafts.length} hồ sơ · {totalDraftFiles} file đang soạn
            </span>
          </div>

          <div className="field">
            <span>Thủ tục của lô hồ sơ này</span>
            {procedure && !procOpen ? (
              <div className="proc-chosen">
                <strong>{procLabel(procedure)}</strong>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setProcOpen(true)
                    setProcQuery('')
                  }}
                >
                  Đổi thủ tục
                </button>
              </div>
            ) : (
              <div className="proc-search">
                <input
                  type="search"
                  autoFocus={procOpen}
                  value={procQuery}
                  placeholder="Gõ tên hoặc mã thủ tục để tìm (không dấu cũng được)…"
                  onChange={(e) => setProcQuery(e.target.value)}
                />
                <div className="proc-results">
                  {procMatches.length === 0 ? (
                    <div className="muted-small" style={{ padding: '8px 12px' }}>
                      Không có thủ tục nào khớp “{procQuery}”.
                    </div>
                  ) : (
                    procMatches.map((p) => (
                      <button
                        key={p.key}
                        className={`proc-option${p.key === procedure ? ' active' : ''}`}
                        onClick={() => {
                          setProcedure(p.key)
                          setProcOpen(false)
                          setProcQuery('')
                        }}
                      >
                        <span>{p.label}</span>
                        {p.code && <span className="code-badge">{p.code}</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="upload-actions">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={accepted.join(',')}
              hidden
              onChange={(e) => {
                addFiles(e.target.files, false)
                e.target.value = ''
              }}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              // @ts-expect-error webkitdirectory không có trong kiểu chuẩn nhưng trình duyệt hỗ trợ
              webkitdirectory=""
              directory=""
              onChange={(e) => {
                addFolders(e.target.files)
                e.target.value = ''
              }}
            />
            <button className="primary-btn inline" onClick={() => fileInput.current?.click()}>
              + Thêm 1 hồ sơ (chọn nhiều file)
            </button>
            <button className="ghost-btn" onClick={() => folderInput.current?.click()}>
              + Thêm thư mục (mỗi thư mục con = 1 hồ sơ)
            </button>
            <div
              className={`drop-zone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              Kéo-thả <strong>nhiều thư mục</strong> vào đây — mỗi thư mục là một hồ sơ.
            </div>
          </div>

          {drafts.length > 0 && (
            <>
              <div className="table-scroll">
                <table className="dossier-table">
                  <thead>
                    <tr>
                      <th>Mã hồ sơ</th>
                      <th>File</th>
                      <th>Ghi chú</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => (
                      <tr key={d.uid}>
                        <td>
                          <input
                            className="inline-input"
                            value={d.clientDossierId}
                            onChange={(e) => patch(d.uid, { clientDossierId: e.target.value })}
                          />
                        </td>
                        <td>
                          <div className="file-names">{d.files.map((f) => f.name).join(', ')}</div>
                          <span className="muted-small">
                            {d.files.length} file ·{' '}
                            {formatSize(d.files.reduce((s, f) => s + f.size, 0))}
                          </span>
                        </td>
                        <td>
                          <input
                            className="inline-input"
                            placeholder="vd: giấy tờ mờ, viết tay…"
                            value={d.note}
                            onChange={(e) => patch(d.uid, { note: e.target.value })}
                          />
                        </td>
                        <td className="row-actions">
                          <button
                            className="ghost-btn"
                            onClick={() => setDrafts((prev) => prev.filter((x) => x.uid !== d.uid))}
                          >
                            Bỏ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="run-actions" style={{ marginTop: 14 }}>
                <button
                  className="primary-btn inline"
                  onClick={submit}
                  disabled={sending || !procedure || !enabled}
                >
                  {sending ? 'Đang tải lên…' : `Đưa ${drafts.length} hồ sơ vào kho`}
                </button>
                <button className="ghost-btn" onClick={() => setDrafts([])} disabled={sending}>
                  Xóa hết bản soạn
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Hồ sơ đang có trong kho</h2>
          <span className="counter">{loading ? 'Đang tải…' : `${items.length} hồ sơ`}</span>
        </div>

        {!loading && items.length === 0 ? (
          <div className="empty">
            Kho chưa có hồ sơ nào{filter ? ` cho thủ tục “${procLabel(filter)}”` : ''}.
          </div>
        ) : (
          <>
            {!filter && byProcedure.size > 0 && (
              <p className="muted-small" style={{ marginBottom: 10 }}>
                {[...byProcedure].map(([k, n]) => `${procLabel(k)}: ${n}`).join(' · ')}
              </p>
            )}
            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>Thủ tục</th>
                    <th>File</th>
                    <th>Người tải</th>
                    <th>Đã dùng</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.poolId}>
                      <td>
                        <div>{it.clientDossierId}</div>
                        {it.note && <span className="muted-small">{it.note}</span>}
                      </td>
                      <td>{procLabel(it.procedure)}</td>
                      <td>
                        <div className="file-names">{it.files.map((f) => f.name).join(', ')}</div>
                        <span className="muted-small">
                          {it.fileCount} file · {formatSize(it.totalBytes)}
                        </span>
                      </td>
                      <td>
                        <div>{it.uploadedBy}</div>
                        <span className="muted-small">{formatTime(it.uploadedAt)}</span>
                      </td>
                      <td>
                        {it.useCount > 0 ? (
                          <>
                            <span className="status-pill s-done">{it.useCount} lần</span>
                            <div className="muted-small">{formatTime(it.lastUsedAt)}</div>
                          </>
                        ) : (
                          <span className="status-pill s-pending">chưa dùng</span>
                        )}
                      </td>
                      <td className="row-actions">
                        {canEdit && (
                          <button className="ghost-btn danger" onClick={() => remove(it)}>
                            Xóa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </AppLayout>
  )
}
