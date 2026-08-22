import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { displayFieldValue } from '../api/fieldValue'
import type { BatchResult, Procedure } from '../api/types'
import { eformUrl } from '../eform/registry'
import { fillEform } from '../eform/runFill'
import type { FillResult } from '../eform/runFill'
import { useAuth } from '../auth/AuthContext'

export default function EformPage() {
  const { key = '' } = useParams()
  const [params] = useSearchParams()
  const itemId = params.get('item')
  const { user, logout } = useAuth()

  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [frameReady, setFrameReady] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  // Nhớ đã tự điền cho hồ sơ nào để không điền lặp mỗi lần render lại
  const autoFilledFor = useRef<string | null>(null)

  const url = eformUrl(key)

  useEffect(() => {
    api.procedure(key).then(setProcedure).catch(() => setProcedure(null))
  }, [key])

  useEffect(() => {
    if (!itemId) return
    api
      .itemResult(itemId)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Không lấy được kết quả'))
  }, [itemId])

  const fields = result?.result?.fields ?? []

  // Mở từ một hồ sơ đã bóc tách xong thì điền luôn: tải file -> bóc tách -> điền là một mạch.
  useEffect(() => {
    if (!frameReady || !itemId || fields.length === 0) return
    if (autoFilledFor.current === itemId) return
    autoFilledFor.current = itemId
    void handleFill()
    // handleFill đọc `fields` ngay tại thời điểm gọi nên không cần đưa vào deps
  }, [frameReady, itemId, fields.length])

  async function handleFill() {
    setError(null)
    setFilling(true)
    try {
      setFillResult(await fillEform(frameRef.current, fields))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không điền được biểu mẫu')
      setFillResult(null)
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
            <strong>eForm — {procedure?.label ?? key}</strong>
            <span>Biểu mẫu điện tử của thủ tục</span>
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

      <div className="eform-bar">
        <Link to={`/thu-tuc/${key}`} className="back-link">
          ← Quay lại phiên quét
        </Link>
        {url && (
          <a className="back-link" href={url} target="_blank" rel="noreferrer">
            Mở eForm ở tab riêng ↗
          </a>
        )}
      </div>

      {!url ? (
        <div className="empty eform-empty">
          Thủ tục này chưa có eForm dựng sẵn. Thêm file HTML vào <code>frontend/public/eform/</code>{' '}
          rồi khai báo trong <code>src/eform/registry.ts</code>.
        </div>
      ) : (
        <div className="eform-split">
          <iframe
            ref={frameRef}
            className="eform-frame"
            src={url}
            title="eForm"
            onLoad={() => {
              setFillResult(null)
              setFrameReady(true)
            }}
          />

          <aside className="eform-side">
            <h3>Dữ liệu đã bóc tách</h3>
            {error && <div className="alert error">{error}</div>}
            {!itemId && (
              <p className="muted-small">
                Mở trang này từ một hồ sơ đã bóc tách xong để xem dữ liệu tương ứng.
              </p>
            )}
            {itemId && !result && !error && <p className="muted-small">Đang tải kết quả…</p>}
            {fields.length > 0 && (
              <>
                <p className="muted-small">
                  {fields.length} trường · hồ sơ <strong>{result?.clientDossierId}</strong>
                </p>
                <div className="fields-box">
                  {fields.map((f, i) => (
                    <div className="field-row" key={`${f.name}-${i}`}>
                      <span className="field-name">
                        {f.name}
                        {f.comp ? ` · ${f.comp}` : ''}
                      </span>
                      <span className="field-value">{displayFieldValue(f.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {itemId && result && fields.length === 0 && (
              <p className="muted-small">Hồ sơ này không bóc tách được trường nào.</p>
            )}
            {fields.length > 0 && (
              <button className="primary-btn" onClick={handleFill} disabled={filling}>
                {filling ? 'Đang điền…' : fillResult ? 'Điền lại' : 'Điền vào eForm'}
              </button>
            )}

            {fillResult && (
              <div className={`alert ${fillResult.notFound.length ? 'warn' : 'ok'}`}>
                Đã điền {fillResult.filled}/{fields.length} trường.
                {fillResult.notFound.length > 0 && (
                  <> Không tìm thấy trên biểu mẫu: {fillResult.notFound.join(', ')}.</>
                )}
                {fillResult.errors.length > 0 && <> Lỗi: {fillResult.errors.join(', ')}.</>}
              </div>
            )}

            <p className="hint">
              Ô viền xanh là đã điền, vàng là giá trị mặc định, đỏ là còn trống — cùng quy ước màu
              với extension.
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}
