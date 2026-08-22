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
}

export interface HistoryJobDetail extends HistoryJob {
  items: HistoryItem[]
}

export interface HistoryListResponse {
  total: number
  items: HistoryJob[]
  enabled: boolean
}
