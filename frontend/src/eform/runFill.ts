import type { BatchField } from '../api/types'

/**
 * Nạp engine điền của extension vào trong iframe eForm rồi gọi nó.
 *
 * Hai file trong `public/eform/engine/` được trích thẳng từ extension
 * (`content.js` + `content/fill-legacy.js`) nên hành vi điền giống hệt bản đang chạy thật.
 * Chúng đăng ký hàm vào `window.__HCC__` của iframe — iframe cùng origin nên gọi được.
 */
const ENGINE_SCRIPTS = ['/eform/engine/helpers.js', '/eform/engine/fill-legacy.js']

export interface FillResult {
  filled: number
  notFound: string[]
  errors: string[]
}

interface EngineWindow extends Window {
  __HCC__?: { fillForm?: (fields: unknown[]) => Promise<FillResult> }
}

function injectScript(doc: Document, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Không tải được ${src}`))
    doc.head.appendChild(script)
  })
}

export async function fillEform(
  frame: HTMLIFrameElement | null,
  fields: BatchField[],
): Promise<FillResult> {
  const win = frame?.contentWindow as EngineWindow | null | undefined
  const doc = frame?.contentDocument
  if (!win || !doc) throw new Error('Chưa mở được biểu mẫu, thử tải lại trang.')

  // Nạp một lần cho mỗi lần iframe load; bấm điền lại thì dùng luôn engine đã có
  if (typeof win.__HCC__?.fillForm !== 'function') {
    for (const src of ENGINE_SCRIPTS) await injectScript(doc, src)
  }

  const fillForm = win.__HCC__?.fillForm
  if (typeof fillForm !== 'function') throw new Error('Không nạp được engine điền biểu mẫu.')

  return fillForm(fields)
}
