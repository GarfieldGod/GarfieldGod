// 极简 ZIP 打包器：只用 Node 内置 zlib 做 deflate，不引第三方依赖。
// 够用即可——文章导出是几十上百个文本小文件，不需要 zip64 / 加密 / 分卷。
import { deflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** 归档内路径，一律用正斜杠，如 `文章标题.md` */
  name: string
  data: string | Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

/** DOS 时间戳：ZIP 头里用的是 1980 纪元的本地时间 */
function dosStamp(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time: time & 0xffff, date: date & 0xffff }
}

/** 清掉路径分隔符与控制字符，并挡掉 `..`，避免解压时把文件写到目标目录之外 */
function safeName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim())
    .filter((s) => s && s !== '.' && s !== '..')
  return parts.join('/') || 'unnamed'
}

export function buildZip(entries: ZipEntry[], when = new Date()): Buffer {
  const { time, date } = dosStamp(when)
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(safeName(entry.name), 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const crc = crc32(raw)

    // 文本压得动就 deflate，压不动（比如已经是二进制）退回 store
    const deflated = deflateRawSync(raw)
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // 文件名按 UTF-8 解释
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra 长度
    chunks.push(local, nameBuf, body)

    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4) // version made by
    head.writeUInt16LE(20, 6) // version needed
    head.writeUInt16LE(0x0800, 8)
    head.writeUInt16LE(method, 10)
    head.writeUInt16LE(time, 12)
    head.writeUInt16LE(date, 14)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(body.length, 20)
    head.writeUInt32LE(raw.length, 24)
    head.writeUInt16LE(nameBuf.length, 28)
    head.writeUInt16LE(0, 30) // extra
    head.writeUInt16LE(0, 32) // comment
    head.writeUInt16LE(0, 34) // 起始磁盘号
    head.writeUInt16LE(0, 36) // 内部属性
    head.writeUInt32LE(0, 38) // 外部属性
    head.writeUInt32LE(offset, 42) // 本地头偏移
    central.push(head, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // 注释长度

  return Buffer.concat([...chunks, centralBuf, end])
}