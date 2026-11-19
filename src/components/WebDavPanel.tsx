import { useState } from 'react'
import { buildBackup, parseBackup, restoreBackup } from '../services/backup'
import {
  webdavDownload,
  webdavList,
  webdavTest,
  webdavUpload,
  WEBDAV_FILE_NAME,
  type WebDavConfig,
} from '../services/webdav'
import { useSettings } from '../store/settings'

/**
 * WebDAV 云备份 —— 把整份数据（材料、图片、卡片、复习记录）传到坚果云 /
 * Nextcloud 之类的网盘，再从那里恢复。
 */
export function WebDavPanel() {
  const settings = useSettings((state) => state.settings)
  const save = useSettings((state) => state.save)

  const [url, setUrl] = useState(settings.webdavUrl)
  const [username, setUsername] = useState(settings.webdavUsername)
  const [password, setPassword] = useState(settings.webdavPassword)
  const [busy, setBusy] = useState<'test' | 'backup' | 'restore' | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState(WEBDAV_FILE_NAME)

  const config = (): WebDavConfig => ({ url: url.trim(), username: username.trim(), password })

  const requireConfig = (): boolean => {
    if (!url.trim()) {
      setError('请先填写 WebDAV 地址')
      return false
    }
    return true
  }

  const handleSave = async () => {
    await save({ webdavUrl: url.trim(), webdavUsername: username.trim(), webdavPassword: password })
    setStatus('云盘设置已保存（保存在本地）。')
  }

  const handleTest = async () => {
    if (!requireConfig()) return
    setBusy('test')
    setError(null)
    setStatus(null)
    try {
      await webdavTest(config())
      setStatus('连接成功，地址和账号都没问题。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleBackup = async () => {
    if (!requireConfig()) return
    setBusy('backup')
    setError(null)
    setStatus(null)
    try {
      const backup = await buildBackup()
      const content = JSON.stringify(backup, null, 2)
      await webdavUpload(config(), WEBDAV_FILE_NAME, content)
      setStatus(
        `已备份到云盘：${backup.cards.length} 张卡片、${backup.reviewLogs.length} 条复习记录` +
          `（${(content.length / 1024).toFixed(0)} KB）。`,
      )
      setFiles(await webdavList(config()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async () => {
    if (!requireConfig()) return
    setBusy('restore')
    setError(null)
    setStatus(null)
    try {
      const listed = files.length > 0 ? files : await webdavList(config())
      const names = listed.length > 0 ? listed : [WEBDAV_FILE_NAME]
      setFiles(names)
      const name = selectedFile && names.includes(selectedFile)
        ? selectedFile
        : names.includes(WEBDAV_FILE_NAME)
          ? WEBDAV_FILE_NAME
          : names[names.length - 1]
      const content = await webdavDownload(config(), name)
      const backup = parseBackup(content)
      const counts = await restoreBackup(backup)
      setStatus(
        `已从云盘恢复（${name}）：${counts.cards} 张卡片、${counts.reviewLogs} 条复习记录、` +
          `${counts.sources} 份材料。`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel">
      <h2>WebDAV 云备份</h2>
      <p className="muted small">
        坚果云、Nextcloud 等支持 WebDAV 的网盘都可以。备份包含全部内容（材料、图片、卡片、复习记录），
        账号密码只保存在这台设备上，不会随备份文件导出。
      </p>

      <label className="field">
        <span className="field-label">WebDAV 地址</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://dav.jianguoyun.com/dav/"
          disabled={busy !== null}
        />
        <span className="field-help">
          填到网盘的 WebDAV 目录即可，备份会写成 {WEBDAV_FILE_NAME}。
        </span>
      </label>

      <label className="field">
        <span className="field-label">账号</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="邮箱或用户名"
          autoComplete="username"
          disabled={busy !== null}
        />
      </label>

      <label className="field">
        <span className="field-label">密码 / 应用密码</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="建议使用网盘的应用密码"
          autoComplete="current-password"
          disabled={busy !== null}
        />
        <span className="field-help">
          坚果云需要在「安全选项」里生成一个应用密码，用它更安全。
        </span>
      </label>

      <div className="row-actions">
        <button type="button" className="btn" onClick={handleSave} disabled={busy !== null}>
          保存设置
        </button>
        <button type="button" className="btn" onClick={handleTest} disabled={busy !== null}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleBackup} disabled={busy !== null}>
          {busy === 'backup' ? '备份中…' : '备份到云盘'}
        </button>
        <button type="button" className="btn" onClick={handleRestore} disabled={busy !== null}>
          {busy === 'restore' ? '恢复中…' : '从云盘恢复'}
        </button>
      </div>

      {files.length > 1 && (
        <label className="field">
          <span className="field-label">要恢复的备份文件</span>
          <select
            value={selectedFile}
            onChange={(event) => setSelectedFile(event.target.value)}
            disabled={busy !== null}
          >
            {files.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      {status && <div className="alert alert-ok">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </section>
  )
}
