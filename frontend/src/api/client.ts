import type {
  BatchItem,
  BatchJob,
  BatchResult,
  BatchStatus,
  HistoryJobDetail,
  HistoryListResponse,
  LoginResponse,
  Procedure,
  ProcedureListResponse,
  User,
} from './types'

const TOKEN_KEY = 'hcc.access_token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra backend đã chạy chưa.')
  }

  if (!res.ok) {
    let detail = `Lỗi ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* body không phải JSON - giữ thông báo mặc định */
    }
    throw new ApiError(res.status, detail)
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<User>('/auth/me'),

  procedures: (query?: string) => {
    const qs = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
    return request<ProcedureListResponse>(`/procedures${qs}`)
  },

  procedure: (key: string) => request<Procedure>(`/procedures/${encodeURIComponent(key)}`),

  // ---- API bóc tách hồ sơ theo lô ----

  batchStatus: () => request<BatchStatus>('/batch/status'),

  createJob: (name: string, procedure: string) =>
    request<BatchJob>('/batch/jobs', {
      method: 'POST',
      body: JSON.stringify({ name, procedure }),
    }),

  uploadDossier: (
    jobId: string,
    clientDossierId: string,
    files: File[],
    hasHandwriting: boolean,
  ) => {
    const form = new FormData()
    form.append('clientDossierId', clientDossierId)
    form.append('hasHandwriting', String(hasHandwriting))
    files.forEach((file) => form.append('files', file, file.name))
    return request<BatchItem>(`/batch/jobs/${jobId}/items`, {
      method: 'POST',
      body: form,
      // Gửi lại cùng khóa này khi timeout thì server nhận ra là trùng, không tạo hồ sơ mới
      headers: { 'Idempotency-Key': `${jobId}-${clientDossierId}` },
    })
  },

  startJob: (jobId: string) => request<BatchJob>(`/batch/jobs/${jobId}/start`, { method: 'POST' }),

  getJob: (jobId: string) => request<BatchJob>(`/batch/jobs/${jobId}`),

  cancelJob: (jobId: string) => request<BatchJob>(`/batch/jobs/${jobId}/cancel`, { method: 'POST' }),

  jobItems: (jobId: string) =>
    request<Envelope<BatchItem>>(`/batch/jobs/${jobId}/items?pageSize=200`).then(unwrap),

  jobResults: (jobId: string) =>
    request<Envelope<BatchResult>>(`/batch/jobs/${jobId}/results?pageSize=200`).then(unwrap),

  itemResult: (itemId: string) => request<BatchResult>(`/batch/items/${itemId}/result`),

  retryItem: (itemId: string) => request<BatchItem>(`/batch/items/${itemId}/retry`, { method: 'POST' }),

  // ---- Lịch sử đã lưu trong MongoDB ----

  historyJobs: (limit = 50) => request<HistoryListResponse>(`/history/jobs?limit=${limit}`),

  historyJob: (jobId: string) => request<HistoryJobDetail>(`/history/jobs/${jobId}`),

  deleteHistoryJob: (jobId: string) =>
    request<{ deleted: boolean }>(`/history/jobs/${jobId}`, { method: 'DELETE' }),
}

/**
 * Tài liệu API không nói rõ tên trường bọc danh sách, nên chấp nhận cả
 * `results`, `items` lẫn mảng trần để khỏi vỡ khi phía kia đổi cách trả về.
 */
type Envelope<T> = { results?: T[]; items?: T[] } | T[]

function unwrap<T>(data: Envelope<T>): T[] {
  if (Array.isArray(data)) return data
  return data.results ?? data.items ?? []
}
