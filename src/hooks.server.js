import {minify} from 'html-minifier'
import {building} from '$app/environment'

export function handle({event, resolve}) {
  let page = ''

  return resolve(event, {
    transformPageChunk: ({html, done}) => {
      page += html

      if (done) {
        return building
          ? minify(page, {
              collapseBooleanAttributes: true,
              collapseWhitespace: true,
              decodeEntities: true,
              minifyCSS: true,
              minifyJS: true,
              removeComments: true,
              removeOptionalTags: true,
              removeRedundantAttributes: true,
              removeScriptTypeAttributes: true,
              removeStyleLinkTypeAttributes: true,
              sortAttributes: true,
              sortClassName: true
            })
          : page
      }
    }
  })
}
