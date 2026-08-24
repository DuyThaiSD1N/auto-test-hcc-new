import type {
  AccountListResponse,
  BatchItem,
  BatchJob,
  BatchResult,
  BatchStatus,
  BatchField,
  HistoryJobDetail,
  HistoryResult,
  ItemOcr,
  PoolListResponse,
  PoolItem,
  WorklistResponse,
  LabelStats,
  LabelRecord,
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

  // Token cũ/hết hạn: dọn luôn rồi đưa về trang đăng nhập, tránh kẹt ở màn hình
  // gọi API nào cũng lỗi mà không hiểu vì sao. Không áp dụng cho chính lời gọi đăng nhập
  // (401 ở đó nghĩa là sai mật khẩu, phải hiện thông báo chứ không phải điều hướng).
  // CHỈ đăng xuất khi 401 đến từ lớp xác thực của chính ứng dụng — nhận ra bằng header
  // WWW-Authenticate. Lỗi 401 do hệ thống bên ngoài (vd secret bóc tách sai) không được
  // đá người dùng về trang đăng nhập.
  const sessionExpired = res.status === 401 && res.headers.has('WWW-Authenticate')
  if (sessionExpired && token && !path.startsWith('/auth/login')) {
    tokenStore.clear()
    if (window.location.pathname !== '/dang-nhap') {
      window.location.assign('/dang-nhap')
    }
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

  createJob: (name: string, procedure: string, testCode?: string) =>
    request<BatchJob>('/batch/jobs', {
      method: 'POST',
      body: JSON.stringify({ name, procedure, testCode: testCode?.trim() || null }),
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

  /** Văn bản OCR mà nguồn bóc tách đọc được từ file của hồ sơ */
  itemOcr: (itemId: string) => request<ItemOcr>(`/batch/items/${itemId}/ocr`),

  retryItem: (itemId: string) => request<BatchItem>(`/batch/items/${itemId}/retry`, { method: 'POST' }),

  // ---- Lịch sử đã lưu trong MongoDB ----

  historyJobs: (limit = 50, procedure?: string, q?: string) => {
    const proc = procedure?.trim() ? `&procedure=${encodeURIComponent(procedure.trim())}` : ''
    const search = q?.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''
    return request<HistoryListResponse>(`/history/jobs?limit=${limit}${proc}${search}`)
  },

  historyJob: (jobId: string) => request<HistoryJobDetail>(`/history/jobs/${jobId}`),

  // ---- Thống kê nhãn + JSON bóc tách + nhãn kết quả đúng ----

  labelStats: () => request<LabelStats>('/history/stats'),

  labelsByProcedure: (procedure: string) =>
    request<WorklistResponse>(`/history/labels?procedure=${encodeURIComponent(procedure)}`),

  historyResult: (itemId: string) => request<HistoryResult>(`/history/items/${itemId}/result`),

  getLabel: (itemId: string) => request<LabelRecord>(`/history/items/${itemId}/label`),

  /** Xóa một hồ sơ CHƯA gán nhãn khỏi worklist — chỉ quản trị */
  deleteItemResult: (itemId: string) =>
    request<{ deleted: boolean }>(`/history/items/${itemId}/result`, { method: 'DELETE' }),

  /** Xóa toàn bộ hồ sơ chưa gán nhãn của một thủ tục — chỉ quản trị */
  deleteUnlabeled: (procedure: string) =>
    request<{ deleted: number }>(
      `/history/labels/unlabeled?procedure=${encodeURIComponent(procedure)}`,
      { method: 'DELETE' },
    ),

  /** Bỏ nhãn của một hồ sơ — chỉ tài khoản quản trị gọi được */
  deleteLabel: (itemId: string) =>
    request<{ deleted: boolean }>(`/history/items/${itemId}/label`, { method: 'DELETE' }),

  saveLabel: (
    itemId: string,
    body: {
      fields: BatchField[]
      jobId?: string | null
      procedure?: string | null
      clientDossierId?: string | null
      status?: 'draft' | 'error' | 'done'
      note?: string | null
      issues?: string[]
    },
  ) =>
    request<{ saved: boolean }>(`/history/items/${itemId}/label`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // ---- Kho tài liệu ----

  poolItems: (procedure?: string) => {
    const qs = procedure ? `?procedure=${encodeURIComponent(procedure)}` : ''
    return request<PoolListResponse>(`/pool/items${qs}`)
  },

  poolStatus: () =>
    request<{ enabled: boolean; acceptedSuffixes: string[] }>('/pool/status'),

  addToPool: (procedure: string, clientDossierId: string, files: File[], note?: string) => {
    const form = new FormData()
    form.append('procedure', procedure)
    form.append('clientDossierId', clientDossierId)
    if (note?.trim()) form.append('note', note.trim())
    files.forEach((f) => form.append('files', f, f.name))
    return request<PoolItem>('/pool/items', { method: 'POST', body: form })
  },

  deletePoolItem: (poolId: string) =>
    request<{ deleted: boolean }>(`/pool/items/${encodeURIComponent(poolId)}`, {
      method: 'DELETE',
    }),

  /** Nạp một hồ sơ có sẵn trong kho vào phiên quét (file đã nằm trên máy chủ) */
  addItemFromPool: (jobId: string, poolId: string, clientDossierId: string, hasHandwriting: boolean) =>
    request<BatchItem & { poolId: string }>(`/batch/jobs/${jobId}/items/from-pool`, {
      method: 'POST',
      body: JSON.stringify({ poolId, clientDossierId, hasHandwriting }),
    }),

  // ---- Quản lý tài khoản (chỉ admin gọi được) ----

  accounts: () => request<AccountListResponse>('/users'),

  createAccount: (body: {
    username: string
    password: string
    fullName: string
    role: string
  }) => request<{ saved: boolean }>('/users', { method: 'POST', body: JSON.stringify(body) }),

  updateAccount: (
    username: string,
    body: { password?: string | null; fullName?: string; role: string },
  ) =>
    request<{ saved: boolean }>(`/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: JSON.stringify({ username, ...body }),
    }),

  deleteAccount: (username: string) =>
    request<{ deleted: boolean }>(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
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
