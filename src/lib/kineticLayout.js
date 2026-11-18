import {
  prepareRichInline,
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange
} from '@chenglou/pretext/rich-inline'

// float layout params for expanded project media
export const floatGutter = 28
export const floatMarginTop = 14
export const floatMarginBottom = 14
export const minWrapWidth = 220

// trailing-line optimization params (runts)
export const prettyTailMaxLines = 4
export const prettyMaxStepBacks = 3
export const prettyMinLineFill = 0.3
export const prettyWidthStepEpsilon = 0.1

export const underlineStrokeWidth = 4
export const underlineOffsetRatio = 0.12
export const glyphOriginYRatio = 0.54
export const detailLinksGapRatio = 0.55
export const detailBottomGapRatio = 0.55
export const detailSupGapRatio = 0.16
export const sectionTopGapRatio = 0.52
export const olderProjectRowGapRatio = 0.24

// solve cubic-bezier(0.22, 1, 0.36, 1) matching the css reflow curve
const cbX1 = 0.22
const cbY1 = 1
const cbX2 = 0.36
const cbY2 = 1
const cbCx = 3 * cbX1
const cbBx = 3 * (cbX2 - cbX1) - cbCx
const cbAx = 1 - cbCx - cbBx
const cbCy = 3 * cbY1
const cbBy = 3 * (cbY2 - cbY1) - cbCy
const cbAy = 1 - cbCy - cbBy

const schemePattern = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

export const evalReflowEase = t => {
  if (t <= 0) {
    return 0
  }

  if (t >= 1) {
    return 1
  }

  let u = t

  for (let i = 0; i < 5; i++) {
    const x = ((cbAx * u + cbBx) * u + cbCx) * u - t
    const dx = (3 * cbAx * u + 2 * cbBx) * u + cbCx

    if (Math.abs(dx) < 1e-6) {
      break
    }

    u = Math.max(0, Math.min(1, u - x / dx))
  }

  return ((cbAy * u + cbBy) * u + cbCy) * u
}

export const getMediaAspect = entry => {
  const img = entry.media?.img

  if (img && img.w && img.h) {
    return img.w / img.h
  }

  return entry.aspect || 1
}

export const hasDescender = c =>
  c === 'g' || c === 'j' || c === 'p' || c === 'q' || c === 'y'

export const isInteractiveToken = token =>
  token.kind === 'button' ||
  token.kind === 'link' ||
  token.kind === 'section-toggle' ||
  token.kind === 'project-toggle'

export const hasScheme = href => schemePattern.test(href || '')

export const isSvelteKitRoute = node =>
  !node.external && !hasScheme(node.href) && !(node.href || '').startsWith('#')

export const opensNewTab = node =>
  typeof node.external === 'boolean' ? node.external : hasScheme(node.href)

/** Normalize shorthand copy entries (strings, links, buttons, sections, projects) into typed nodes. */
export const normalizeCopy = rawCopy => {
  const list = Array.isArray(rawCopy) ? rawCopy : [rawCopy]

  return list.map((node, index) => {
    if (typeof node === 'string') {
      return {kind: 'text', key: `node-${index}`, text: node}
    }

    if (node.kind) {
      return {
        key:
          node.key ??
          (node.sectionId
            ? `s-${node.sectionId}`
            : node.projectId
              ? `p-${node.projectId}`
              : `node-${index}`),
        ...node
      }
    }

    if (node.sectionId) {
      return {kind: 'section', key: `s-${node.sectionId}`, ...node}
    }

    if (node.projectId) {
      return {kind: 'project', key: `p-${node.projectId}`, ...node}
    }

    if (node.href) {
      return {kind: 'link', key: `node-${index}`, ...node}
    }

    if (node.onclick) {
      return {kind: 'button', key: `node-${index}`, ...node}
    }

    return {kind: 'text', key: `node-${index}`, ...node}
  })
}

export const getParentSectionId = (sections, id) => {
  if (!sections) {
    return null
  }

  for (const [secId, sec] of Object.entries(sections)) {
    if (Array.isArray(sec?.projectIds) && sec.projectIds.includes(id)) {
      return secId
    }
  }

  return null
}

export const buildWarmSpecs = (nodes, projects = {}, sections = {}) => {
  const specs = []

  for (const node of nodes) {
    if (node.kind === 'section' && sections[node.sectionId]) {
      specs.push([node.sectionId])
      const childIds = sections[node.sectionId]?.projectIds

      if (Array.isArray(childIds)) {
        for (const subId of childIds) {
          if (projects[subId]) {
            specs.push([node.sectionId, subId])
          }
        }
      }
    } else if (node.kind === 'project' && projects[node.projectId]) {
      specs.push([node.projectId])
    }
  }

  return specs
}

const transformUnderlinePoint = (glyph, localX, dyLocal, originX, originY) => {
  const px0 = glyph.x + glyph.width * 0.5
  const py0 = glyph.y + glyph.lineHeight * glyphOriginYRatio

  if (glyph.tx === 0 && glyph.ty === 0 && glyph.angle === 0) {
    return {
      x: px0 + localX - originX,
      y: py0 + dyLocal - originY
    }
  }

  const rad = (glyph.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  return {
    x: px0 + glyph.tx + localX * cos - dyLocal * sin - originX,
    y: py0 + glyph.ty + localX * sin + dyLocal * cos - originY
  }
}

const catmullRomControlPoints = (p0, p1, p2, p3) => {
  const d1 = Math.max(1e-4, Math.hypot(p1.x - p0.x, p1.y - p0.y) ** 0.5)
  const d2 = Math.max(1e-4, Math.hypot(p2.x - p1.x, p2.y - p1.y) ** 0.5)
  const d3 = Math.max(1e-4, Math.hypot(p3.x - p2.x, p3.y - p2.y) ** 0.5)

  const d1Sq = d1 * d1
  const d2Sq = d2 * d2
  const d3Sq = d3 * d3

  const denom1 = 3 * d1 * (d1 + d2)
  const denom2 = 3 * d3 * (d2 + d3)

  const w1 = 2 * d1Sq + 3 * d1 * d2 + d2Sq
  const w2 = 2 * d3Sq + 3 * d2 * d3 + d2Sq

  return {
    c1x: (d1Sq * p2.x - d2Sq * p0.x + w1 * p1.x) / denom1,
    c1y: (d1Sq * p2.y - d2Sq * p0.y + w1 * p1.y) / denom1,
    c2x: (d3Sq * p1.x - d2Sq * p3.x + w2 * p2.x) / denom2,
    c2y: (d3Sq * p1.y - d2Sq * p3.y + w2 * p2.y) / denom2
  }
}

export const buildUnderlinePath = run => {
  const {glyphs, x: originX, y: originY, restPath} = run
  let atRest = true

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]

    if (g.tx !== 0 || g.ty !== 0 || g.angle !== 0) {
      atRest = false
      break
    }
  }

  if (atRest) {
    return restPath
  }

  const dyLocal = run.underlineOffset - run.pivotOffsetY
  const first = glyphs[0]
  const last = glyphs[glyphs.length - 1]
  const pts = [
    transformUnderlinePoint(
      first,
      -first.width * 0.5,
      dyLocal,
      originX,
      originY
    )
  ]

  for (let i = 0; i < glyphs.length; i++) {
    pts.push(transformUnderlinePoint(glyphs[i], 0, dyLocal, originX, originY))
  }

  pts.push(
    transformUnderlinePoint(last, last.width * 0.5, dyLocal, originX, originY)
  )

  const n = pts.length
  const prevPhantom = {
    x: 2 * pts[0].x - pts[1].x,
    y: 2 * pts[0].y - pts[1].y
  }
  const nextPhantom = {
    x: 2 * pts[n - 1].x - pts[n - 2].x,
    y: 2 * pts[n - 1].y - pts[n - 2].y
  }

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`

  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? prevPhantom : pts[i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = i + 2 >= n ? nextPhantom : pts[i + 2]
    const {c1x, c1y, c2x, c2y} = catmullRomControlPoints(p0, p1, p2, p3)

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }

  return d
}

const buildLinkTokens = (ownerPrefix, links, activeSection) => {
  const linkTokens = []

  links.forEach((link, linkIndex) => {
    if (linkIndex > 0) {
      linkTokens.push({
        kind: 'text',
        key: `${ownerPrefix}-lsep-${linkIndex}`,
        text: ' ',
        styleRole: 'detailLinkGap',
        activeSection
      })
    }

    linkTokens.push({
      kind: 'sup',
      key: `${ownerPrefix}-sup-${linkIndex}`,
      text: `${linkIndex + 1}`,
      styleRole: 'detailSup',
      activeSection
    })

    linkTokens.push({
      kind: 'link',
      key: `${ownerPrefix}-link-${linkIndex}`,
      text: link.label,
      href: link.href,
      external: link.external,
      styleRole: 'detailLink',
      activeSection
    })
  })

  return linkTokens
}

export const buildExpandedProjectSegments = (project, activeSection = true) => {
  const segments = [
    {
      kind: 'expanded-media',
      key: `p-${project.id}-media`,
      ownerId: project.id,
      projectId: project.id,
      media: project.media,
      alt: project.alt,
      aspect: project.aspect,
      expandedSize: project.expandedSize,
      activeSection
    }
  ]

  const hasLinks = Array.isArray(project.links) && project.links.length > 0

  segments.push({
    kind: 'flow',
    ownerId: project.id,
    clearExpandedFloat: !hasLinks,
    tokens: [
      {
        kind: 'text',
        key: `p-${project.id}-details`,
        text: project.details,
        styleRole: 'detail',
        activeSection
      }
    ]
  })

  if (hasLinks) {
    segments.push({
      kind: 'flow',
      ownerId: project.id,
      marginTopRole: 'detailLink',
      marginTopRatio: detailLinksGapRatio,
      clearExpandedFloat: true,
      tokens: buildLinkTokens(`p-${project.id}`, project.links, activeSection)
    })
  }

  return segments
}

const buildDetailSectionSegments = (
  sectionId,
  section,
  activeSection = true
) => {
  const hasLinks = Array.isArray(section.links) && section.links.length > 0
  const segments = [
    {
      kind: 'flow',
      ownerId: sectionId,
      marginTopRole: 'detail',
      marginTopRatio: sectionTopGapRatio,
      clearExpandedFloat: !hasLinks,
      tokens: [
        {
          kind: 'text',
          key: `s-${sectionId}-details`,
          text: section.details,
          styleRole: 'detail',
          activeSection
        }
      ]
    }
  ]

  if (hasLinks) {
    segments.push({
      kind: 'flow',
      ownerId: sectionId,
      marginTopRole: 'detailLink',
      marginTopRatio: detailLinksGapRatio,
      clearExpandedFloat: true,
      tokens: buildLinkTokens(`s-${sectionId}`, section.links, activeSection)
    })
  }

  return segments
}

const buildProjectListSegments = (
  sectionId,
  projectIds,
  projects,
  expandedSet,
  isExpanded
) => {
  const segments = []
  let prevSubExpanded = false

  projectIds.forEach((subId, subIndex) => {
    const subProject = projects[subId]

    if (!subProject) {
      return
    }

    const subExpanded = isExpanded && expandedSet.has(subProject.id)
    const isFirst = subIndex === 0
    const isLast = subIndex === projectIds.length - 1
    const rowTokens = [
      {
        kind: 'project-toggle',
        key: `p-${subProject.id}-toggle`,
        projectId: subProject.id,
        text: subProject.name,
        styleRole: 'olderProject',
        expanded: subExpanded,
        activeSection: isExpanded
      }
    ]

    if (!subExpanded) {
      rowTokens.push({
        kind: 'text',
        key: `p-${subProject.id}-nbsp`,
        text: '\u00A0',
        styleRole: 'olderProject',
        activeSection: isExpanded
      })
      rowTokens.push({
        kind: 'media',
        key: `p-${subProject.id}-media`,
        projectId: subProject.id,
        media: subProject.media,
        alt: subProject.alt,
        aspect: subProject.aspect,
        styleRole: 'olderProject',
        expanded: false,
        activeSection: isExpanded
      })
    }

    let marginTopRole = null
    let marginTopRatio = 0

    if (isFirst) {
      marginTopRole = 'detail'
      marginTopRatio = sectionTopGapRatio
    } else if (!prevSubExpanded) {
      marginTopRole = 'olderProject'
      marginTopRatio = olderProjectRowGapRatio
    }

    segments.push({
      kind: 'flow',
      ownerId: sectionId,
      marginTopRole,
      marginTopRatio,
      clearExpandedFloat: isLast && !subExpanded,
      tokens: rowTokens
    })

    if (subExpanded) {
      segments.push(...buildExpandedProjectSegments(subProject, true))
    }

    prevSubExpanded = subExpanded
  })

  return segments
}

const buildSectionSegments = (sectionId, section, projects, expandedSet) => {
  if (!section) {
    return []
  }

  if (section.details) {
    return buildDetailSectionSegments(sectionId, section, true)
  }

  if (Array.isArray(section.projectIds)) {
    return buildProjectListSegments(
      sectionId,
      section.projectIds,
      projects,
      expandedSet,
      true
    )
  }

  return []
}

export const buildLayoutSegments = (
  nodes,
  projects = {},
  sections = {},
  expandedSet = new Set()
) => {
  const segments = []
  let currentFlow = []
  let afterExpanded = false

  const flushFlow = (extra = {}) => {
    if (currentFlow.length === 0) {
      return
    }

    segments.push({kind: 'flow', tokens: currentFlow, ...extra})
    currentFlow = []
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (node.kind === 'section') {
      afterExpanded = false
      const section = sections[node.sectionId]
      const expanded = Boolean(section) && expandedSet.has(node.sectionId)

      currentFlow.push({
        kind: 'section-toggle',
        key: `s-${node.sectionId}-toggle`,
        sectionId: node.sectionId,
        text: node.text,
        expanded,
        activeSection: expanded
      })

      if (!expanded) {
        if (nodes[i + 1]?.kind === 'text' && nodes[i + 1].text === '.') {
          currentFlow.push({
            ...nodes[i + 1],
            afterHiddenId: node.sectionId
          })
          i++
        } else {
          currentFlow[currentFlow.length - 1].afterHiddenId = node.sectionId
        }

        continue
      }

      if (nodes[i + 1]?.kind === 'text' && nodes[i + 1].text === '.') {
        currentFlow.push(nodes[i + 1])
        i++
      }

      flushFlow()
      segments.push(
        ...buildSectionSegments(node.sectionId, section, projects, expandedSet)
      )
      afterExpanded = true
      continue
    }

    if (node.kind !== 'project') {
      if (afterExpanded) {
        afterExpanded = false

        if (node.kind === 'text') {
          const match = node.text.match(/^[,\s]+/)
          const offset = match ? match[0].length : 0
          const trimmed = node.text.slice(offset)

          if (!trimmed || trimmed === '.') {
            continue
          }

          currentFlow.push({
            ...node,
            text: trimmed,
            sourceOffset: (node.sourceOffset ?? 0) + offset
          })
          continue
        }
      }

      currentFlow.push(node)
      continue
    }

    afterExpanded = false
    const project = projects[node.projectId]

    if (!project) {
      continue
    }

    const expanded = expandedSet.has(project.id)

    currentFlow.push({
      kind: 'project-toggle',
      key: `p-${project.id}-toggle`,
      projectId: project.id,
      text: project.name,
      expanded,
      activeSection: expanded
    })

    if (!expanded) {
      currentFlow.push({
        kind: 'text',
        key: `p-${project.id}-nbsp`,
        text: '\u00A0'
      })
      currentFlow.push({
        kind: 'media',
        key: `p-${project.id}-media`,
        projectId: project.id,
        media: project.media,
        alt: project.alt,
        aspect: project.aspect,
        expanded: false,
        afterHiddenId: project.id
      })
      continue
    }

    flushFlow()
    segments.push(...buildExpandedProjectSegments(project, true))
    afterExpanded = true
  }

  flushFlow()

  return segments
}

export const readTypography = (el, ctx, bodyFontSize = null) => {
  const style = getComputedStyle(el)
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const fontSize = parseFloat(style.fontSize)
  const parsedLineHeight = parseFloat(style.lineHeight)
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : fontSize * 1.25
  const parsedLetterSpacing = parseFloat(style.letterSpacing)
  const letterSpacing = Number.isFinite(parsedLetterSpacing)
    ? parsedLetterSpacing
    : 0
  const parsedBaselineShift = parseFloat(style.verticalAlign)
  const baselineShift = Number.isFinite(parsedBaselineShift)
    ? parsedBaselineShift
    : 0
  const parsedMaxWidth = parseFloat(style.maxWidth)
  const maxWidth =
    Number.isFinite(parsedMaxWidth) && parsedMaxWidth > 0
      ? parsedMaxWidth
      : null

  ctx.font = font

  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = letterSpacing ? `${letterSpacing}px` : '0.000001px'
  }

  const fontMetrics = ctx.measureText('Hg')
  const fontAscent = Number.isFinite(fontMetrics.fontBoundingBoxAscent)
    ? fontMetrics.fontBoundingBoxAscent
    : fontSize * 0.8
  const fontDescent = Number.isFinite(fontMetrics.fontBoundingBoxDescent)
    ? fontMetrics.fontBoundingBoxDescent
    : fontSize * 0.25
  const baselineOffset = (lineHeight + fontAscent - fontDescent) / 2
  const scale = bodyFontSize ? fontSize / bodyFontSize : 1
  const strokeWidth = Math.max(
    1.5,
    Math.round(underlineStrokeWidth * scale * 2) / 2
  )
  const underlineOffset =
    baselineOffset + fontSize * underlineOffsetRatio + strokeWidth * 0.5
  const pivotOffsetY = lineHeight * glyphOriginYRatio

  return {
    font,
    fontSize,
    lineHeight,
    letterSpacing,
    baselineShift,
    maxWidth,
    baselineOffset,
    underlineOffset,
    strokeWidth,
    pivotOffsetY
  }
}

export const getStyleKey = styles =>
  [
    'body',
    'name',
    'detail',
    'detailLink',
    'detailSup',
    'detailLinkGap',
    'olderProject'
  ]
    .map(role => {
      const s = styles[role]
      return `${s.font}|${s.letterSpacing}|${s.lineHeight}|${s.baselineShift}|${s.maxWidth ?? ''}`
    })
    .join(';')

export const prepareSegmentList = (segments, styles, cache) => {
  const supGap = Math.round(styles.detailLink.fontSize * detailSupGapRatio)

  return segments.map(segment => {
    if (segment.kind !== 'flow') {
      return segment
    }

    const sig = segment.tokens
      .map(t => `${t.key}:${t.kind}:${t.styleRole ?? ''}:${t.text ?? ''}`)
      .join('|')
    let prepared = cache[sig]

    if (!prepared) {
      const richItems = segment.tokens.map((token, tokenIndex) => {
        if (token.kind === 'media') {
          const mediaStyle = styles[token.styleRole || 'body']
          return {text: '', font: mediaStyle.font}
        }

        const roleStyle = styles[token.styleRole || 'body']
        const entry = {text: token.text, font: roleStyle.font}

        if (roleStyle.letterSpacing) {
          entry.letterSpacing = roleStyle.letterSpacing
        }

        const nextToken = segment.tokens[tokenIndex + 1]

        if (nextToken?.kind === 'media') {
          const mediaStyle = styles[nextToken.styleRole || 'body']
          entry.extraWidth = mediaStyle.lineHeight * getMediaAspect(nextToken)
        } else if (token.styleRole === 'detailSup' && supGap > 0) {
          entry.extraWidth = supGap
        }

        return entry
      })

      prepared = prepareRichInline(richItems)
      cache[sig] = prepared
    }

    return {
      ...segment,
      prepared
    }
  })
}

export const sameCursor = (a, b) =>
  a.itemIndex === b.itemIndex &&
  a.segmentIndex === b.segmentIndex &&
  a.graphemeIndex === b.graphemeIndex

const isSingleUnitLine = (prepared, range) => {
  const {fragments} = materializeRichInlineLineRange(prepared, range)

  if (fragments.length === 0) {
    return false
  }

  let text = ''

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]

    if (i > 0 && frag.gapBefore > 0 && text.replace(/^[ \t]+/, '').length > 0) {
      text += ' '
    }

    text += frag.text
  }

  const trimmed = text.replace(/^[ \t]+|[ \t]+$/g, '')
  return trimmed.length > 0 && !/[ \t]/.test(trimmed)
}

// Mirrors CSS `text-wrap: pretty` over the last few lines of a segment when
// greedy wrapping leaves a lone word/unit on the final line.
export const rebalancePrettyTail = (prepared, lines, stepLine) => {
  const lineCount = lines.length

  if (
    lineCount < 2 ||
    !isSingleUnitLine(prepared, lines[lineCount - 1].range)
  ) {
    return lines
  }

  const tailCount = Math.min(prettyTailMaxLines, lineCount)
  const tailStart = lineCount - tailCount
  const tailStartCursor =
    tailStart === 0
      ? {itemIndex: 0, segmentIndex: 0, graphemeIndex: 0}
      : lines[tailStart - 1].range.end
  const tailStartY = lines[tailStart].y

  let bestTail = null
  let bestScore = Infinity
  const chosen = new Array(tailCount)

  const search = (depth, lineCursor, y) => {
    if (depth === tailCount - 1) {
      const last = stepLine(lineCursor, y)

      if (!last || isSingleUnitLine(prepared, last.range)) {
        return
      }

      // Keep total line count invariant: reject breaks that spill an extra line.
      const overflow = layoutNextRichInlineLineRange(
        prepared,
        Infinity,
        last.range.end
      )

      if (overflow && !sameCursor(overflow.end, last.range.end)) {
        return
      }

      let score = 0

      for (let i = 0; i < tailCount - 1; i++) {
        const line = chosen[i]
        const slack = line.maxWidth - line.range.width
        score += slack * slack

        if (line.singleUnit) {
          score += 1e7
        }
      }

      if (score < bestScore) {
        bestScore = score
        chosen[depth] = last
        bestTail = chosen.slice()
      }

      return
    }

    const greedy = stepLine(lineCursor, y)

    if (!greedy) {
      return
    }

    const candidates = [
      {
        ...greedy,
        singleUnit: isSingleUnitLine(prepared, greedy.range)
      }
    ]
    let probeFrom = candidates[0]

    for (let step = 0; step < prettyMaxStepBacks; step++) {
      if (probeFrom.range.end.graphemeIndex > 0 || probeFrom.singleUnit) {
        break
      }

      const probeWidth = probeFrom.range.width - prettyWidthStepEpsilon
      const minWidth = Math.max(1, probeFrom.maxWidth * prettyMinLineFill)

      if (probeWidth < minWidth) {
        break
      }

      const alt = stepLine(lineCursor, y, probeWidth)

      if (
        !alt ||
        alt.range.end.graphemeIndex > 0 ||
        sameCursor(alt.range.end, probeFrom.range.end) ||
        alt.range.width < minWidth
      ) {
        break
      }

      const altCandidate = {
        ...alt,
        singleUnit: isSingleUnitLine(prepared, alt.range)
      }
      candidates.push(altCandidate)
      probeFrom = altCandidate
    }

    for (let c = 0; c < candidates.length; c++) {
      const cand = candidates[c]
      chosen[depth] = cand
      search(depth + 1, cand.range.end, cand.y + cand.lineHeight)
    }
  }

  search(0, tailStartCursor, tailStartY)

  if (!bestTail) {
    return lines
  }

  const updated = lines.slice(0, tailStart)

  for (let i = 0; i < bestTail.length; i++) {
    updated.push({
      ...bestTail[i],
      lineIndex: lines[tailStart + i].lineIndex
    })
  }

  return updated
}

export const measureFragmentGlyphs = (
  ctx,
  styles,
  role,
  text,
  segmenter,
  cache
) => {
  const cacheKey = `${role}\0${text}`
  const cached = cache[cacheKey]

  if (cached) {
    return cached
  }

  const s = styles[role]
  ctx.font = s.font

  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = s.letterSpacing ? `${s.letterSpacing}px` : '0.000001px'
  }

  const metrics = []

  for (const {segment, index} of segmenter.segment(text)) {
    const prefixWidth = ctx.measureText(
      text.slice(0, index + segment.length)
    ).width
    const glyphWidth = ctx.measureText(segment).width
    metrics.push({
      char: segment,
      index,
      relX: prefixWidth - glyphWidth,
      width: glyphWidth,
      isSpace: /^\s+$/.test(segment)
    })
  }

  cache[cacheKey] = metrics
  return metrics
}

export const placeExpandedMediaFloat = (
  seg,
  maxWidth,
  currentY,
  maxFloatBottom,
  placedFloats
) => {
  const aspect = getMediaAspect(seg)
  const boxWidth = Math.min(seg.expandedSize, maxWidth)
  const boxHeight = boxWidth / aspect
  const sideBySide = maxWidth - boxWidth - floatGutter >= minWrapWidth
  const boxY = Math.max(
    currentY + floatMarginTop,
    maxFloatBottom + floatMarginTop
  )
  const clearBottom = boxY + boxHeight + floatMarginBottom
  const nextMaxFloatBottom = Math.max(maxFloatBottom, boxY + boxHeight)

  if (sideBySide) {
    placedFloats.push({
      x: 0,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      clearBottom
    })
  }

  return {
    boxX: 0,
    boxY,
    boxWidth,
    boxHeight,
    clearBottom,
    nextMaxFloatBottom,
    nextY: sideBySide ? boxY : clearBottom
  }
}

export const layoutFlowSegmentLines = (
  seg,
  activeStyles,
  maxWidth,
  placedFloats,
  startY,
  startLineIndex
) => {
  const segBaseRole = seg.marginTopRole || seg.tokens[0]?.styleRole || 'body'
  const segStyleMaxWidth =
    segBaseRole !== 'body' && segBaseRole !== 'name'
      ? activeStyles[segBaseRole]?.maxWidth
      : null
  let checkLineHeight = activeStyles[segBaseRole].lineHeight

  for (let t = 0; t < seg.tokens.length; t++) {
    const tStyle = activeStyles[seg.tokens[t].styleRole || 'body']

    if (tStyle.lineHeight > checkLineHeight) {
      checkLineHeight = tStyle.lineHeight
    }
  }

  const stepSegmentLine = (lineCursor, y, overrideMaxWidth = null) => {
    let lineOffsetX = 0

    for (let p = 0; p < placedFloats.length; p++) {
      const fl = placedFloats[p]

      if (y + checkLineHeight > fl.y && y < fl.clearBottom) {
        const rightEdge = fl.x + fl.width + floatGutter

        if (rightEdge > lineOffsetX) {
          lineOffsetX = rightEdge
        }
      }
    }

    const availableWidth = maxWidth - lineOffsetX
    const lineMaxWidth = Math.max(
      1,
      segStyleMaxWidth
        ? Math.min(availableWidth, segStyleMaxWidth)
        : availableWidth
    )
    const limitWidth =
      overrideMaxWidth === null
        ? lineMaxWidth
        : Math.min(lineMaxWidth, overrideMaxWidth)
    const range = layoutNextRichInlineLineRange(
      seg.prepared,
      limitWidth,
      lineCursor
    )

    if (!range || sameCursor(range.end, lineCursor)) {
      return null
    }

    let rowBaseline = 0
    let rowBelow = 0

    for (let f = 0; f < range.fragments.length; f++) {
      const frag = range.fragments[f]
      const fragRole = seg.tokens[frag.itemIndex]?.styleRole || 'body'
      const fragStyle = activeStyles[fragRole]
      const above = fragStyle.baselineOffset + fragStyle.baselineShift
      const below =
        fragStyle.lineHeight -
        fragStyle.baselineOffset -
        fragStyle.baselineShift

      if (above > rowBaseline) {
        rowBaseline = above
      }

      if (below > rowBelow) {
        rowBelow = below
      }
    }

    let rowHeight = rowBaseline + rowBelow

    if (rowHeight === 0) {
      rowHeight = checkLineHeight
      rowBaseline =
        activeStyles[segBaseRole].baselineOffset +
        activeStyles[segBaseRole].baselineShift
    }

    return {
      range,
      y,
      lineHeight: rowHeight,
      lineBaseline: rowBaseline,
      offsetX: lineOffsetX,
      maxWidth: lineMaxWidth
    }
  }

  let currentY = startY
  let localLineIndex = startLineIndex
  let cursor = {itemIndex: 0, segmentIndex: 0, graphemeIndex: 0}
  const greedyLines = []

  while (true) {
    const line = stepSegmentLine(cursor, currentY)

    if (!line) {
      break
    }

    greedyLines.push({
      ...line,
      lineIndex: localLineIndex++
    })
    currentY += line.lineHeight
    cursor = line.range.end
  }

  const flowLines = rebalancePrettyTail(
    seg.prepared,
    greedyLines,
    stepSegmentLine
  )

  if (flowLines.length > 0) {
    const lastLine = flowLines[flowLines.length - 1]
    currentY = lastLine.y + lastLine.lineHeight
  }

  return {
    flowLines,
    nextY: currentY,
    nextLineIndex: localLineIndex
  }
}

export const formatTransform = (tx, ty, angle, sx = 1, sy = 1) => {
  if (tx === 0 && ty === 0 && angle === 0 && sx === 1 && sy === 1) {
    return ''
  }

  let str = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`

  if (angle !== 0) {
    str += ` rotate(${angle.toFixed(3)}deg)`
  }

  if (sx !== 1 || sy !== 1) {
    str += ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
  }

  return str
}

export const computeWordTransform = word =>
  `translate3d(${(word.visX ?? word.x).toFixed(2)}px, ${(word.visY ?? word.y).toFixed(2)}px, 0)`

export const computeUnderlineTransform = run =>
  `translate3d(${(run.visX ?? run.x).toFixed(2)}px, ${(run.visY ?? run.y).toFixed(2)}px, 0)`

export const computeGlyphTransform = glyph =>
  formatTransform(glyph.tx ?? 0, glyph.ty ?? 0, glyph.angle ?? 0)

export const computeBoxTransform = box => {
  const domW = box.domWidth ?? box.width
  const domH = box.domHeight ?? box.height
  const cx = box.visCx ?? box.x + box.width * 0.5
  const cy = box.visCy ?? box.y + box.height * 0.5

  return formatTransform(
    cx - domW * 0.5 + (box.tx ?? 0),
    cy - domH * 0.5 + (box.ty ?? 0),
    box.angle ?? 0,
    box.curReflowSx ?? 1,
    box.curReflowSy ?? 1
  )
}
