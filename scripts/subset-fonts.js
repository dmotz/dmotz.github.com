import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import garamondGlyphs from '../src/lib/glyphs.js'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(rootDir, 'static/fonts')

const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const buildPrintableAscii = () => {
  let chars = ''

  for (let code = 32; code <= 126; code++) {
    chars += String.fromCharCode(code)
  }

  return chars
}

const uniqueSortedChars = str =>
  [...new Set(str)].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('')

const fetchSubsetWoff2 = async (spec, text) => {
  const cssUrl = `https://fonts.googleapis.com/css2?family=EB+Garamond:${spec}&text=${encodeURIComponent(text)}`
  const cssRes = await fetch(cssUrl, {headers: {'User-Agent': userAgent}})

  if (!cssRes.ok) {
    throw new Error(`Google Fonts CSS request failed (${cssRes.status})`)
  }

  const css = await cssRes.text()
  const match = css.match(/url\((https:\/\/[^)]+)\)/)

  if (!match) {
    throw new Error(`Could not locate WOFF2 URL in stylesheet:\n${css}`)
  }

  const fontRes = await fetch(match[1], {headers: {'User-Agent': userAgent}})

  if (!fontRes.ok) {
    throw new Error(`Font download failed (${fontRes.status})`)
  }

  return Buffer.from(await fontRes.arrayBuffer())
}

const run = async () => {
  const allRippleAlts = Object.values(garamondGlyphs).flat().join('')
  const extraPunctuation = '\u00A0\u2013\u2014\u2018\u2019\u201C\u201D\u21D2'
  const romanText = uniqueSortedChars(
    buildPrintableAscii() + extraPunctuation + allRippleAlts
  )

  const nameSeed = 'Dan Motzenbecker'
  const nameRippleAlts = [...nameSeed]
    .flatMap(ch => garamondGlyphs[ch] || [ch])
    .join('')
  const italicText = uniqueSortedChars(`${nameSeed} ${nameRippleAlts}`)

  mkdirSync(outDir, {recursive: true})

  const [romanBuf, italicBuf] = await Promise.all([
    fetchSubsetWoff2('wght@400', romanText),
    fetchSubsetWoff2('ital,wght@1,600', italicText)
  ])

  const romanPath = resolve(outDir, 'eb-garamond-400.woff2')
  const italicPath = resolve(outDir, 'eb-garamond-600i.woff2')
  writeFileSync(romanPath, romanBuf)
  writeFileSync(italicPath, italicBuf)

  console.log(
    `Wrote eb-garamond-400.woff2 (${romanBuf.byteLength} B) and eb-garamond-600i.woff2 (${italicBuf.byteLength} B)`
  )
}

run()
