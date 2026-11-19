import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {minify} from 'html-minifier'
import {build} from 'vite'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = resolve(rootDir, 'build')

const minifyHtml = html =>
  minify(html, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    decodeEntities: true,
    ignoreCustomComments: [/^\s*\[/, /^\s*\]/],
    minifyCSS: true,
    minifyJS: true,
    removeComments: true,
    removeOptionalTags: false,
    removeRedundantAttributes: true,
    sortAttributes: true
  })

const injectPage = (template, {page, title, head, body}) => {
  let html = template

  if (page === '404') {
    html = html.replace(/<link[^>]+eb-garamond-600i\.woff2[^>]*>/g, '')
  }

  return minifyHtml(
    html
      .replace('<!--ssr-title-->', title)
      .replace('<!--ssr-head-->', head || '')
      .replace('<!--ssr-page-->', page)
      .replace('<!--ssr-body-->', body)
  )
}

const run = async () => {
  const ssrTempDir = join(tmpdir(), `oxism-ssr-${process.pid}-${Date.now()}`)
  mkdirSync(ssrTempDir, {recursive: true})

  try {
    await build({root: rootDir})
    await build({
      root: rootDir,
      build: {
        ssr: 'src/entry-server.js',
        outDir: ssrTempDir,
        copyPublicDir: false,
        emptyOutDir: true
      }
    })

    const ssrEntryUrl = pathToFileURL(
      resolve(ssrTempDir, 'entry-server.js')
    ).href
    const {renderPage} = await import(ssrEntryUrl)
    const shell = readFileSync(resolve(buildDir, 'index.html'), 'utf8')

    const homeRendered = renderPage('home')
    const notFoundRendered = renderPage('404')

    const [homeHtml, notFoundHtml] = await Promise.all([
      injectPage(shell, {
        page: 'home',
        title: 'Dan Motzenbecker',
        head: homeRendered.head,
        body: homeRendered.body
      }),
      injectPage(shell, {
        page: '404',
        title: 'Four-o-four',
        head: notFoundRendered.head,
        body: notFoundRendered.body
      })
    ])

    writeFileSync(resolve(buildDir, 'index.html'), homeHtml)
    writeFileSync(resolve(buildDir, '404.html'), notFoundHtml)
    writeFileSync(resolve(buildDir, '.nojekyll'), '')
  } finally {
    rmSync(ssrTempDir, {recursive: true, force: true})
  }
}

run()
