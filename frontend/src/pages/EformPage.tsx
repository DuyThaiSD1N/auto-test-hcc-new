import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { BatchField, Procedure } from '../api/types'
import { eformUrl } from '../eform/registry'
import { fillEform } from '../eform/runFill'
import type { FillResult } from '../eform/runFill'
import { useAuth } from '../auth/AuthContext'

type View = 'eform' | 'json'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const AREA_KEYS = ['quocGia', 'tinh', 'xa', 'diaChi']
const AREA_LABEL: Record<string, string> = {
  quocGia: 'Quốc gia',
  tinh: 'Tỉnh/Thành phố',
  xa: 'Xã/Phường',
  diaChi: 'Địa chỉ chi tiết',
}

function orderedKeys(obj: Record<string, unknown>): string[] {
  const known = AREA_KEYS.filter((k) => k in obj)
  const rest = Object.keys(obj).filter((k) => !AREA_KEYS.includes(k))
  return [...known, ...rest]
}

export default function EformPage() {
  const { key = '' } = useParams()
  const [params] = useSearchParams()
  const itemId = params.get('item')
  const { user, logout } = useAuth()

  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [fields, setFields] = useState<BatchField[]>([])
  const [rawResult, setRawResult] = useState<unknown>(null)
  const [labeled, setLabeled] = useState(false)
  const [labeledInfo, setLabeledInfo] = useState<string | null>(null)
  const [view, setView] = useState<View>('eform')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [filling, setFilling] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [frameEpoch, setFrameEpoch] = useState(0)
  const [status, setStatus] = useState<'pending' | 'draft' | 'done'>('pending')
  const [autoSaveMsg, setAutoSaveMsg] = useState<string | null>(null)

  const frameRef = useRef<HTMLIFrameElement>(null)
  const lastFilled = useRef<string>('')
  const fieldsRef = useRef<BatchField[]>([])
  const loadedItem = useRef<string | null>(null)
  const eform = eformUrl(key)

  useEffect(() => {
    api.procedure(key).then(setProcedure).catch(() => setProcedure(null))
  }, [key])

  // Nạp trường: ưu tiên nhãn đã lưu; JSON bóc tách thô luôn lấy từ kết quả để đối chiếu
  useEffect(() => {
    if (!itemId) return
    let cancelled = false
    ;(async () => {
      let baseFields: BatchField[] = []
      try {
        const res = await api.itemResult(itemId)
        if (!cancelled) {
          setRawResult(res.result ?? null)
          baseFields = res.result?.fields ?? []
        }
      } catch {
        // Kết quả có thể đã bị xóa khỏi nguồn; vẫn thử lấy bản lưu trong CSDL
        try {
          const hist = await api.historyResult(itemId)
          if (!cancelled) {
            setRawResult(hist.result ?? null)
            baseFields = hist.result?.fields ?? []
          }
        } catch {
          /* không có kết quả */
        }
      }
      try {
        const saved = await api.getLabel(itemId)
        if (cancelled) return
        setFields(saved.fields)
        setStatus(saved.status ?? 'draft')
        setLabeled(true)
        setLabeledInfo(
          `Đã gán nhãn bởi ${saved.labeledBy ?? '?'} lúc ${new Date(saved.labeledAt).toLocaleString('vi-VN')}`,
        )
      } catch {
        if (!cancelled) {
          setFields(baseFields)
          setStatus('pending')
        }
      }
      if (!cancelled) loadedItem.current = itemId
    })()
    return () => {
      cancelled = true
    }
  }, [itemId])

  // Luôn giữ fieldsRef = fields mới nhất (dùng cho tự điền và tự lưu)
  useEffect(() => {
    fieldsRef.current = fields
  }, [fields])

  // Tự lưu tiến trình: sau khi sửa 1.2s không thao tác thì lưu nháp, không mất khi
  // chuyển tab hay mở lại từ lịch sử. Giữ nguyên trạng thái "done" nếu đã hoàn thiện.
  useEffect(() => {
    if (!dirty || !itemId || fields.length === 0) return
    const t = setTimeout(async () => {
      try {
        const keep = status === 'done' ? 'done' : 'draft'
        await api.saveLabel(itemId, {
          fields: fieldsRef.current,
          procedure: key,
          clientDossierId: null,
          status: keep,
        })
        setLabeled(true)
        setStatus(keep)
        setDirty(false)
        setAutoSaveMsg(`Đã lưu tiến trình lúc ${new Date().toLocaleTimeString('vi-VN')}`)
      } catch {
        /* lưu tự động thất bại thì thôi, người dùng vẫn bấm Lưu tay được */
      }
    }, 1200)
    return () => clearTimeout(t)
  }, [dirty, fields, itemId, key, status])

  // Tự điền eForm khi mở (sau khi có dữ liệu) — "form đã điền những gì"
  useEffect(() => {
    if (view !== 'eform' || !frameReady || fields.length === 0) return
    // Điền lại khi: frame vừa nạp lại (frameEpoch), hoặc dữ liệu thay đổi.
    // Nhờ vậy chuyển sang JSON rồi quay lại eForm, form không bị trống.
    const sig = `${frameEpoch}:${JSON.stringify(fields)}`
    if (lastFilled.current === sig) return
    lastFilled.current = sig
    void handleFill()
  }, [view, frameReady, frameEpoch, fields])

  // ------------------------------------------------------------ sửa trường

  const setStringValue = useCallback((index: number, value: string) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value } : f)))
    setDirty(true)
  }, [])

  const setAreaValue = useCallback((index: number, areaKey: string, value: string) => {
    setFields((prev) =>
      prev.map((f, i) =>
        i === index
          ? { ...f, value: { ...(f.value as Record<string, unknown>), [areaKey]: value } }
          : f,
      ),
    )
    setDirty(true)
  }, [])

  async function save(status: 'draft' | 'done' = 'draft') {
    if (!itemId) return
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    try {
      await api.saveLabel(itemId, { fields, procedure: key, clientDossierId: null, status })
      setLabeled(true)
      setStatus(status)
      setDirty(false)
      setAutoSaveMsg(null)
      setSaveMsg(status === 'done' ? 'Đã lưu và đánh dấu hoàn thiện.' : 'Đã lưu nháp.')
      setLabeledInfo(
        `Đã gán nhãn bởi ${user?.username ?? ''} lúc ${new Date().toLocaleString('vi-VN')}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được nhãn')
    } finally {
      setSaving(false)
    }
  }

  async function handleFill() {
    setError(null)
    setFilling(true)
    try {
      setFillResult(await fillEform(frameRef.current, fields))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không điền được biểu mẫu')
    } finally {
      setFilling(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand compact">
          <div className="brand-mark">AT</div>
          <div>
            <strong>Gán nhãn — {procedure?.label ?? key}</strong>
            <span>Xem form đã điền + JSON bóc tách, sửa và lưu thành nhãn đúng</span>
          </div>
        </div>
        <div className="user-box">
          <Link to={`/thu-tuc/${key}/nhan`} className="ghost-btn">
            Nhãn đã gán
          </Link>
          <div className="user-info">
            <strong>{user?.full_name}</strong>
            <span>@{user?.username}</span>
          </div>
          <button className="ghost-btn" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </header>

      <div className="eform-bar">
        <Link to="/thu-tuc" className="back-link">
          ← Chọn thủ tục khác
        </Link>
        <span className="view-switch">
          <button
            className={`chip${view === 'eform' ? ' active' : ''}`}
            onClick={() => setView('eform')}
            disabled={!eform}
          >
            Form đã điền
          </button>
          <button
            className={`chip${view === 'json' ? ' active' : ''}`}
            onClick={() => setView('json')}
          >
            JSON bóc tách
          </button>
        </span>
        {labeled && <span className="badge-labeled">● Đã gán nhãn</span>}
      </div>

      {error && (
        <div className="alert error dismissible" style={{ margin: '0 24px' }}>
          <span>{error}</span>
          <button className="ghost-btn" onClick={() => setError(null)}>
            Đóng
          </button>
        </div>
      )}

      {!itemId ? (
        <div className="empty eform-empty">
          Mở trang này từ một hồ sơ đã bóc tách (nút “Mở eForm” ở phiên quét, hoặc từ danh sách nhãn
          của thủ tục).
        </div>
      ) : (
        <div className="eform-split">
          <div className="doc-pane">
            {view === 'eform' ? (
              <>
                <div className="doc-tabs">
                  <button className="primary-btn inline" onClick={handleFill} disabled={filling}>
                    {filling ? 'Đang điền…' : 'Điền lại theo dữ liệu hiện tại'}
                  </button>
                  {fillResult && (
                    <span className="muted-small">
                      Đã điền {fillResult.filled}/{fields.length}
                      {fillResult.notFound.length
                        ? ` · thiếu: ${fillResult.notFound.join(', ')}`
                        : ''}
                    </span>
                  )}
                </div>
                {eform ? (
                  <iframe
                    ref={frameRef}
                    className="doc-frame"
                    src={`${eform}?embed=1`}
                    title="eForm"
                    onLoad={() => {
              setFrameReady(true)
              setFrameEpoch((n) => n + 1)
            }}
                  />
                ) : (
                  <div className="empty">Thủ tục này chưa có eForm dựng sẵn.</div>
                )}
              </>
            ) : (
              <div className="json-view">
                <pre>{JSON.stringify(rawResult, null, 2)}</pre>
              </div>
            )}
          </div>

          <aside className="label-pane">
            <div className="label-head">
              <h3>Dữ liệu bóc tách — sửa cho đúng</h3>
              <span className="counter">{fields.length} trường</span>
            </div>
            {labeledInfo && <p className="muted-small">{labeledInfo}</p>}

            <div className="label-fields">
              {fields.map((f, i) => (
                <div className="label-field" key={`${f.name}-${i}`}>
                  <label className="label-name" title={f.comp ?? undefined}>
                    {f.name}
                    {f.default && <span className="tag-default">mặc định</span>}
                  </label>
                  {isObject(f.value) ? (
                    <div className="area-edit">
                      {orderedKeys(f.value).map((k) => (
                        <div className="area-edit-row" key={k}>
                          <span>{AREA_LABEL[k] ?? k}</span>
                          <input
                            value={String((f.value as Record<string, unknown>)[k] ?? '')}
                            onChange={(e) => setAreaValue(i, k, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="label-input"
                      value={f.value === null || f.value === undefined ? '' : String(f.value)}
                      onChange={(e) => setStringValue(i, e.target.value)}
                    />
                  )}
                </div>
              ))}
              {fields.length === 0 && <p className="muted-small">Chưa có dữ liệu.</p>}
            </div>

            <div className="label-actions">
              <div className="label-actions row">
                <button
                  className="ghost-btn"
                  onClick={() => save('draft')}
                  disabled={saving || !fields.length}
                >
                  Lưu nháp
                </button>
                <button
                  className="primary-btn inline"
                  onClick={() => save('done')}
                  disabled={saving || !fields.length}
                >
                  {saving ? 'Đang lưu…' : 'Lưu & hoàn thiện'}
                </button>
              </div>
              {status === 'done' && <span className="muted-small ok-text">● Đã hoàn thiện</span>}
              {dirty ? (
                <span className="muted-small">Đang chờ tự lưu…</span>
              ) : autoSaveMsg ? (
                <span className="muted-small ok-text">{autoSaveMsg}</span>
              ) : null}
              {saveMsg && <span className="muted-small ok-text">{saveMsg}</span>}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
