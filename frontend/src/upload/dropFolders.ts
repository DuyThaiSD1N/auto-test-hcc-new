/**
 * Đọc nội dung kéo-thả: nhận NHIỀU thư mục cùng lúc, đi đệ quy vào thư mục con.
 *
 * Dùng File System Entry API (`webkitGetAsEntry`) vì `dataTransfer.files` chỉ trả
 * file rời — kéo cả thư mục vào thì danh sách đó rỗng. Trình duyệt nào không có API
 * này thì lùi về `dataTransfer.files` để ít nhất kéo file lẻ vẫn chạy.
 *
 * Dùng chung cho trang quét và trang kho tài liệu.
 */

export interface NamedFile {
  file: File
  /** Đường dẫn tương đối, vd "ho-so-01/to-khai.pdf" */
  path: string
}

async function walk(entry: FileSystemEntry, prefix: string, out: NamedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    out.push({ file, path: prefix + entry.name })
    return
  }
  if (!entry.isDirectory) return

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  let batch: FileSystemEntry[]
  // readEntries chỉ trả tối đa 100 mục mỗi lần -> phải đọc tới khi hết
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out)
  } while (batch.length)
}

export async function readDropped(dataTransfer: DataTransfer): Promise<NamedFile[]> {
  const entries = Array.from(dataTransfer.items)
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[]

  if (!entries.length) {
    return Array.from(dataTransfer.files).map((file) => ({ file, path: file.name }))
  }

  const out: NamedFile[] = []
  await Promise.all(entries.map((entry) => walk(entry, '', out)))
  return out
}

/**
 * Gom theo thư mục cha trực tiếp: mỗi thư mục = một hồ sơ.
 * File kéo lẻ (không nằm trong thư mục nào) gom vào khóa rỗng.
 */
export function groupByFolder(pairs: NamedFile[]): Map<string, File[]> {
  const byFolder = new Map<string, File[]>()
  for (const { file, path } of pairs) {
    const parts = path.split('/')
    const folder = parts.length >= 2 ? parts[parts.length - 2] : ''
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder)!.push(file)
  }
  return byFolder
}
