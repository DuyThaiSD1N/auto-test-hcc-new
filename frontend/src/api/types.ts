export interface User {
  username: string
  full_name: string
  role: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface Procedure {
  key: string
  code: string | null
  label: string
  url: string
  needsAgencySelect: boolean
  autoConfirm: boolean
}

export interface ProcedureListResponse {
  total: number
  items: Procedure[]
}

// ---- API bóc tách hồ sơ theo lô ----

export type JobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'
export type ItemStatus =
  | 'staged'
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface BatchCounts {
  total: number
  staged?: number
  queued?: number
  running?: number
  done?: number
  failed?: number
  done_with_errors?: number
}

export interface BatchJob {
  jobId: string
  name: string
  procedure: string
  /** Mã test của lần chạy thử, lưu vào lịch sử để tra lại */
  testCode?: string | null
  status: JobStatus
  counts: BatchCounts
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface BatchItem {
  itemId: string
  jobId: string
  clientDossierId: string
  procedure: string
  status: ItemStatus
  attempts: number
  fileCount: number
  totalBytes: number
  hasErrors: boolean
  error: string | null
  duplicate?: boolean
}

export interface BatchField {
  name: string
  comp: string | null
  // x-select-area nhận object {quocGia, tinh, xa, diaChi}; các comp khác là chuỗi
  value: string | Record<string, unknown> | null
  default?: boolean
  occurrence?: number | null
  // mapper của pipeline gắn thêm tên thay thế cho một số field
  aliases?: string[]
}

export interface BatchResult {
  itemId: string
  clientDossierId: string
  status: ItemStatus
  result: {
    fields: BatchField[]
    extracted: Record<string, unknown>
    stats: Record<string, number>
    errors: unknown[]
    sessionId: string | null
    requestId: string | null
  } | null
}

export interface BatchStatus {
  configured: boolean
  /** "batch" = API theo lô của Auto Fill HCC; "internal" = BE nội bộ */
  provider: 'batch' | 'internal'
  baseUrl: string
  /** Đuôi file backend nhận, gồm cả loại được tự chuyển đổi */
  acceptedSuffixes: string[]
}

// ---- Lịch sử lưu trong MongoDB ----

export interface HistoryJob {
  jobId: string
  name: string | null
  procedure: string | null
  testCode?: string | null
  provider: 'batch' | 'internal' | string
  status: string
  counts: BatchCounts
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
  savedAt: string
}

export interface HistoryItem {
  itemId: string
  jobId: string
  procedure: string | null
  clientDossierId: string
  status: string
  error: string | null
  fileCount: number | null
  totalBytes: number | null
  files?: { name: string; type: string; bytes: number }[]
  hasResult: boolean
  /** Số trường trong JSON bóc tách đã lưu */
  resultFieldCount?: number
  /** Có nhãn đã sửa tay hay chưa (draft/done), null = chưa gán */
  labelStatus?: 'draft' | 'done' | null
  /** Tiến trình xử lý hồ sơ (lưu trong CSDL nên phiên cũ vẫn xem lại được) */
  attempts?: number
  createdAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  hasErrors?: boolean
}

export interface HistoryJobDetail extends HistoryJob {
  items: HistoryItem[]
}

export interface HistoryListResponse {
  total: number
  items: HistoryJob[]
  enabled: boolean
}

// ---- File gốc + nhãn kết quả đúng ----

export interface LabelRecord {
  itemId: string
  jobId: string | null
  procedure: string | null
  clientDossierId: string | null
  fields: BatchField[]
  fieldCount: number
  status: LabelStatus
  /** Loại lỗi — luôn rỗng khi hồ sơ đã hoàn thiện */
  issues?: string[]
  /** Nhận xét của người gán nhãn */
  note?: string | null
  labeledBy: string | null
  labeledAt: string
}

export type LabelStatus = 'pending' | 'draft' | 'error' | 'done'

/** Loại lỗi gán cho hồ sơ khi lưu ở trạng thái "lỗi" */
export type IssueKind =
  | 'dien-sai'
  | 'dien-thieu'
  | 'ocr-sai'
  | 'sai-chu-the'
  | 'khong-uu-tien'

export const ISSUE_LABEL: Record<string, string> = {
  'dien-sai': 'Điền sai',
  'dien-thieu': 'Điền thiếu',
  'ocr-sai': 'OCR sai thông tin',
  'sai-chu-the': 'Điền sai chủ thể',
  'khong-uu-tien': 'Không ưu tiên',
}

export interface LabelStats {
  enabled: boolean
  byProcedure: Record<
    string,
    { labels: number; results: number; done: number; errors?: number }
  >
}

export interface WorklistItem {
  itemId: string
  clientDossierId: string | null
  status: LabelStatus
  labeled: boolean
  hasResult: boolean
  resultFieldCount: number
  labelFieldCount: number
  labeledBy: string | null
  labeledAt: string | null
  issues: string[]
  note: string | null
}

export interface WorklistResponse {
  enabled: boolean
  total: number
  counts: { total: number; pending: number; draft: number; error: number; done: number }
  items: WorklistItem[]
}

export interface HistoryResult {
  itemId: string
  jobId: string | null
  procedure: string | null
  clientDossierId: string | null
  fieldCount: number
  result: BatchResult['result']
  savedAt: string
}

// ---- Quản lý tài khoản (chỉ admin) ----

export interface AccountRow {
  username: string
  fullName: string
  role: 'admin' | 'tester' | string
  createdAt: string | null
  updatedAt: string | null
  /** "mongo" = sửa/xóa được; "env" = tài khoản dự phòng từ biến môi trường */
  source: 'mongo' | 'env' | string
}

export interface AccountListResponse {
  enabled: boolean
  items: AccountRow[]
}

/** Văn bản OCR của một hồ sơ, đọc từ trace của nguồn bóc tách */
export interface ItemOcr {
  available: boolean
  reason?: string
  requestId?: string
  ocrText?: string
  provider?: string | null
  chars?: number
  createdAt?: string | null
}

// ---- Kho tài liệu (tài khoản chuyên upload bỏ hồ sơ vào) ----

export interface PoolFile {
  name: string
  type: string
  bytes: number
  fileId: string
}

export interface PoolItem {
  poolId: string
  procedure: string
  clientDossierId: string
  note: string | null
  files: PoolFile[]
  fileCount: number
  totalBytes: number
  uploadedBy: string
  uploadedAt: string
  /** Đã dùng để chạy bóc tách bao nhiêu lần — không khóa, chạy lại thoải mái */
  useCount: number
  lastUsedAt: string | null
  lastJobId: string | null
}

export interface PoolListResponse {
  enabled: boolean
  total: number
  items: PoolItem[]
}
