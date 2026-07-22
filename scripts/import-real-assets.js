#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const ENV_ID = 'cloud-2ge02vrucaf8a6ab'
const CLI = path.join(ROOT, 'tmp/node-tools/node_modules/.bin/cloudbase')
const TMP = path.join(ROOT, 'tmp/import_assets')
const STAGING = path.join(TMP, 'staging')
const REPORT_PATH = path.join(TMP, 'real-assets-import-report.json')
const REMOTE_PREFIX = 'client-assets/20260514'

const SOURCE = {
  audio: path.join(TMP, 'audio'),
  docs: path.join(TMP, 'docs_pdf'),
  wallpapers: path.join(TMP, 'wallpapers'),
  standalonePsd: path.join(ROOT, '未命名作品.psd')
}

function run(args, options = {}) {
  const res = spawnSync(CLI, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
    ...options
  })
  if (res.status !== 0) {
    throw new Error(`cloudbase ${args.join(' ')} failed\n${res.stdout || ''}\n${res.stderr || ''}`)
  }
  return res.stdout || ''
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX') continue
      out.push(...walk(full))
    } else {
      out.push(full)
    }
  }
  return out
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function cleanTitle(file) {
  return path.basename(file).replace(/\.[^.]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/[+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferCategory(title) {
  if (/数量关系|数列|方程|比例|行程|工程|排列组合|概率|容斥|最值|溶液|年龄|周期|日期|利润/.test(title)) return '数量'
  if (/言语|成语|词库|选词|语句|片段|细节判断|逻辑填空|表达/.test(title)) return '言语'
  if (/资料分析|统计|图表|比重|平均数|倍数|速算|ABRX/.test(title)) return '资料'
  if (/申论|公文|作文|材料阅读|归纳概括|综合分析|对策建议|文章素材|审题/.test(title)) return '申论'
  if (/逻辑|定义判断|类比|推理|判断/.test(title)) return '逻辑'
  if (/综应|综合应用/.test(title)) return '综应'
  if (/面试/.test(title)) return '面试'
  return '常识'
}

function materialCategory(title) {
  if (/数量关系/.test(title)) return '数量关系'
  if (/言语理解/.test(title)) return '言语理解'
  if (/资料分析/.test(title)) return '资料分析'
  if (/申论/.test(title)) return '申论'
  if (/逻辑判断|定义判断|类比推理/.test(title)) return '判断推理'
  return '学习资料'
}

function copyAs(files, folder, prefix, ext) {
  const targetDir = path.join(STAGING, folder)
  fs.mkdirSync(targetDir, { recursive: true })
  return files.map((file, index) => {
    const name = `${prefix}-${String(index + 1).padStart(3, '0')}.${ext}`
    const localPath = path.join(targetDir, name)
    fs.copyFileSync(file, localPath)
    return {
      sourcePath: file,
      title: cleanTitle(file),
      localPath,
      fileName: name,
      cloudPath: `${REMOTE_PREFIX}/${folder}/${name}`
    }
  })
}

function convertStandalonePsd() {
  if (!fs.existsSync(SOURCE.standalonePsd)) return []
  const outDir = path.join(TMP, 'standalone_psd')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, '未命名作品.jpg')
  const res = spawnSync('/usr/bin/sips', ['-s', 'format', 'jpeg', SOURCE.standalonePsd, '--out', outFile], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  })
  if (res.status !== 0) {
    console.warn(`未命名作品.psd 转 JPG 失败，跳过：${res.stderr || res.stdout}`)
    return []
  }
  return [outFile]
}

function parseJsonOutput(output) {
  const start = output.indexOf('{')
  if (start < 0) return null
  return JSON.parse(output.slice(start))
}

function getStorageBase() {
  const output = run(['storage', 'url', 'asset-import/probe.txt', '-e', ENV_ID, '--json'])
  const parsed = parseJsonOutput(output)
  const url = parsed && parsed.data && parsed.data.url
  if (!url) throw new Error('无法获取云存储访问域名')
  const parsedUrl = new URL(url)
  return {
    origin: parsedUrl.origin,
    bucket: parsedUrl.hostname.split('.')[0]
  }
}

function fileId(bucket, cloudPath) {
  return `cloud://${ENV_ID}.${bucket}/${cloudPath}`
}

function buildRecords(prepared, origin, bucket) {
  const now = new Date().toISOString()
  const audios = prepared.audio.map((item, index) => {
    const title = item.title
    return {
      _id: `real-audio-${String(index + 1).padStart(3, '0')}`,
      title,
      category: inferCategory(title),
      type: '磨耳朵',
      duration: '',
      fileId: fileId(bucket, item.cloudPath),
      fileUrl: `${origin}/${encodeURI(item.cloudPath)}`,
      enabled: true,
      source: 'client-real-20260514',
      sort: index + 1,
      createdAt: now,
      updatedAt: now
    }
  })

  const materials = prepared.docs.map((item, index) => {
    const title = item.title
    return {
      _id: `real-material-doc-${String(index + 1).padStart(3, '0')}`,
      name: title,
      description: `${title} PDF资料`,
      type: 'document',
      category: materialCategory(title),
      accessType: 'coin',
      coinCost: 10,
      fileId: fileId(bucket, item.cloudPath),
      fileUrl: `${origin}/${encodeURI(item.cloudPath)}`,
      enabled: true,
      source: 'client-real-20260514',
      sort: index + 1,
      createdAt: now,
      updatedAt: now
    }
  })

  const wallpapers = prepared.wallpapers.map((item, index) => {
    const title = item.title
    return {
      _id: `real-wallpaper-${String(index + 1).padStart(3, '0')}`,
      title,
      type: 'default',
      fileId: fileId(bucket, item.cloudPath),
      imageUrl: `${origin}/${encodeURI(item.cloudPath)}`,
      enabled: true,
      source: 'client-real-20260514',
      sort: index + 1,
      createdAt: now,
      updatedAt: now
    }
  })

  return { audios, materials, wallpapers }
}

function executeDb(commands) {
  const json = JSON.stringify(commands)
  const output = run(['db', 'nosql', 'execute', '-e', ENV_ID, '--json', '--command', json])
  return parseJsonOutput(output)
}

function clearCollection(collection) {
  executeDb([{
    TableName: collection,
    CommandType: 'DELETE',
    Command: JSON.stringify({
      delete: collection,
      deletes: [{ q: {}, limit: 0 }]
    })
  }])
}

function insertBatch(collection, documents) {
  for (let i = 0; i < documents.length; i += 20) {
    const batch = documents.slice(i, i + 20)
    executeDb([{
      TableName: collection,
      CommandType: 'INSERT',
      Command: JSON.stringify({
        insert: collection,
        documents: batch
      })
    }])
    console.log(`Inserted ${collection}: ${Math.min(i + batch.length, documents.length)}/${documents.length}`)
  }
}

function countCollection(collection) {
  const res = executeDb([{
    TableName: collection,
    CommandType: 'COMMAND',
    Command: JSON.stringify({ count: collection, query: {} })
  }])
  const item = res.data.results[0][0]
  return Number((item.n && (item.n.$numberInt || item.n.$numberLong)) || item.n || 0)
}

function uploadItems(items, label) {
  if (process.env.SKIP_AUDIO_UPLOAD === '1' && label === 'audio') {
    console.log('Skip audio upload because SKIP_AUDIO_UPLOAD=1')
    return
  }
  if (process.env.SKIP_UPLOAD === '1') {
    console.log(`Skip ${label} upload because SKIP_UPLOAD=1`)
    return
  }
  console.log(`Uploading ${label}: ${items.length} files`)
  items.forEach((item, index) => {
    run(['storage', 'upload', item.localPath, item.cloudPath, '-e', ENV_ID, '--times', '3', '--json'])
    console.log(`Uploaded ${label}: ${index + 1}/${items.length}`)
  })
}

function main() {
  resetDir(STAGING)

  const audioFiles = walk(SOURCE.audio).filter((file) => /\.mp3$/i.test(file)).sort()
  const docFiles = walk(SOURCE.docs).filter((file) => /\.pdf$/i.test(file)).sort()
  const wallpaperFiles = walk(SOURCE.wallpapers)
    .filter((file) => /\.jpe?g$/i.test(file) && !file.includes(`${path.sep}__MACOSX${path.sep}`))
    .sort()
  wallpaperFiles.push(...convertStandalonePsd())

  if (!audioFiles.length || !docFiles.length || !wallpaperFiles.length) {
    throw new Error(`素材不完整：audio=${audioFiles.length}, docs=${docFiles.length}, wallpapers=${wallpaperFiles.length}`)
  }

  const prepared = {
    audio: copyAs(audioFiles, 'audio', 'audio', 'mp3'),
    docs: copyAs(docFiles, 'docs', 'document', 'pdf'),
    wallpapers: copyAs(wallpaperFiles, 'wallpapers', 'wallpaper', 'jpg')
  }

  const storage = getStorageBase()
  const records = buildRecords(prepared, storage.origin, storage.bucket)

  uploadItems(prepared.audio, 'audio')
  uploadItems(prepared.docs, 'docs')
  uploadItems(prepared.wallpapers, 'wallpapers')

  clearCollection('audios')
  clearCollection('materials')
  clearCollection('wallpapers')
  insertBatch('audios', records.audios)
  insertBatch('materials', records.materials)
  insertBatch('wallpapers', records.wallpapers)

  const counts = {
    audios: countCollection('audios'),
    materials: countCollection('materials'),
    wallpapers: countCollection('wallpapers')
  }

  const report = {
    envId: ENV_ID,
    remotePrefix: REMOTE_PREFIX,
    storage,
    counts,
    sourceCounts: {
      audioFiles: audioFiles.length,
      documentFiles: docFiles.length,
      wallpaperFiles: wallpaperFiles.length
    },
    samples: {
      audio: records.audios.slice(0, 3),
      material: records.materials.slice(0, 3),
      wallpaper: records.wallpapers.slice(0, 3)
    },
    generatedAt: new Date().toISOString()
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main()
