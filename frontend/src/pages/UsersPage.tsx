import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AccountRow } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import AppLayout from '../components/AppLayout'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Quản trị',
  tester: 'Người dùng',
  uploader: 'Tải tài liệu',
}

interface FormState {
  username: string
  fullName: string
  role: string
  password: string
}

const EMPTY_FORM: FormState = { username: '', fullName: '', role: 'tester', password: '' }

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

export default function UsersPage() {
  const { user } = useAuth()

  const [rows, setRows] = useState<AccountRow[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Rỗng = đang tạo mới; có giá trị = đang sửa tài khoản đó
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const load = useCallback(() => {
    setLoading(true)
    api
      .accounts()
      .then((res) => {
        setRows(res.items)
        setEnabled(res.enabled)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không tải được tài khoản'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  function startCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setNotice(null)
  }

  function startEdit(row: AccountRow) {
    setEditing(row.username)
    setForm({ username: row.username, fullName: row.fullName, role: row.role, password: '' })
    setNotice(null)
  }

  async function submit() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (editing) {
        await api.updateAccount(editing, {
          fullName: form.fullName,
          role: form.role,
          // Bỏ trống ô mật khẩu = giữ nguyên mật khẩu cũ
          password: form.password.trim() || null,
        })
        setNotice(`Đã cập nhật tài khoản ${editing}.`)
      } else {
        await api.createAccount({
          username: form.username.trim().toLowerCase(),
          password: form.password,
          fullName: form.fullName.trim() || form.username.trim(),
          role: form.role,
        })
        setNotice(`Đã tạo tài khoản ${form.username.trim().toLowerCase()}.`)
      }
      setForm(EMPTY_FORM)
      setEditing(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được tài khoản')
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: AccountRow) {
    setError(null)
    setNotice(null)
    try {
      await api.deleteAccount(row.username)
      setNotice(`Đã xóa tài khoản ${row.username}.`)
      if (editing === row.username) startCreate()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được tài khoản')
    }
  }

  const canSubmit = editing
    ? Boolean(form.fullName.trim())
    : Boolean(form.username.trim()) && form.password.trim().length >= 6

  return (
    <AppLayout
      title="Tài khoản"
      subtitle="Tạo tài khoản, đặt lại mật khẩu và phân quyền cho người vào thử nghiệm"
      actions={
        <>
          <button className="ghost-btn" onClick={load}>
            Tải lại
          </button>
          <button className="primary-btn inline" onClick={startCreate}>
            + Tài khoản mới
          </button>
        </>
      }
    >
      {!enabled && (
        <div className="alert warn">
          Chưa bật MongoDB (<code>APP_MONGO_URI</code>) nên không tạo được tài khoản. Hiện chỉ dùng
          được tài khoản dự phòng từ biến môi trường.
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

      {notice && <div className="alert ok">{notice}</div>}

      <div className="content">
        <div className="list-pane">
          <section className="panel">
            <div className="panel-head">
              <h2>Danh sách tài khoản</h2>
              <span className="counter">{loading ? 'Đang tải…' : `${rows.length} tài khoản`}</span>
            </div>

            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Quyền</th>
                    <th>Cập nhật</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.username} className={editing === row.username ? 'row-open' : ''}>
                      <td>
                        <div>{row.fullName}</div>
                        <span className="muted-small mono">@{row.username}</span>
                        {row.username === user?.username && (
                          <span className="tag-default">bạn</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-pill s-${
                            row.role === 'admin'
                              ? 'completed'
                              : row.role === 'uploader'
                                ? 'draft'
                                : 'pending'
                          }`}
                        >
                          {ROLE_LABEL[row.role] ?? row.role}
                        </span>
                      </td>
                      <td className="muted-small">
                        {row.source === 'env' ? 'biến môi trường' : formatTime(row.updatedAt)}
                      </td>
                      <td className="row-actions">
                        {row.source === 'env' ? (
                          <span className="muted-small">sửa trong backend/.env</span>
                        ) : (
                          <>
                            <button className="ghost-btn" onClick={() => startEdit(row)}>
                              Sửa
                            </button>
                            <button
                              className="ghost-btn danger"
                              onClick={() => remove(row)}
                              disabled={row.username === user?.username}
                              title={
                                row.username === user?.username
                                  ? 'Không thể tự xóa tài khoản đang dùng'
                                  : 'Xóa tài khoản'
                              }
                            >
                              Xóa
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty">Chưa có tài khoản nào.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="detail-pane">
          <div className="detail-card">
            <span className="detail-eyebrow">{editing ? 'Sửa tài khoản' : 'Tạo tài khoản'}</span>
            <h2>{editing ? `@${editing}` : 'Tài khoản mới'}</h2>

            <label className="field">
              <span>Tên đăng nhập</span>
              <input
                type="text"
                value={form.username}
                disabled={Boolean(editing)}
                placeholder="vd: canbo2"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Họ tên hiển thị</span>
              <input
                type="text"
                value={form.fullName}
                placeholder="vd: Nguyễn Văn A"
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Quyền</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="tester">Người dùng — chạy thử, gán nhãn</option>
                <option value="uploader">Tải tài liệu — chỉ vào kho, tải và phân loại hồ sơ</option>
                <option value="admin">Quản trị — thêm cả tài khoản và xóa dữ liệu</option>
              </select>
            </label>

            <label className="field">
              <span>{editing ? 'Mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu'}</span>
              <input
                type="text"
                value={form.password}
                placeholder="ít nhất 6 ký tự"
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>

            <div className="label-actions row">
              {editing && (
                <button className="ghost-btn" onClick={startCreate}>
                  Hủy
                </button>
              )}
              <button
                className="primary-btn inline"
                onClick={submit}
                disabled={saving || !canSubmit || !enabled}
              >
                {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo tài khoản'}
              </button>
            </div>

            <p className="muted-small" style={{ marginTop: 14 }}>
              <strong>Người dùng</strong> chạy được phiên quét, gán nhãn và xem lịch sử.{' '}
              <strong>Tải tài liệu</strong> chỉ vào Kho tài liệu để tải hồ sơ lên và phân loại theo
              thủ tục. <strong>Quản trị</strong> có thêm quyền tạo/xóa tài khoản, xóa nhãn và xóa
              phiên trong lịch sử.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
