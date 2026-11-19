import { useEffect, useState } from 'react'
import { QrCodeView } from './QrCodeView'
import { encodeQr, type QrCode } from '../lib/qrcode'
import {
  applyBundle,
  buildSyncLink,
  buildSyncPayload,
  parseBundle,
  type SyncTier,
} from '../services/sync'
import { useSync } from '../store/sync'

/**
 * 扫码同步 —— 把词库和进度塞进一张二维码。
 *
 * 电脑上生成，手机扫；数据太多时自动去掉复习日志，只同步卡片。
 */
export function SyncPanel() {
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [code, setCode] = useState<QrCode | null>(null)
  const [payload, setPayload] = useState('')
  const [tier, setTier] = useState<SyncTier>('full')
  const [size, setSize] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')

  // A payload that arrived through the URL fragment is picked up here.
  useEffect(() => {
    const pending = useSync.getState().consume()
    if (pending) {
      setPasted(pending)
      setStatus('检测到扫码带过来的同步数据，点「合并到本机」即可导入。')
    }
  }, [])

  const handleGenerate = async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await buildSyncPayload()
      // The link makes the phone open the app straight away; the raw payload
      // is what gets copied by hand.
      const link = buildSyncLink(result.text)
      // Level L keeps the code as sparse as possible, which is what a screen
      // camera copes with best.
      const qr = encodeQr(link, { ecLevel: 'L' })
      setCode(qr)
      setPayload(result.text)
      setTier(result.tier)
      setSize(result.size)
      setStatus(
        result.tier === 'full'
          ? `已生成二维码：${result.counts.cards} 张卡片、${result.counts.reviewLogs} 条复习记录，共 ${result.size} 字节。`
          : `数据太大，已自动去掉复习记录：只同步 ${result.counts.cards} 张卡片，共 ${result.size} 字节。`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCode(null)
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setStatus('同步文本已复制，可以粘贴到另一台设备。')
    } catch {
      setError('复制失败，请手动选中下面的文本复制。')
    }
  }

  const handleImport = async () => {
    if (!pasted.trim()) {
      setError('请先粘贴同步文本')
      return
    }
    setImporting(true)
    setError(null)
    setStatus(null)
    try {
      const bundle = await parseBundle(pasted)
      const result = await applyBundle(bundle)
      setStatus(
        `已合并 ${result.cards} 张卡片（新增 ${result.cards - result.updated}，更新 ${result.updated}）` +
          `、${result.concepts} 个概念、${result.reviewLogs} 条复习记录。`,
      )
      setPasted('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="panel">
      <h2>扫码同步</h2>
      <p className="muted small">
        把词库和复习进度压缩进一张二维码，另一台设备扫码即可接手。数据完全在本机处理，
        不经过任何服务器。
      </p>

      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={busy}>
          {busy ? '生成中…' : '生成二维码'}
        </button>
      </div>

      {code && (
        <div className="qr-wrap">
          <QrCodeView code={code} size={300} title="扫码同步二维码" />
          <div className="qr-side">
            <p className="muted small">
              用手机相机扫码即可打开本页并导入数据；也可以复制下面的文本，手动粘贴到另一台设备的
              「设置 → 扫码同步」里。
            </p>
            <div className="row-actions">
              <button type="button" className="btn btn-small" onClick={handleCopy}>
                复制同步文本
              </button>
              <span className="muted small">
                {size} 字节 · {tier === 'full' ? '含复习记录' : '仅卡片'}
              </span>
            </div>
            <textarea
              className="qr-payload"
              value={payload}
              readOnly
              rows={4}
              aria-label="同步文本"
            />
          </div>
        </div>
      )}

      <details className="sync-import">
        <summary>从同步文本恢复</summary>
        <p className="muted small">
          在另一台设备上复制同步文本，粘贴到这里。已有的内容不会被删除 —— 相同卡片取复习次数更多的
          那一份。
        </p>
        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder="粘贴以 SM1: 开头的同步文本"
          rows={4}
          disabled={importing}
        />
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? '导入中…' : '合并到本机'}
          </button>
        </div>
      </details>

      {status && <div className="alert alert-ok">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </section>
  )
}
