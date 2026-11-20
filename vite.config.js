import {existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'

const rootDir = dirname(fileURLToPath(import.meta.url))

const injectSsrMarkup = (template, {page, title, head, body}) => {
  let html = template

  if (page === '404') {
    html = html.replace(
      /\s*<link[^>]+eb-garamond-600i\.woff2[^>]*>\s*/g,
      '\n    '
    )
  }

  return html
    .replace('<!--ssr-title-->', title)
    .replace('<!--ssr-head-->', head || '')
    .replace('<!--ssr-page-->', page)
    .replace('<!--ssr-body-->', body)
}

const isAssetRequest = pathname =>
  pathname.startsWith('/@') ||
  pathname.startsWith('/src/') ||
  pathname.startsWith('/node_modules/') ||
  /\.[a-z0-9]+$/i.test(pathname)

const oxismRoutesPlugin = () => ({
  name: 'oxism-routes',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next()
        return
      }

      const url = req.url || '/'
      const pathname = url.split('?')[0]

      if (
        pathname !== '/' &&
        pathname !== '/index.html' &&
        isAssetRequest(pathname)
      ) {
        next()
        return
      }

      const staticCandidate = resolve(rootDir, 'static', pathname.slice(1))

      if (pathname !== '/' && existsSync(staticCandidate)) {
        next()
        return
      }

      try {
        const isHome = pathname === '/' || pathname === '/index.html'
        const page = isHome ? 'home' : '404'
        const title = isHome ? 'Dan Motzenbecker' : 'Four-o-four'
        const rawTemplate = readFileSync(resolve(rootDir, 'index.html'), 'utf8')
        const transformed = await server.transformIndexHtml(url, rawTemplate)
        const {renderPage} = await server.ssrLoadModule('/src/entry-server.js')
        const rendered = renderPage(page)
        const html = injectSsrMarkup(transformed, {
          page,
          title,
          head: rendered.head,
          body: rendered.body
        })

        res.statusCode = isHome ? 200 : 404
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(html)
      } catch (err) {
        server.ssrFixStacktrace(err)
        next(err)
      }
    })
  },
  configurePreviewServer(server) {
    const buildDir = resolve(rootDir, 'build')

    server.middlewares.use((req, res, next) => {
      const pathname = (req.url || '/').split('?')[0]

      if (pathname === '/' || pathname === '/index.html') {
        next()
        return
      }

      const candidate = resolve(buildDir, pathname.slice(1))

      if (existsSync(candidate)) {
        next()
        return
      }

      const notFoundHtml = resolve(buildDir, '404.html')

      if (existsSync(notFoundHtml)) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(readFileSync(notFoundHtml))
        return
      }

      next()
    })
  }
})

const treeshakeOptions = {
  propertyReadSideEffects: false,
  unknownGlobalSideEffects: false
}

export default defineConfig(({isSsrBuild}) => ({
  publicDir: 'static',
  server: {
    port: 3333,
    host: '::',
    allowedHosts: true
  },
  preview: {
    host: '::',
    allowedHosts: true
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: false,
    ...(isSsrBuild
      ? {}
      : {
          rolldownOptions: {
            optimization: {
              inlineConst: true
            },
            treeshake: treeshakeOptions,
            output: {
              comments: false,
              topLevelVar: false,
              minify: {
                compress: {
                  target: 'esnext',
                  dropConsole: true,
                  dropDebugger: true,
                  treeshake: treeshakeOptions
                },
                mangle: {
                  toplevel: true
                },
                codegen: {
                  legalComments: 'none'
                }
              }
            }
          }
        })
  },
  plugins: [
    svelte({
      compilerOptions: {
        discloseVersion: false,
        cssHash: ({hash, css}) => `s${hash(css).slice(0, 3)}`
      }
    }),
    oxismRoutesPlugin()
  ]
}))
