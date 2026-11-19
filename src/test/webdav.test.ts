import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  joinUrl,
  webdavDownload,
  webdavEnsureFolder,
  webdavList,
  webdavTest,
  webdavUpload,
  WEBDAV_FILE_NAME,
  type WebDavConfig,
} from '../services/webdav'

const config: WebDavConfig = {
  url: 'https://dav.example.com/dav/',
  username: 'user@example.com',
  password: 'secret',
}

let calls: Array<{ url: string; method: string; headers: Record<string, string> }> = []

function mockFetch(handler: (url: string, method: string) => Response | Promise<Response>) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, method, headers })
    return handler(url, method)
  })
  return spy
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('地址拼接', () => {
  it('不会重复斜杠', () => {
    expect(joinUrl('https://x.com/dav/', 'file.json')).toBe('https://x.com/dav/file.json')
    expect(joinUrl('https://x.com/dav', 'file.json')).toBe('https://x.com/dav/file.json')
    expect(joinUrl('https://x.com/dav//', '/file.json')).toBe('https://x.com/dav/file.json')
  })
})

describe('WebDAV', () => {
  it('测试连接会带上基本认证', async () => {
    mockFetch(() => new Response('', { status: 207 }))

    await webdavTest(config)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PROPFIND')
    expect(calls[0].url).toBe('https://dav.example.com/dav/')
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${btoa('user@example.com:secret')}`,
    )
  })

  it('连接失败时给出可读的错误', async () => {
    mockFetch(() => new Response('nope', { status: 401, statusText: 'Unauthorized' }))

    await expect(webdavTest(config)).rejects.toThrow(/401/)
  })

  it('创建目录时忽略「已经存在」', async () => {
    mockFetch(() => new Response('', { status: 405 }))
    await expect(webdavEnsureFolder(config, 'savememory')).resolves.toBeUndefined()
    expect(calls[0].method).toBe('MKCOL')
  })

  it('上传文件用 PUT', async () => {
    mockFetch(() => new Response('', { status: 201 }))

    await webdavUpload(config, WEBDAV_FILE_NAME, '{"hello":true}')

    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(`https://dav.example.com/dav/${WEBDAV_FILE_NAME}`)
  })

  it('上传失败时给出可读的错误', async () => {
    mockFetch(() => new Response('denied', { status: 403, statusText: 'Forbidden' }))
    await expect(webdavUpload(config, 'a.json', '{}')).rejects.toThrow(/403/)
  })

  it('下载文件返回文本', async () => {
    mockFetch(() => new Response('{"format":"savememory-backup"}', { status: 200 }))

    const content = await webdavDownload(config, WEBDAV_FILE_NAME)

    expect(content).toContain('savememory-backup')
    expect(calls[0].method).toBe('GET')
  })

  it('列出云端的备份文件', async () => {
    mockFetch(
      () =>
        new Response(
          `<?xml version="1.0"?>
           <d:multistatus xmlns:d="DAV:">
             <d:response><d:href>/dav/savememory-backup.json</d:href></d:response>
             <d:response><d:href>/dav/old%20backup.json</d:href></d:response>
             <d:response><d:href>/dav/notes.txt</d:href></d:response>
           </d:multistatus>`,
          { status: 207 },
        ),
    )

    const files = await webdavList(config)

    expect(files).toEqual(['old backup.json', 'savememory-backup.json'])
  })

  it('服务器不支持 PROPFIND 时返回空列表而不是报错', async () => {
    mockFetch(() => new Response('', { status: 405 }))
    await expect(webdavList(config)).resolves.toEqual([])
  })
})
