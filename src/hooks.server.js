import {minify} from 'html-minifier'
import {building} from '$app/environment'

export async function handle({event, resolve}) {
  let page = ''

  return resolve(event, {
    transformPageChunk: ({html, done}) => {
      page += html

      if (done) {
        return building
          ? minify(page, {
              collapseBooleanAttributes: true,
              collapseWhitespace: true,
              conservativeCollapse: false,
              decodeEntities: true,
              html5: true,
              minifyCSS: true,
              minifyJS: true,
              removeAttributeQuotes: false,
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
