import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename, dirname, extname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = resolve(rootDir, 'media-src')
const outDir = resolve(rootDir, 'src/lib/media')
const manifestPath = resolve(outDir, 'manifest.json')
const indexJsPath = resolve(outDir, 'index.js')

const pipelineVersion = 2
const imageWidths = [120, 260, 520]
const maxVideoBox = 520
const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])
const videoExts = new Set(['.mp4', '.mov', '.webm', '.m4v'])

const toCamelIdentifier = stem =>
  stem
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, ch) => ch.toUpperCase())
    .replace(/^[^a-zA-Z_$]+/, '')

const hashFile = filePath =>
  createHash('sha256').update(readFileSync(filePath)).digest('hex')

const probeVideoStream = filePath => {
  const raw = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,sample_aspect_ratio',
      '-of',
      'json',
      filePath
    ],
    {encoding: 'utf8'}
  )
  const parsed = JSON.parse(raw)
  const stream = parsed.streams?.[0]

  if (!stream || !stream.width || !stream.height) {
    throw new Error(`Unable to probe dimensions for ${filePath}`)
  }

  return {width: Number(stream.width), height: Number(stream.height)}
}

const runFfmpegAtomic = (args, targetPath) => {
  const ext = extname(targetPath)
  const tempPath = join(
    tmpdir(),
    `oxism-media-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
  )

  try {
    execFileSync('ffmpeg', ['-v', 'error', ...args, tempPath], {
      stdio: 'inherit'
    })
    copyFileSync(tempPath, targetPath)
  } finally {
    rmSync(tempPath, {force: true})
  }
}

const computeScaledDims = (srcW, srcH, boxSize, evenOnly = false) => {
  const scale = Math.min(1, boxSize / Math.max(srcW, srcH))
  let w = Math.max(1, Math.round(srcW * scale))
  let h = Math.max(1, Math.round(srcH * scale))

  if (evenOnly) {
    w = Math.max(2, w - (w % 2))
    h = Math.max(2, h - (h % 2))
  }

  return {width: w, height: h}
}

const processImage = (inputPath, stem, dims) => {
  const maxSrcSide = Math.max(dims.width, dims.height)
  const widths = imageWidths.filter(w => w <= maxSrcSide)

  if (widths.length === 0) {
    widths.push(maxSrcSide)
  }

  const variants = []

  for (const box of widths) {
    const scaled = computeScaledDims(dims.width, dims.height, box, false)
    const avifFile = `${stem}-${box}w.avif`
    const webpFile = `${stem}-${box}w.webp`
    const vf = `scale=${box}:${box}:force_original_aspect_ratio=decrease:flags=lanczos+bitexact,setsar=1`

    runFfmpegAtomic(
      [
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map_metadata',
        '-1',
        '-vf',
        vf,
        '-frames:v',
        '1',
        '-c:v',
        'libaom-av1',
        '-still-picture',
        '1',
        '-crf',
        '28',
        '-cpu-used',
        '6',
        '-threads',
        '1',
        '-fflags',
        '+bitexact',
        '-flags:v',
        '+bitexact'
      ],
      resolve(outDir, avifFile)
    )

    runFfmpegAtomic(
      [
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map_metadata',
        '-1',
        '-vf',
        vf,
        '-frames:v',
        '1',
        '-c:v',
        'libwebp',
        '-quality',
        '82',
        '-compression_level',
        '6',
        '-threads',
        '1',
        '-fflags',
        '+bitexact',
        '-flags:v',
        '+bitexact'
      ],
      resolve(outDir, webpFile)
    )

    variants.push({
      width: scaled.width,
      height: scaled.height,
      avif: avifFile,
      webp: webpFile
    })
  }

  const largest = variants[variants.length - 1]
  return {
    kind: 'image',
    width: largest.width,
    height: largest.height,
    aspect: Number((dims.width / dims.height).toFixed(6)),
    variants,
    files: variants.flatMap(v => [v.avif, v.webp])
  }
}

let cachedHasSvtAv1 = null

const hasSvtAv1Encoder = () => {
  if (cachedHasSvtAv1 === null) {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8'
    })
    cachedHasSvtAv1 = /\blibsvtav1\b/.test(out)
  }

  return cachedHasSvtAv1
}

const processVideo = (inputPath, stem, dims) => {
  const scaled = computeScaledDims(dims.width, dims.height, maxVideoBox, true)
  const webmFile = `${stem}.webm`
  const mp4File = `${stem}.mp4`
  const vf = `scale=${maxVideoBox}:${maxVideoBox}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos+bitexact,setsar=1`
  const av1CodecArgs = hasSvtAv1Encoder()
    ? [
        '-c:v',
        'libsvtav1',
        '-preset',
        '5',
        '-crf',
        '48',
        '-svtav1-params',
        'tune=0:lp=1'
      ]
    : [
        '-c:v',
        'libaom-av1',
        '-crf',
        '42',
        '-b:v',
        '0',
        '-cpu-used',
        '6',
        '-threads',
        '1'
      ]

  runFfmpegAtomic(
    [
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-an',
      '-map_metadata',
      '-1',
      '-vf',
      vf,
      ...av1CodecArgs,
      '-pix_fmt',
      'yuv420p',
      '-g',
      '240',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact'
    ],
    resolve(outDir, webmFile)
  )

  runFfmpegAtomic(
    [
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-an',
      '-map_metadata',
      '-1',
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'veryslow',
      '-crf',
      '25',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-threads',
      '1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact'
    ],
    resolve(outDir, mp4File)
  )

  return {
    kind: 'video',
    width: scaled.width,
    height: scaled.height,
    aspect: Number((dims.width / dims.height).toFixed(6)),
    webm: webmFile,
    mp4: mp4File,
    files: [webmFile, mp4File]
  }
}

const generateIndexModule = entries => {
  const imports = []
  const exports = []

  for (const {id, record} of entries) {
    if (record.kind === 'image') {
      const avifParts = []
      const webpParts = []

      record.variants.forEach((v, idx) => {
        const avifVar = `${id}Avif${idx}`
        const webpVar = `${id}Webp${idx}`
        imports.push(`import ${avifVar} from './${v.avif}'`)
        imports.push(`import ${webpVar} from './${v.webp}'`)
        avifParts.push(`\${${avifVar}} ${v.width}w`)
        webpParts.push(`\${${webpVar}} ${v.width}w`)
      })

      const fallbackVar = `${id}Webp${record.variants.length - 1}`
      const prefetchVar = `${id}Avif${Math.min(1, record.variants.length - 1)}`

      exports.push(`export const ${id} = {
  kind: 'image',
  width: ${record.width},
  height: ${record.height},
  aspect: ${record.aspect},
  avifSrcset: \`${avifParts.join(', ')}\`,
  webpSrcset: \`${webpParts.join(', ')}\`,
  src: ${fallbackVar},
  prefetchUrl: ${prefetchVar}
}`)
    } else {
      const webmVar = `${id}Webm`
      const mp4Var = `${id}Mp4`
      imports.push(`import ${webmVar} from './${record.webm}'`)
      imports.push(`import ${mp4Var} from './${record.mp4}'`)

      exports.push(`export const ${id} = {
  kind: 'video',
  width: ${record.width},
  height: ${record.height},
  aspect: ${record.aspect},
  webm: ${webmVar},
  mp4: ${mp4Var}
}`)
    }
  }

  return `${imports.join('\n')}\n\n${exports.join('\n\n')}\n`
}

const run = () => {
  mkdirSync(outDir, {recursive: true})

  let prevManifest = {version: 0, assets: {}}

  if (existsSync(manifestPath)) {
    try {
      prevManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      prevManifest = {version: 0, assets: {}}
    }
  }

  const sourceFiles = readdirSync(srcDir)
    .filter(name => !name.startsWith('.'))
    .sort()

  const nextAssets = {}
  const exportedEntries = []
  const expectedFiles = new Set(['index.js', 'manifest.json'])

  for (const fileName of sourceFiles) {
    const ext = extname(fileName).toLowerCase()
    const isImage = imageExts.has(ext)
    const isVideo = videoExts.has(ext)

    if (!isImage && !isVideo) {
      continue
    }

    const inputPath = resolve(srcDir, fileName)
    const stem = basename(fileName, extname(fileName))
    const id = toCamelIdentifier(stem)
    const sha256 = hashFile(inputPath)
    const cached =
      prevManifest.version === pipelineVersion
        ? prevManifest.assets?.[fileName]
        : null

    let record = cached

    if (
      !cached ||
      cached.sha256 !== sha256 ||
      !cached.files.every(f => existsSync(resolve(outDir, f)))
    ) {
      console.log(`Optimizing ${fileName}...`)
      const dims = probeVideoStream(inputPath)
      const built = isImage
        ? processImage(inputPath, stem, dims)
        : processVideo(inputPath, stem, dims)
      record = {sha256, ...built}
    }

    nextAssets[fileName] = record
    exportedEntries.push({id, record})

    for (const f of record.files) {
      expectedFiles.add(f)
    }
  }

  for (const existing of readdirSync(outDir)) {
    if (!expectedFiles.has(existing)) {
      rmSync(resolve(outDir, existing), {force: true})
    }
  }

  writeFileSync(
    manifestPath,
    `${JSON.stringify({version: pipelineVersion, assets: nextAssets}, null, 2)}\n`
  )
  writeFileSync(indexJsPath, generateIndexModule(exportedEntries))
  console.log(`Media manifest ready (${exportedEntries.length} source assets).`)
}

run()
