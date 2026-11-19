/**
 * A very small WebDAV client.
 *
 * Only what a backup needs: create the folder, put a file, get a file and
 * list the folder. WebDAV servers differ in the details, so every call is
 * forgiving and reports a readable error instead of a raw status code.
 */

export interface WebDavConfig {
  /** The address of the WebDAV directory, e.g. `https://dav.jianguoyun.com/dav/`. */
  url: string
  username: string
  password: string
}

/** The file the backup is written to. */
export const WEBDAV_FILE_NAME = 'savememory-backup.json'

/** Builds the Basic authentication header. */
function authHeader(config: WebDavConfig): string {
  const raw = `${config.username}:${config.password}`
  // `btoa` only accepts latin-1, so the credentials go through UTF-8 first.
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** Joins the base address and a path without doubling the slashes. */
export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '')
  const trimmedPath = path.replace(/^\/+/, '')
  return trimmedPath ? `${trimmedBase}/${trimmedPath}` : `${trimmedBase}/`
}

/** Turns a server response into something worth showing to the user. */
async function describeError(response: Response, action: string): Promise<string> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 200)
  } catch {
    detail = ''
  }
  const status = `${response.status} ${response.statusText}`.trim()
  return `${action}失败：${status}${detail ? ` · ${detail}` : ''}`
}

/** Checks that the address and the credentials work. */
export async function webdavTest(config: WebDavConfig): Promise<void> {
  const url = joinUrl(config.url, '')
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(config),
      Depth: '0',
    },
  })
  if (!response.ok) {
    throw new Error(await describeError(response, '连接测试'))
  }
}

/** Creates the remote folder (ignoring "already exists"). */
export async function webdavEnsureFolder(config: WebDavConfig, path: string): Promise<void> {
  const url = joinUrl(config.url, path)
  const response = await fetch(url, {
    method: 'MKCOL',
    headers: { Authorization: authHeader(config) },
  })
  // 405 means the collection is already there — that is a success for us.
  if (!response.ok && response.status !== 405 && response.status !== 301) {
    throw new Error(await describeError(response, '创建云端目录'))
  }
}

/** Uploads a file, replacing whatever was there before. */
export async function webdavUpload(
  config: WebDavConfig,
  path: string,
  content: string,
): Promise<void> {
  const url = joinUrl(config.url, path)
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: content,
  })
  if (!response.ok) {
    throw new Error(await describeError(response, '上传备份'))
  }
}

/** Downloads a file. */
export async function webdavDownload(
  config: WebDavConfig,
  path: string,
): Promise<string> {
  const url = joinUrl(config.url, path)
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader(config) },
  })
  if (!response.ok) {
    throw new Error(await describeError(response, '下载备份'))
  }
  return response.text()
}

/**
 * Lists the files in the remote folder.
 *
 * Not every server answers PROPFIND, so a failure is not fatal — the caller
 * falls back to the default file name.
 */
export async function webdavList(config: WebDavConfig): Promise<string[]> {
  const url = joinUrl(config.url, '')
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(config),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
  })
  if (!response.ok) return []

  const xml = await response.text()
  const names = new Set<string>()
  const hrefRe = /<(?:[a-z0-9]+:)?href[^>]*>([^<]+)<\/(?:[a-z0-9]+:)?href>/gi
  let match: RegExpExecArray | null
  while ((match = hrefRe.exec(xml)) !== null) {
    const href = match[1].trim()
    const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '')
    if (name.endsWith('.json')) names.add(name)
  }
  return [...names].sort()
}
