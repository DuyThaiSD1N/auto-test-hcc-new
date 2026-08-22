import type { BatchField } from '../api/types'

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

interface Props {
  fields: BatchField[]
  onChange: (fields: BatchField[]) => void
}

/** Danh sách trường bóc tách sửa được — dùng chung cho màn gán nhãn và worklist. */
export default function FieldsEditor({ fields, onChange }: Props) {
  const setStringValue = (index: number, value: string) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, value } : f)))
  }
  const setAreaValue = (index: number, areaKey: string, value: string) => {
    onChange(
      fields.map((f, i) =>
        i === index
          ? { ...f, value: { ...(f.value as Record<string, unknown>), [areaKey]: value } }
          : f,
      ),
    )
  }

  return (
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
  )
}
