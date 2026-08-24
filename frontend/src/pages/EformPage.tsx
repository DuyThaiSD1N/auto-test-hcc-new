import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { BatchField, HistoryJobDetail, ItemOcr, Procedure } from '../api/types'
import { ISSUE_LABEL } from '../api/types'
import { eformUrl } from '../eform/registry'
import AppLayout from '../components/AppLayout'
import { fillEform } from '../eform/runFill'
import type { FillResult } from '../eform/runFill'
import { useAuth } from '../auth/AuthContext'

type View = 'eform' | 'json' | 'phien'

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

interface OcrView {
  /** Văn bản OCR theo từng trang, nếu nguồn bóc tách trả về */
  pages: { label: string; text: string }[]
  /** Văn bản OCR gộp một khối */
  text: string | null
  /** Dữ liệu thô của bước quét trước khi ánh xạ sang trường biểu mẫu */
  extracted: Record<string, unknown> | null
  documents: string[]
  stats: Record<string, unknown> | null
  session: string | null
}

function firstString(values: unknown[]): string | null {
  const found = values.find((v) => typeof v === 'string' && v.trim())
  return typeof found === 'string' ? found : null
}

/**
 * Rút phần "bản quét đọc ra được gì" từ kết quả bóc tách.
 *
 * Mỗi pipeline trả một kiểu: có nơi để văn bản OCR ở `pages[]`, có nơi gộp vào
 * `ocrText`/`extracted.text`, pipeline `trich_luc` hiện chỉ trả `extracted` (dữ liệu
 * thô) và `stats` (thời gian OCR/LLM). Đọc rộng tay để nguồn nào cũng hiện được,
 * và không có gì thì nói thẳng là không có chứ không hiện khung trống.
 */
function readOcr(raw: unknown): OcrView {
  const r = isObject(raw) ? raw : {}
  const extracted = isObject(r.extracted) ? r.extracted : null

  const pages: { label: string; text: string }[] = []
  if (Array.isArray(r.pages)) {
    r.pages.forEach((p, i) => {
      if (typeof p === 'string' && p.trim()) {
        pages.push({ label: `Trang ${i + 1}`, text: p })
      } else if (isObject(p)) {
        const text = firstString([p.text, p.content, p.ocr, p.rawText, p.raw_text])
        if (text) {
          const label = firstString([p.name, p.file, p.fileName, p.page]) ?? `Trang ${i + 1}`
          pages.push({ label, text })
        }
      }
    })
  }

  const documents = Array.isArray(extracted?.documents)
    ? (extracted!.documents as unknown[]).map((d) =>
        typeof d === 'string' ? d : String(isObject(d) ? d.name ?? JSON.stringify(d) : d),
      )
    : []

  return {
    pages,
    text: firstString([
      r.ocrText,
      r.ocr,
      r.text,
      extracted?.text,
      extracted?.ocr,
      extracted?.ocrText,
      extracted?.rawText,
      extracted?.raw_text,
    ]),
    extracted,
    documents,
    stats: isObject(r.stats) ? r.stats : null,
    session: firstString([r.sessionId, r.requestId]),
  }
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

/** Khoảng thời gian giữa hai mốc, dạng người đọc được */
function duration(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to) return null
  const msec = new Date(to).getTime() - new Date(from).getTime()
  if (Number.isNaN(msec) || msec < 0) return null
  if (msec < 60_000) return `${(msec / 1000).toFixed(1).replace('.', ',')} giây`
  return `${Math.floor(msec / 60_000)} phút ${Math.round((msec % 60_000) / 1000)} giây`
}

/** "12 ms" / "5,0 giây" - stats của pipeline tính bằng mili giây */
function ms(value: unknown): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1).replace('.', ',')} giây`
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
  const [view, setView] = useState<View>(() => {
    const wanted = params.get('view')
    if (wanted === 'json' || wanted === 'phien') return wanted
    return eformUrl(key) ? 'eform' : 'json'
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [filling, setFilling] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [frameEpoch, setFrameEpoch] = useState(0)
  const [status, setStatus] = useState<'pending' | 'draft' | 'error' | 'done'>('pending')
  // Nhận xét + loại lỗi của hồ sơ (chỉ có nghĩa khi lưu ở trạng thái "lỗi")
  const [note, setNote] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  // Tab JSON: mặc định chia đôi màn hình như tab Form, bấm mở rộng thì chiếm hết bề ngang
  const [jsonFull, setJsonFull] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedOcr, setCopiedOcr] = useState(false)
  // Khối nào đang chiếm hết chiều cao: cả hai / chỉ OCR / chỉ JSON
  const [stack, setStack] = useState<'ca-hai' | 'ocr' | 'json'>('ca-hai')
  const [autoSaveMsg, setAutoSaveMsg] = useState<string | null>(null)

  // Phần OCR của tab JSON, đọc lại mỗi khi có kết quả mới
  const ocr = useMemo(() => readOcr(rawResult), [rawResult])
  // Kết quả bóc tách không kèm văn bản OCR -> hỏi thêm backend (nó đọc trace của nguồn bóc tách)
  const [ocrRemote, setOcrRemote] = useState<ItemOcr | 'dang-tai' | null>(null)
  const hasOcrText =
    ocr.pages.length > 0 ||
    Boolean(ocr.text) ||
    (typeof ocrRemote === 'object' && Boolean(ocrRemote?.available))

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
        setNote(saved.note ?? '')
        setIssues(saved.issues ?? [])
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
  //
  // KHÔNG tự lưu khi hồ sơ đang là "lỗi": sửa một hồ sơ lỗi là đang chữa nó, phải tự
  // bấm nút để chốt xem chữa xong (hoàn thiện) hay vẫn còn lỗi.
  useEffect(() => {
    if (!dirty || !itemId || fields.length === 0 || status === 'error') return
    const t = setTimeout(async () => {
      try {
        const keep = status === 'pending' ? 'draft' : status
        await api.saveLabel(itemId, {
          fields: fieldsRef.current,
          procedure: key,
          clientDossierId: null,
          status: keep,
          note,
          issues,
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
  }, [dirty, fields, itemId, key, status, note, issues])

  useEffect(() => {
    setOcrRemote(null)
  }, [itemId])

  useEffect(() => {
    if (view !== 'json' || !itemId || ocrRemote) return
    if (ocr.pages.length > 0 || ocr.text) return // kết quả đã kèm sẵn văn bản OCR
    setOcrRemote('dang-tai')
    api
      .itemOcr(itemId)
      .then(setOcrRemote)
      .catch((err) =>
        setOcrRemote({
          available: false,
          reason: err instanceof Error ? err.message : 'Không đọc được văn bản OCR.',
        }),
      )
  }, [view, itemId, ocr, ocrRemote])

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
          status: status === 'pending' ? 'draft' : status,
          note,
          issues,
        })
      }
    } catch {
      /* lưu lỗi vẫn cho quay lại; auto-save/nút lưu tay vẫn còn */
    } finally {
      navigate(`/thu-tuc/${key}/nhan`)
    }
  }

  async function save(next: 'draft' | 'error' | 'done' = 'draft') {
    if (!itemId) return
    if (next === 'error' && issues.length === 0) {
      setError('Chọn ít nhất một loại lỗi trước khi lưu lỗi.')
      return
    }
    if (next === 'done' && status === 'error' && !dirty) {
      setError('Hồ sơ đang là lỗi. Sửa lại dữ liệu rồi mới đánh dấu hoàn thiện được.')
      return
    }
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    try {
      // Hồ sơ hoàn thiện thì bỏ hết tag lỗi — đã sửa xong nên tag không còn đúng nữa
      const keptIssues = next === 'done' ? [] : issues
      await api.saveLabel(itemId, {
        fields,
        procedure: key,
        clientDossierId: null,
        status: next,
        note,
        issues: keptIssues,
      })
      setIssues(keptIssues)
      setLabeled(true)
      setStatus(next)
      setDirty(false)
      setAutoSaveMsg(null)
      setSaveMsg(
        next === 'done'
          ? 'Đã lưu và đánh dấu hoàn thiện.'
          : next === 'error'
            ? 'Đã lưu là hồ sơ lỗi.'
            : 'Đã lưu nháp.',
      )
      setLabeledInfo(
        `Đã gán nhãn bởi ${user?.username ?? ''} lúc ${new Date().toLocaleString('vi-VN')}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được nhãn')
    } finally {
      setSaving(false)
    }
  }

  /** Bỏ nhãn (chỉ admin): quay về đúng dữ liệu bóc tách gốc để gán lại từ đầu. */
  async function removeLabel() {
    if (!itemId) return
    setError(null)
    try {
      await api.deleteLabel(itemId)
      const base = isObject(rawResult) ? ((rawResult.fields as BatchField[]) ?? []) : []
      setFields(base)
      setLabeled(false)
      setLabeledInfo(null)
      setStatus('pending')
      setNote('')
      setIssues([])
      setDirty(false)
      setAutoSaveMsg(null)
      setSaveMsg('Đã bỏ nhãn, hồ sơ quay về dữ liệu bóc tách gốc.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được nhãn')
    }
  }

  async function copyOcr() {
    const text =
      ocr.pages.map((p) => ['───── ' + p.label + ' ─────', p.text].join('\n')).join('\n\n') ||
      ocr.text ||
      (typeof ocrRemote === 'object' ? ocrRemote?.ocrText : '') ||
      ''
    try {
      await navigator.clipboard.writeText(text)
      setCopiedOcr(true)
      setTimeout(() => setCopiedOcr(false), 1500)
    } catch {
      setError('Trình duyệt không cho chép vào clipboard. Bôi đen rồi Ctrl+C.')
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
          <button
            className={`chip${view === 'phien' ? ' active' : ''}`}
            onClick={() => setView('phien')}
          >
            Tổng hợp phiên
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
            {/* Cả ba khối luôn nằm trong DOM, chỉ ẩn/hiện. Nhờ vậy quay lại tab
                "Form đã điền" là thấy nguyên form đã điền, không phải điền lại từ đầu. */}
            <div className="pane-slot" hidden={view !== 'eform'}>
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
            </div>

            <div className="pane-slot" hidden={view !== 'json'}>
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
                <div className={`json-stack${stack === 'ca-hai' ? '' : ` chi-${stack}`}`}>
                  {/* Trên: bản quét đọc ra gì. Dưới: JSON đã bóc tách thành trường. */}
                  <section className="json-box ocr">
                    <header className="json-box-head">
                      <strong>OCR — bản quét đọc ra gì</strong>
                      <span className="json-box-tools">
                        <button
                          className="ghost-btn"
                          onClick={() => setStack(stack === 'ocr' ? 'ca-hai' : 'ocr')}
                        >
                          {stack === 'ocr' ? 'Thu lại' : 'Phóng to'}
                        </button>
                        {hasOcrText && (
                          <button className="ghost-btn" onClick={copyOcr}>
                            {copiedOcr ? 'Đã chép ✓' : 'Chép OCR'}
                          </button>
                        )}
                      </span>
                      <span className="json-box-note">
                        {ocr.documents.length > 0 && `${ocr.documents.join(' · ')} — `}
                        {ms(ocr.stats?.ocr_latency_ms)
                          ? `OCR ${ms(ocr.stats?.ocr_latency_ms)}`
                          : 'chưa có số liệu OCR'}
                        {ms(ocr.stats?.llm_latency_ms) && ` · LLM ${ms(ocr.stats?.llm_latency_ms)}`}
                        {typeof ocrRemote === 'object' &&
                          ocrRemote?.available &&
                          ` · ${ocrRemote.chars?.toLocaleString('vi-VN')} ký tự${
                            ocrRemote.provider ? ` · ${ocrRemote.provider}` : ''
                          }`}
                        {ocr.session && ` · ${ocr.session}`}
                      </span>
                    </header>
                    <div className="json-view">
                      {ocr.pages.length > 0 ? (
                        <pre>
                          {ocr.pages
                            .map((p) => `───── ${p.label} ─────\n${p.text}`)
                            .join('\n\n')}
                        </pre>
                      ) : ocr.text ? (
                        <pre>{ocr.text}</pre>
                      ) : ocrRemote === 'dang-tai' ? (
                        <pre>{'Đang lấy văn bản OCR từ nguồn bóc tách…'}</pre>
                      ) : typeof ocrRemote === 'object' && ocrRemote?.available ? (
                        <pre>{ocrRemote.ocrText}</pre>
                      ) : (
                        <div className="ocr-empty">
                          <strong>Chưa lấy được văn bản OCR của tài liệu</strong>
                          {typeof ocrRemote === 'object' && ocrRemote?.reason && (
                            <p>{ocrRemote.reason}</p>
                          )}
                          <button className="ghost-btn" onClick={() => setOcrRemote(null)}>
                            Thử lại
                          </button>
                          {ocr.extracted && Object.keys(ocr.extracted).length > 0 && (
                            <>
                              <p className="ocr-empty-note">
                                Bên dưới chỉ là dữ liệu thô của bước quét (
                                <code>result.extracted</code>) — <strong>không phải</strong> nội
                                dung OCR đọc từ tài liệu.
                              </p>
                              <pre>{JSON.stringify(ocr.extracted, null, 2)}</pre>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="json-box">
                    <header className="json-box-head">
                      <strong>JSON bóc tách</strong>
                      <span className="json-box-tools">
                        <button
                          className="ghost-btn"
                          onClick={() => setStack(stack === 'json' ? 'ca-hai' : 'json')}
                        >
                          {stack === 'json' ? 'Thu lại' : 'Phóng to'}
                        </button>
                      </span>
                      <span className="json-box-note">{fields.length} trường</span>
                    </header>
                    <div className="json-view">
                      <pre>{JSON.stringify(rawResult, null, 2)}</pre>
                    </div>
                  </section>
                </div>
              </>
            </div>

            <div className="pane-slot" hidden={view !== 'phien'}>
              <SessionSummary
                itemId={itemId}
                active={view === 'phien'}
                onOpen={(next) => navigate(`/thu-tuc/${key}/eform?item=${next}`)}
              />
            </div>
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
              {/* Nhận xét + loại lỗi: dùng khi hồ sơ có vấn đề. Hồ sơ đã hoàn thiện
                  thì tag lỗi bị bỏ, chỉ giữ lại nhận xét để biết trước đó vướng gì. */}
              <details className="issue-box" open={status === 'error' || issues.length > 0}>
                <summary>
                  Nhận xét &amp; loại lỗi
                  {issues.length > 0 && status !== 'done' && (
                    <span className="issue-count">{issues.length}</span>
                  )}
                </summary>

                <div className="issue-tags">
                  {Object.entries(ISSUE_LABEL).map(([kind, label]) => (
                    <button
                      key={kind}
                      className={`issue-tag${issues.includes(kind) ? ' on' : ''}`}
                      onClick={() => {
                        setIssues((prev) =>
                          prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
                        )
                        setDirty(true)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <textarea
                  className="issue-note"
                  placeholder="Nhận xét: sai ở trường nào, vì sao…"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value)
                    setDirty(true)
                  }}
                />
              </details>

              {status === 'done' && !dirty ? (
                <div className="saved-state">
                  <span className="badge-labeled">✓ Đã lưu &amp; hoàn thiện</span>
                  <span className="muted-small">
                    {saveMsg ?? autoSaveMsg ?? labeledInfo ?? 'Nhãn đã lưu trong hệ thống.'}
                  </span>
                  <span className="muted-small">Sửa bất kỳ trường nào để lưu lại.</span>
                  {user?.role === 'admin' && (
                    <button className="ghost-btn danger" onClick={removeLabel}>
                      Xóa nhãn
                    </button>
                  )}
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
                      className="ghost-btn danger"
                      onClick={() => save('error')}
                      disabled={saving || !fields.length}
                      title="Đánh dấu hồ sơ này sai, kèm loại lỗi đã chọn ở trên"
                    >
                      Lưu lỗi
                    </button>
                    <button
                      className="primary-btn inline"
                      onClick={() => save('done')}
                      disabled={saving || !fields.length || (status === 'error' && !dirty)}
                      title={
                        status === 'error' && !dirty
                          ? 'Hồ sơ đang là lỗi — sửa lại dữ liệu rồi mới hoàn thiện được'
                          : undefined
                      }
                    >
                      {saving ? 'Đang lưu…' : 'Lưu & hoàn thiện'}
                    </button>
                  </div>

                  {status === 'error' && !dirty && (
                    <div className="saved-state">
                      <span className="badge-issue">
                        ⚠ Đã lưu là lỗi
                        {issues.length > 0 &&
                          ` — ${issues.map((k) => ISSUE_LABEL[k] ?? k).join(', ')}`}
                      </span>
                      <span className="muted-small">
                        Không tự lưu ở trạng thái lỗi. Sửa lại dữ liệu rồi bấm “Lưu &amp; hoàn
                        thiện” — lúc đó tag lỗi sẽ được gỡ.
                      </span>
                      {user?.role === 'admin' && labeled && (
                        <button className="ghost-btn danger" onClick={removeLabel}>
                          Xóa nhãn
                        </button>
                      )}
                    </div>
                  )}

                  {status === 'draft' && !dirty && (
                    <div className="saved-state">
                      <span className="muted-small ok-text">
                        ● Đã lưu nháp — bấm “Lưu &amp; hoàn thiện” khi xong
                      </span>
                      {user?.role === 'admin' && labeled && (
                        <button className="ghost-btn danger" onClick={removeLabel}>
                          Xóa nhãn
                        </button>
                      )}
                    </div>
                  )}
                  {dirty ? (
                    <span className="muted-small">
                      {status === 'error' ? 'Đã sửa — bấm nút để lưu lại.' : 'Đang chờ tự lưu…'}
                    </span>
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

const LABEL_STATUS: Record<string, string> = {
  draft: 'Đang sửa',
  error: 'Lỗi',
  done: 'Hoàn thiện',
}

/**
 * Tab "Tổng hợp phiên": toàn bộ hồ sơ của phiên quét chứa hồ sơ đang mở —
 * chạy ra sao, hồ sơ nào đã gán nhãn, và nhảy thẳng sang hồ sơ khác mà không
 * phải quay về danh sách.
 */
function SessionSummary({
  itemId,
  active,
  onOpen,
}: {
  itemId: string | null
  active: boolean
  onOpen: (itemId: string) => void
}) {
  const [job, setJob] = useState<HistoryJobDetail | null>(null)
  const [state, setState] = useState<'cho' | 'dang-tai' | 'xong' | 'khong-co'>('cho')

  useEffect(() => {
    setJob(null)
    setState('cho')
  }, [itemId])

  useEffect(() => {
    if (!active || !itemId || state !== 'cho') return
    setState('dang-tai')
    ;(async () => {
      try {
        const res = await api.historyResult(itemId)
        if (!res.jobId) {
          setState('khong-co')
          return
        }
        setJob(await api.historyJob(res.jobId))
        setState('xong')
      } catch {
        setState('khong-co')
      }
    })()
  }, [active, itemId, state])

  if (state === 'dang-tai' || state === 'cho') {
    return <div className="session-pane muted-small">Đang tải phiên quét…</div>
  }
  if (state === 'khong-co' || !job) {
    return (
      <div className="session-pane">
        <div className="empty">
          Hồ sơ này không gắn với phiên quét nào còn trong lịch sử (phiên có thể đã bị xóa).
        </div>
      </div>
    )
  }

  const took = duration(job.startedAt, job.finishedAt)

  return (
    <div className="session-pane">
      <div className="session-head">
        <div>
          <strong>{job.name || job.jobId}</strong>
          <span className="muted-small mono"> · {job.testCode || job.jobId}</span>
        </div>
        <span className={`status-pill s-${job.status}`}>{job.status}</span>
      </div>

      <div className="fact-grid">
        <div>
          <dt>Kết quả</dt>
          <dd>
            {job.counts?.done ?? 0} xong · {job.counts?.failed ?? 0} lỗi /{' '}
            {job.counts?.total ?? 0} hồ sơ
          </dd>
        </div>
        <div>
          <dt>Bắt đầu</dt>
          <dd>{formatTime(job.startedAt)}</dd>
        </div>
        <div>
          <dt>Kết thúc</dt>
          <dd>
            {formatTime(job.finishedAt)}
            {took && <span className="muted-small"> (chạy {took})</span>}
          </dd>
        </div>
        <div>
          <dt>Nguồn bóc tách</dt>
          <dd>{job.provider === 'internal' ? 'BE nội bộ' : 'API theo lô'}</dd>
        </div>
      </div>

      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table className="dossier-table">
          <thead>
            <tr>
              <th>Mã hồ sơ</th>
              <th>Trạng thái</th>
              <th>Trường</th>
              <th>Nhãn</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {job.items.map((it) => (
              <tr key={it.itemId} className={it.itemId === itemId ? 'row-open' : ''}>
                <td>
                  {it.clientDossierId}
                  {it.itemId === itemId && <span className="tag-default">đang mở</span>}
                </td>
                <td>
                  <span className={`status-pill s-${it.status}`}>{it.status}</span>
                  {it.error && <div className="muted-small error-text">{it.error}</div>}
                </td>
                <td>{it.resultFieldCount ?? 0}</td>
                <td>
                  {it.labelStatus ? (
                    <span className={`status-pill s-${it.labelStatus}`}>
                      {LABEL_STATUS[it.labelStatus] ?? it.labelStatus}
                    </span>
                  ) : (
                    <span className="muted-small">chưa gán</span>
                  )}
                </td>
                <td className="row-actions">
                  {it.hasResult && it.itemId !== itemId && (
                    <button className="ghost-btn" onClick={() => onOpen(it.itemId)}>
                      Mở hồ sơ này
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
