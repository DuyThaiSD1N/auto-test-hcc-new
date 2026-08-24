import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout'
import { eformUrl } from '../eform/registry'
import { api, normalizeTestCode, testCodeStore } from '../api/client'
import { displayFieldValue } from '../api/fieldValue'
import type { BatchItem, BatchJob, BatchResult, ItemStatus, Procedure } from '../api/types'

type Phase = 'chuan-bi' | 'dang-tai' | 'dang-quet' | 'xong'

interface Dossier {
  uid: string
  clientDossierId: string
  files: File[]
  hasHandwriting: boolean
  itemId?: string
  status: ItemStatus | 'moi' | 'dang-tai'
  error?: string | null
}

// Dự phòng khi chưa hỏi được backend; danh sách thật lấy từ /api/batch/status
const FALLBACK_SUFFIXES = ['.pdf', '.jpg', '.jpeg', '.png', '.docx']
const MAX_FILE = 80 * 1024 * 1024
const MAX_DOSSIER = 100 * 1024 * 1024
const UPLOAD_CONCURRENCY = 3
const POLL_MS = 3000

const STATUS_LABEL: Record<string, string> = {
  moi: 'Chưa gửi',
  'dang-tai': 'Đang tải lên',
  staged: 'Đã tải lên',
  queued: 'Đang chờ',
  running: 'Đang bóc tách',
  paused: 'Tạm dừng',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
}

/** Mã test mặc định theo thời điểm mở trang: TEST-20260823-1430 */
function defaultTestCode(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `TEST-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Chạy tác vụ theo nhóm nhỏ - tài liệu API khuyên chỉ tải song song 2-5 hồ sơ. */
async function runPool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      await tasks[index]()
    }
  })
  await Promise.all(workers)
}

export default function ScanPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()

  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [batchReady, setBatchReady] = useState<boolean | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<string[]>(FALLBACK_SUFFIXES)
  const [jobName, setJobName] = useState('')
  const [testCode, setTestCode] = useState(() => testCodeStore.get() || defaultTestCode())
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [phase, setPhase] = useState<Phase>('chuan-bi')
  const [job, setJob] = useState<BatchJob | null>(null)
  const [results, setResults] = useState<Record<string, BatchResult>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasEform = Boolean(eformUrl(key))

  const counter = useRef(1)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    api
      .procedure(key)
      .then((p) => {
        setProcedure(p)
        setJobName(`${p.label} - ${new Date().toLocaleDateString('vi-VN')}`)
      })
      .catch(() => navigate('/thu-tuc', { replace: true }))

    api
      .batchStatus()
      .then((s) => {
        setBatchReady(s.configured)
        setProvider(s.provider)
        if (s.acceptedSuffixes?.length) setAccepted(s.acceptedSuffixes)
      })
      .catch(() => setBatchReady(false))
  }, [key, navigate])

  // Nhớ mã test để F5 hay mở lại trang không phải gõ lại
  useEffect(() => {
    testCodeStore.set(testCode)
  }, [testCode])

  // -------------------------------------------------------------- hồ sơ

  const addDossiers = useCallback((fileList: FileList | null, splitEach: boolean) => {
    if (!fileList?.length) return
    const picked = Array.from(fileList)

    const rejected = picked.filter(
      (f) => !accepted.some((ext) => f.name.toLowerCase().endsWith(ext)) || f.size > MAX_FILE,
    )
    if (rejected.length) {
      setError(
        `Bỏ qua ${rejected.length} file không nhận được (chấp nhận ${accepted.join(', ')}, ` +
          `mỗi file dưới 80MB): ` +
          rejected.map((f) => f.name).join(', '),
      )
    }
    const usable = picked.filter((f) => !rejected.includes(f))
    if (!usable.length) return

    const groups = splitEach ? usable.map((f) => [f]) : [usable]
    const created: Dossier[] = []

    for (const files of groups) {
      const total = files.reduce((sum, f) => sum + f.size, 0)
      if (total > MAX_DOSSIER) {
        setError(`Một hồ sơ vượt quá 100MB (${formatSize(total)}), hãy tách nhỏ ra.`)
        continue
      }
      const index = counter.current
      counter.current += 1
      created.push({
        uid: `d${index}`,
        clientDossierId: `hoso-${String(index).padStart(4, '0')}`,
        files,
        hasHandwriting: false,
        status: 'moi',
      })
    }
    setDossiers((prev) => [...prev, ...created])
  }, [accepted])

  // Mỗi thư mục (con) = một hồ sơ. Nhận danh sách {file, đường dẫn tương đối} rồi nhóm theo
  // thư mục cha trực tiếp. Dùng chung cho cả chọn thư mục (webkitRelativePath) lẫn kéo-thả.
  const addNamedFiles = useCallback(
    (pairs: { file: File; path: string }[]) => {
      const rejected = pairs.filter(
        ({ file }) =>
          !accepted.some((ext) => file.name.toLowerCase().endsWith(ext)) || file.size > MAX_FILE,
      )
      const usable = pairs.filter((p) => !rejected.includes(p))
      if (rejected.length) {
        setError(
          `Bỏ qua ${rejected.length} file không nhận được (chấp nhận ${accepted.join(', ')}, ` +
            `mỗi file dưới 80MB).`,
        )
      }
      if (!usable.length) return

      const byFolder = new Map<string, File[]>()
      for (const { file, path } of usable) {
        const parts = path.split('/')
        const folder = parts.length >= 2 ? parts[parts.length - 2] : 'khong-thu-muc'
        if (!byFolder.has(folder)) byFolder.set(folder, [])
        byFolder.get(folder)!.push(file)
      }

      const created: Dossier[] = []
      for (const [folder, files] of byFolder) {
        const total = files.reduce((sum, f) => sum + f.size, 0)
        if (total > MAX_DOSSIER) {
          setError(`Thư mục "${folder}" vượt quá 100MB (${formatSize(total)}), hãy tách nhỏ ra.`)
          continue
        }
        const index = counter.current
        counter.current += 1
        created.push({
          uid: `d${index}`,
          clientDossierId: folder.replace(/[^\w.-]+/g, '-').slice(0, 60) || `hoso-${index}`,
          files,
          hasHandwriting: false,
          status: 'moi',
        })
      }
      setDossiers((prev) => [...prev, ...created])
    },
    [accepted],
  )

  // Chọn thư mục qua nút (webkitRelativePath = "root/hoso-01/to-khai.pdf")
  const addFolders = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return
      addNamedFiles(
        Array.from(fileList).map((f) => ({
          file: f,
          path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        })),
      )
    },
    [addNamedFiles],
  )

  // Kéo-thả NHIỀU thư mục cùng lúc: đọc đệ quy từng thư mục qua File System Entry API.
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const items = Array.from(e.dataTransfer.items)
        .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
        .filter(Boolean) as FileSystemEntry[]
      if (!items.length) return

      const pairs: { file: File; path: string }[] = []
      const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
        if (entry.isFile) {
          const file = await new Promise<File>((res, rej) =>
            (entry as FileSystemFileEntry).file(res, rej),
          )
          pairs.push({ file, path: prefix + entry.name })
        } else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader()
          let batch: FileSystemEntry[]
          do {
            batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
            for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
          } while (batch.length)
        }
      }

      try {
        await Promise.all(items.map((entry) => walk(entry, '')))
        addNamedFiles(pairs)
      } catch {
        setError('Không đọc được thư mục kéo vào. Thử lại hoặc dùng nút chọn thư mục.')
      }
    },
    [addNamedFiles],
  )

  const patchDossier = useCallback(
    (uid: string, patch: Partial<Dossier>) =>
      setDossiers((prev) => prev.map((d) => (d.uid === uid ? { ...d, ...patch } : d))),
    [],
  )

  const totalFiles = useMemo(
    () => dossiers.reduce((sum, d) => sum + d.files.length, 0),
    [dossiers],
  )

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>()
    const dup = new Set<string>()
    dossiers.forEach((d) => {
      const id = d.clientDossierId.trim()
      if (seen.has(id)) dup.add(id)
      seen.add(id)
    })
    return dup
  }, [dossiers])

  // -------------------------------------------------------------- chạy quét

  async function startScan() {
    setError(null)
    if (!procedure || !dossiers.length) return
    if (duplicateIds.size) {
      setError('Mã hồ sơ phải khác nhau trong cùng một phiên quét.')
      return
    }

    setPhase('dang-tai')
    let created: BatchJob
    try {
      created = await api.createJob(jobName.trim() || procedure.label, procedure.key, testCode)
      setJob(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được phiên quét')
      setPhase('chuan-bi')
      return
    }

    const uploaded: string[] = []
    await runPool(
      dossiers.map((d) => async () => {
        patchDossier(d.uid, { status: 'dang-tai', error: null })
        try {
          const item = await api.uploadDossier(
            created.jobId,
            d.clientDossierId.trim(),
            d.files,
            d.hasHandwriting,
          )
          uploaded.push(item.itemId)
          patchDossier(d.uid, { itemId: item.itemId, status: item.status })
        } catch (err) {
          patchDossier(d.uid, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Tải lên thất bại',
          })
        }
      }),
      UPLOAD_CONCURRENCY,
    )

    if (!uploaded.length) {
      setError('Không tải được hồ sơ nào lên máy chủ bóc tách.')
      setPhase('chuan-bi')
      return
    }

    try {
      setJob(await api.startJob(created.jobId))
      setPhase('dang-quet')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không bắt đầu được phiên quét')
      setPhase('chuan-bi')
    }
  }

  const collectResults = useCallback(async (jobId: string) => {
    try {
      const list = await api.jobResults(jobId)
      setResults(Object.fromEntries(list.map((r) => [r.clientDossierId, r])))
    } catch {
      /* giữ nguyên kết quả đang có, người dùng vẫn xem được trạng thái từng hồ sơ */
    }
  }, [])

  const applyItems = useCallback((items: BatchItem[]) => {
    const byId = new Map(items.map((i) => [i.clientDossierId, i]))
    setDossiers((prev) =>
      prev.map((d) => {
        const item = byId.get(d.clientDossierId.trim())
        return item ? { ...d, status: item.status, error: item.error, itemId: item.itemId } : d
      }),
    )
  }, [])

  // Poll tiến độ; nối setTimeout để không chồng request khi mạng chậm
  const jobId = job?.jobId
  useEffect(() => {
    if (phase !== 'dang-quet' || !jobId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const [fresh, items] = await Promise.all([api.getJob(jobId), api.jobItems(jobId)])
        if (stopped) return
        setJob(fresh)
        applyItems(items)
        if (fresh.status === 'completed' || fresh.status === 'cancelled') {
          await collectResults(jobId)
          if (!stopped) setPhase('xong')
          return
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Mất kết nối khi theo dõi')
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }

    timer = setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [phase, jobId, applyItems, collectResults])

  async function retry(d: Dossier) {
    if (!d.itemId) return
    try {
      await api.retryItem(d.itemId)
      patchDossier(d.uid, { status: 'queued', error: null })
      setPhase('dang-quet')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không chạy lại được hồ sơ')
    }
  }

  async function cancel() {
    if (!job) return
    try {
      await api.cancelJob(job.jobId)
    } catch {
      /* hủy không thành thì vòng poll vẫn dừng khi job kết thúc */
    }
    setPhase('xong')
  }

  function reset() {
    setDossiers([])
    setResults({})
    setJob(null)
    setError(null)
    setPhase('chuan-bi')
    counter.current = 1
  }

  // -------------------------------------------------------------- giao diện

  const counts = job?.counts
  const finished = (counts?.done ?? 0) + (counts?.failed ?? 0)
  const percent = counts?.total ? Math.round((finished / counts.total) * 100) : 0
  const editable = phase === 'chuan-bi'

  return (
    <AppLayout
      title={procedure?.label ?? 'Đang tải…'}
      subtitle="Tải hồ sơ lên, chạy bóc tách và mở form đã điền"
    >
        {batchReady === false && (
          <div className="alert warn">
            {provider === 'internal' ? (
              <>
                Máy chủ chưa cấu hình tài khoản BE nội bộ (<code>APP_INTERNAL_USERNAME</code> /{' '}
                <code>APP_INTERNAL_PASSWORD</code>).
              </>
            ) : (
              <>
                Máy chủ chưa cấu hình <code>APP_BATCH_API_SECRET</code> nên chưa gọi được API bóc tách.
              </>
            )}{' '}
            Thêm biến môi trường rồi khởi động lại backend.
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
            <h2>1. Phiên quét</h2>
            {job && <span className="code-badge">{job.jobId}</span>}
          </div>
          <label className="field">
            <span>Tên phiên (để dễ tra lại sau này)</span>
            <input
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              disabled={!editable}
            />
          </label>
          <label className="field">
            <span>Mã test (gắn vào log để tra lỗi sau này)</span>
            <div className="input-with-action">
              <input
                type="text"
                value={testCode}
                onChange={(e) => setTestCode(normalizeTestCode(e.target.value))}
                placeholder="TEST-20260823-1430"
              />
              <button className="ghost-btn" onClick={() => setTestCode(defaultTestCode())}>
                Mã mới
              </button>
            </div>
          </label>
          <p className="muted-small">
            Mọi thao tác trong lần chạy này được gắn mã test ở trên; log backend gom theo mã đó và
            hiện trong <Link to="/lich-su">Lịch sử</Link> — xem được đã điền những gì, chạy hết bao
            lâu, lỗi ở hồ sơ nào. Mã chỉ nhận chữ, số và <code>-._</code>.
          </p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>2. Hồ sơ cần bóc tách</h2>
            <span className="counter">
              {dossiers.length} hồ sơ · {totalFiles} file
            </span>
          </div>

          {editable && (
            <div className="upload-actions">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={accepted.join(',')}
                hidden
                onChange={(e) => {
                  addDossiers(e.target.files, false)
                  e.target.value = ''
                }}
              />
              {/* webkitdirectory: chọn thư mục; mỗi thư mục con thành 1 hồ sơ */}
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
          )}

          {!dossiers.length ? (
            <div className="empty">
              Chưa có hồ sơ nào. Một hồ sơ gồm nhiều file (tờ khai, CCCD…), hoặc chọn cả thư mục —
              mỗi thư mục con thành một hồ sơ riêng.
              <div className="muted-small" style={{ marginTop: 6 }}>
                Nhận {accepted.join(', ')} — ảnh lạ và tài liệu Word cũ được tự chuyển đổi trước khi
                bóc tách.
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>File</th>
                    <th>Viết tay</th>
                    <th>Trạng thái</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dossiers.map((d) => {
                    const size = d.files.reduce((s, f) => s + f.size, 0)
                    const result = results[d.clientDossierId.trim()]
                    const isOpen = expanded === d.uid
                    return (
                      <Fragment key={d.uid}>
                        <tr className={duplicateIds.has(d.clientDossierId) ? 'row-warn' : ''}>
                          <td>
                            <input
                              className="inline-input"
                              value={d.clientDossierId}
                              disabled={!editable}
                              onChange={(e) =>
                                patchDossier(d.uid, { clientDossierId: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <div className="file-names">{d.files.map((f) => f.name).join(', ')}</div>
                            <span className="muted-small">
                              {d.files.length} file · {formatSize(size)}
                            </span>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={d.hasHandwriting}
                              disabled={!editable}
                              onChange={(e) =>
                                patchDossier(d.uid, { hasHandwriting: e.target.checked })
                              }
                            />
                          </td>
                          <td>
                            <span className={`status-pill s-${d.status}`}>
                              {STATUS_LABEL[d.status] ?? d.status}
                            </span>
                            {d.error && <div className="muted-small error-text">{d.error}</div>}
                          </td>
                          <td className="row-actions">
                            {editable && (
                              <button
                                className="ghost-btn"
                                onClick={() =>
                                  setDossiers((prev) => prev.filter((x) => x.uid !== d.uid))
                                }
                              >
                                Xóa
                              </button>
                            )}
                            {result && (
                              <button
                                className="ghost-btn"
                                onClick={() => setExpanded(isOpen ? null : d.uid)}
                              >
                                {isOpen ? 'Ẩn' : 'Xem kết quả'}
                              </button>
                            )}
                            {result && hasEform && d.itemId && (
                              <button
                                className="ghost-btn"
                                onClick={() => navigate(`/thu-tuc/${key}/eform?item=${d.itemId}`)}
                              >
                                Mở eForm
                              </button>
                            )}
                            {d.status === 'failed' && d.itemId && (
                              <button className="ghost-btn" onClick={() => retry(d)}>
                                Chạy lại
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && result?.result && (
                          <tr>
                            <td colSpan={5}>
                              <div className="fields-box">
                                {result.result.fields.length === 0 && (
                                  <span className="muted-small">
                                    Không bóc tách được trường nào.
                                  </span>
                                )}
                                {result.result.fields.map((f, i) => (
                                  <div className="field-row" key={`${f.name}-${i}`}>
                                    <span className="field-name">{f.name}</span>
                                    <span className="field-value">{displayFieldValue(f.value)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>3. Chạy bóc tách</h2>
            {job ? (
              <span className="counter">Trạng thái: {job.status}</span>
            ) : (
              provider && (
                <span className="counter">
                  Nguồn bóc tách: {provider === 'internal' ? 'BE nội bộ' : 'API theo lô'}
                </span>
              )
            )}
          </div>

          {phase !== 'chuan-bi' && counts && (
            <div className="progress-wrap">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-legend">
                <span>Tổng {counts.total}</span>
                <span>Đang chờ {counts.queued ?? 0}</span>
                <span>Đang chạy {counts.running ?? 0}</span>
                <span className="ok">Xong {counts.done ?? 0}</span>
                <span className="bad">Lỗi {counts.failed ?? 0}</span>
              </div>
            </div>
          )}

          <div className="run-actions">
            {hasEform && (
              <button className="ghost-btn" onClick={() => navigate(`/thu-tuc/${key}/eform`)}>
                Xem eForm của thủ tục
              </button>
            )}
            {phase === 'chuan-bi' && (
              <button
                className="primary-btn inline"
                onClick={startScan}
                disabled={!dossiers.length || batchReady === false}
              >
                Bắt đầu bóc tách {dossiers.length ? `(${dossiers.length} hồ sơ)` : ''}
              </button>
            )}
            {phase === 'dang-tai' && <span className="muted-small">Đang tải hồ sơ lên…</span>}
            {phase === 'dang-quet' && (
              <>
                <span className="muted-small">Đang bóc tách, tự cập nhật mỗi 3 giây…</span>
                <button className="ghost-btn" onClick={cancel}>
                  Hủy phiên
                </button>
              </>
            )}
            {phase === 'xong' && (
              <>
                <span className="muted-small">Đã xong phiên quét.</span>
                {hasEform && (
                  <button
                    className="primary-btn inline"
                    onClick={() => {
                      // Mỗi hồ sơ (thư mục) mở một tab eForm riêng để đối chiếu cách điền
                      const done = dossiers.filter(
                        (d) => d.itemId && results[d.clientDossierId.trim()],
                      )
                      if (!done.length) {
                        setError('Chưa có hồ sơ nào bóc tách xong để mở eForm.')
                        return
                      }
                      done.forEach((d) =>
                        window.open(`/thu-tuc/${key}/eform?item=${d.itemId}`, '_blank'),
                      )
                    }}
                  >
                    Mở eForm tất cả ({dossiers.filter((d) => results[d.clientDossierId.trim()]).length}{' '}
                    tab)
                  </button>
                )}
                <button className="ghost-btn" onClick={reset}>
                  Quét lô mới
                </button>
              </>
            )}
          </div>
        </section>
    </AppLayout>
  )
}
