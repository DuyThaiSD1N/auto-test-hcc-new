import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { BatchField, LabelStatus, Procedure, WorklistItem, WorklistResponse } from '../api/types'
import FieldsEditor from '../components/FieldsEditor'
import AppLayout from '../components/AppLayout'

const STATUS_LABEL: Record<LabelStatus, string> = {
  pending: 'Chưa gán',
  draft: 'Đang sửa',
  done: 'Hoàn thiện',
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('vi-VN')
}

type Filter = 'all' | LabelStatus

export default function LabelsPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()

  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [data, setData] = useState<WorklistResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  // Dòng đang mở để sửa: itemId -> trạng thái sửa
  const [editing, setEditing] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<BatchField[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.procedure(key).then(setProcedure).catch(() => setProcedure(null))
  }, [key])

  const load = useCallback(() => {
    setLoading(true)
    api
      .labelsByProcedure(key)
      .then((res) => {
        setData(res)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không tải được danh sách'))
      .finally(() => setLoading(false))
  }, [key])

  useEffect(load, [load])

  const items = useMemo(() => {
    const all = data?.items ?? []
    return filter === 'all' ? all : all.filter((x) => x.status === filter)
  }, [data, filter])

  const counts = data?.counts ?? { total: 0, pending: 0, draft: 0, done: 0 }
  const percent = counts.total ? Math.round((counts.done / counts.total) * 100) : 0

  // ------------------------------------------------------------ sửa tại chỗ

  async function openEdit(it: WorklistItem) {
    if (editing === it.itemId) {
      setEditing(null)
      return
    }
    setEditing(it.itemId)
    setEditFields([])
    setEditLoading(true)
    try {
      // Ưu tiên nhãn đã lưu; chưa có thì lấy kết quả bóc tách làm nền để sửa
      const saved = await api.getLabel(it.itemId).catch(() => null)
      if (saved) {
        setEditFields(saved.fields)
      } else {
        const res = await api.itemResult(it.itemId).catch(() => null)
        const hist = res ? null : await api.historyResult(it.itemId).catch(() => null)
        setEditFields((res?.result ?? hist?.result)?.fields ?? [])
      }
    } finally {
      setEditLoading(false)
    }
  }

  async function persist(it: WorklistItem, status: 'draft' | 'done') {
    setSaving(true)
    setError(null)
    try {
      await api.saveLabel(it.itemId, {
        fields: editFields,
        procedure: key,
        clientDossierId: it.clientDossierId,
        status,
      })
      setEditing(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được nhãn')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout
      title={`Gán nhãn — ${procedure?.label ?? key}`}
      subtitle="Sửa dữ liệu bóc tách cho đúng rồi đánh dấu hoàn thiện"
      actions={
        <>
          <Link to={`/thu-tuc/${key}`} className="ghost-btn">
            Quét hồ sơ mới
          </Link>
          <button className="ghost-btn" onClick={load}>
            Tải lại
          </button>
        </>
      }
    >
        {!data?.enabled && !loading && (
          <div className="alert warn">
            Chưa bật MongoDB (<code>APP_MONGO_URI</code>) nên không có worklist.
          </div>
        )}
        {error && <div className="alert error">{error}</div>}

        {/* Tiến trình */}
        <section className="panel">
          <div className="panel-head">
            <h2>Tiến trình gán nhãn</h2>
            <span className="counter">
              {counts.done}/{counts.total} hoàn thiện ({percent}%)
            </span>
          </div>
          <div className="progress-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="progress-legend">
              <button className={`chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
                Tất cả {counts.total}
              </button>
              <button
                className={`chip${filter === 'pending' ? ' active' : ''}`}
                onClick={() => setFilter('pending')}
              >
                Chưa gán {counts.pending}
              </button>
              <button
                className={`chip${filter === 'draft' ? ' active' : ''}`}
                onClick={() => setFilter('draft')}
              >
                Đang sửa {counts.draft}
              </button>
              <button
                className={`chip${filter === 'done' ? ' active' : ''}`}
                onClick={() => setFilter('done')}
              >
                Hoàn thiện {counts.done}
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Hồ sơ</h2>
            <span className="counter">{loading ? 'Đang tải…' : `${items.length} hồ sơ`}</span>
          </div>

          {!loading && items.length === 0 ? (
            <div className="empty">Không có hồ sơ nào ở trạng thái này.</div>
          ) : (
            <div className="table-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>Trạng thái</th>
                    <th>Số trường</th>
                    <th>Người gán</th>
                    <th>Cập nhật</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const open = editing === it.itemId
                    return (
                      <Fragment key={it.itemId}>
                        <tr className={open ? 'row-open' : ''}>
                          <td>{it.clientDossierId || it.itemId}</td>
                          <td>
                            <span className={`status-pill s-${it.status}`}>
                              {STATUS_LABEL[it.status]}
                            </span>
                          </td>
                          <td>{it.labeled ? it.labelFieldCount : it.resultFieldCount}</td>
                          <td>{it.labeledBy ?? '—'}</td>
                          <td className="muted-small">{formatTime(it.labeledAt)}</td>
                          <td className="row-actions">
                            <button
                              className="ghost-btn"
                              onClick={() => openEdit(it)}
                              disabled={!it.hasResult && !it.labeled}
                            >
                              {open ? 'Đóng' : 'Sửa'}
                            </button>
                            <button
                              className="ghost-btn"
                              onClick={() => navigate(`/thu-tuc/${key}/eform?item=${it.itemId}`)}
                            >
                              Form + JSON
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={6}>
                              {editLoading ? (
                                <p className="muted-small">Đang tải dữ liệu…</p>
                              ) : (
                                <div className="inline-edit">
                                  <FieldsEditor fields={editFields} onChange={setEditFields} />
                                  <div className="label-actions row">
                                    <button
                                      className="ghost-btn"
                                      onClick={() => persist(it, 'draft')}
                                      disabled={saving}
                                    >
                                      Lưu nháp
                                    </button>
                                    <button
                                      className="primary-btn inline"
                                      onClick={() => persist(it, 'done')}
                                      disabled={saving}
                                    >
                                      {saving ? 'Đang lưu…' : 'Lưu & hoàn thiện'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
    </AppLayout>
  )
}
