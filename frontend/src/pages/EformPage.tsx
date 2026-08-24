import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { BatchField, Procedure } from '../api/types'
import { eformUrl } from '../eform/registry'
import AppLayout from '../components/AppLayout'
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
  const navigate = useNavigate()
  const itemId = params.get('item')
  const { user } = useAuth()

  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [fields, setFields] = useState<BatchField[]>([])
  const [rawResult, setRawResult] = useState<unknown>(null)
  const [labeled, setLabeled] = useState(false)
  const [labeledInfo, setLabeledInfo] = useState<string | null>(null)
  // Mở thẳng một tab qua URL (?view=json) — tiện gửi link cho nhau xem JSON.
  // Không có eForm dựng sẵn thì cũng vào thẳng tab JSON (đỡ hiện tab Form trống).
  const [view, setView] = useState<View>(
    params.get('view') === 'json' || !eformUrl(key) ? 'json' : 'eform',
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [filling, setFilling] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [frameEpoch, setFrameEpoch] = useState(0)
  const [status, setStatus] = useState<'pending' | 'draft' | 'done'>('pending')
  // Tab JSON: mặc định chia đôi màn hình như tab Form, bấm mở rộng thì chiếm hết bề ngang
  const [jsonFull, setJsonFull] = useState(false)
  const [copied, setCopied] = useState(false)
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

  // Quay lại danh sách hồ sơ, lưu tiến trình trước khi rời (phòng khi tự-lưu 1.2s chưa chạy)
  const [goingBack, setGoingBack] = useState(false)
  async function backToList() {
    setGoingBack(true)
    try {
      if (itemId && dirty && fields.length) {
        await api.saveLabel(itemId, {
          fields,
          procedure: key,
          clientDossierId: null,
          status: status === 'done' ? 'done' : 'draft',
        })
      }
    } catch {
      /* lưu lỗi vẫn cho quay lại; auto-save/nút lưu tay vẫn còn */
    } finally {
      navigate(`/thu-tuc/${key}/nhan`)
    }
  }

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

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawResult, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Trình duyệt không cho chép vào clipboard. Bôi đen rồi Ctrl+C.')
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
    <AppLayout
      fullBleed
      title={`Gán nhãn — ${procedure?.label ?? key}`}
      subtitle="Form đã điền + JSON bóc tách; sửa lại cho đúng rồi lưu thành nhãn"
      actions={
        <Link to={`/thu-tuc/${key}/nhan`} className="ghost-btn">
          Nhãn đã gán
        </Link>
      }
    >
      <div className="eform-bar">
        <button className="ghost-btn" onClick={backToList} disabled={goingBack}>
          {goingBack ? 'Đang lưu…' : '← Danh sách hồ sơ'}
        </button>
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
        <div className="alert error dismissible" style={{ margin: '14px 28px 0' }}>
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
        <div className={`eform-split${view === 'json' && jsonFull ? ' json-full' : ''}`}>
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
              <>
                <div className="doc-tabs">
                  <button className="ghost-btn" onClick={() => setJsonFull((v) => !v)}>
                    {jsonFull ? '⤡ Thu gọn về hai cột' : '⤢ Mở rộng toàn màn hình'}
                  </button>
                  <button className="ghost-btn" onClick={copyJson}>
                    {copied ? 'Đã chép ✓' : 'Chép JSON'}
                  </button>
                  <span className="muted-small">
                    {fields.length} trường · cuộn trong khung để xem hết
                  </span>
                </div>
                <div className="json-view">
                  <pre>{JSON.stringify(rawResult, null, 2)}</pre>
                </div>
              </>
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
              {/* Hồ sơ đã hoàn thiện và không có sửa đổi mới: chỉ báo trạng thái đã lưu,
                  không mời bấm lưu lần nữa. Chạm vào bất kỳ trường nào là nút hiện lại. */}
              {status === 'done' && !dirty ? (
                <div className="saved-state">
                  <span className="badge-labeled">✓ Đã lưu &amp; hoàn thiện</span>
                  <span className="muted-small">
                    {saveMsg ?? autoSaveMsg ?? labeledInfo ?? 'Nhãn đã lưu trong hệ thống.'}
                  </span>
                  <span className="muted-small">Sửa bất kỳ trường nào để lưu lại.</span>
                </div>
              ) : (
                <>
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
                  {status === 'draft' && !dirty && (
                    <span className="muted-small ok-text">
                      ● Đã lưu nháp — bấm “Lưu &amp; hoàn thiện” khi xong
                    </span>
                  )}
                  {dirty ? (
                    <span className="muted-small">Đang chờ tự lưu…</span>
                  ) : autoSaveMsg ? (
                    <span className="muted-small ok-text">{autoSaveMsg}</span>
                  ) : null}
                  {saveMsg && <span className="muted-small ok-text">{saveMsg}</span>}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </AppLayout>
  )
}
