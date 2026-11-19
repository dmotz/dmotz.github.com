import {applyCtxFont, prepareFlowTokens} from '#lib/inlineWrap'

export const underlineStrokeWidth = 4
export const underlineOffsetRatio = 0.12
export const glyphOriginYRatio = 0.54
export const detailLinksGapRatio = 0.55
export const detailBottomGapRatio = 0.55
const supAfterGapRatio = 0.22
const supBeforeGapRatio = 0.05
const sectionTopGapRatio = 0.52
const olderProjectRowGapRatio = 0.24
export const externalLinkArrow = '⇒'
const externalLinkArrowAngle = -45

// Typography scale relative to root `.kinetic-body` font-size
const roleSpecs = {
  body: {scale: 1, lineHeightRatio: 1.25},
  name: {
    scale: 1,
    lineHeightRatio: 1.25,
    fontWeight: '600',
    fontStyle: 'italic'
  },
  detail: {scale: 0.56, lineHeightRatio: 1.32, maxCh: 60},
  detailLink: {scale: 0.44, lineHeightRatio: 1.35, maxCh: 50},
  bodySup: {scale: 0.34, lineHeightRatio: 1, verticalAlignEm: 1.35},
  bodyArrow: {scale: 0.3, lineHeightRatio: 1, verticalAlignEm: 1.55},
  detailSup: {scale: 0.34, lineHeightRatio: 1, verticalAlignEm: 0.56},
  detailLinkSup: {scale: 0.24, lineHeightRatio: 1, verticalAlignEm: 0.92},
  olderProjectSup: {scale: 0.36, lineHeightRatio: 1, verticalAlignEm: 0.72},
  detailLinkGap: {scale: 0.44, lineHeightRatio: 1.35, letterSpacingEm: 0.8},
  olderProject: {scale: 0.6, lineHeightRatio: 1.25, maxCh: 50}
}

const roleNames = Object.keys(roleSpecs)

// Solve cubic-bezier(0.22, 1, 0.36, 1) matching the reflow curve
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

const webUrlPattern = /^(?:https?:|\/\/)/i

const romanNumerals = [
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x'
]

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

export const getMediaAspect = entry => entry.media?.aspect || entry.aspect || 1

export const hasDescender = c =>
  c === 'g' || c === 'j' || c === 'p' || c === 'q' || c === 'y'

export const isInteractiveToken = token =>
  token.kind === 'link' ||
  token.kind === 'section-toggle' ||
  token.kind === 'project-toggle'

export const opensNewTab = node =>
  typeof node.external === 'boolean'
    ? node.external
    : webUrlPattern.test(node.href || '')

export const getSupGap = (token, styles) => {
  if (token.kind !== 'sup') {
    return 0
  }

  const baseRole =
    token.styleRole === 'bodySup' || token.styleRole === 'bodyArrow'
      ? 'body'
      : token.styleRole === 'olderProjectSup'
        ? 'olderProject'
        : token.styleRole === 'detailLinkSup'
          ? 'detailLink'
          : 'detail'

  if (token.supPosition === 'leading') {
    return Math.round(styles[baseRole].fontSize * supAfterGapRatio)
  }

  if (token.supPosition === 'trailing') {
    return Math.round(styles[baseRole].fontSize * supBeforeGapRatio)
  }

  return 0
}

export const annotateCopyFootnotes = (nodes, projects = {}, sections = {}) => {
  let footnoteIndex = 0

  return nodes.map(node => {
    if (node.kind === 'section' && sections[node.sectionId]) {
      return {...node, footnote: `${++footnoteIndex}`}
    }

    if (node.kind === 'project' && projects[node.projectId]) {
      return {...node, footnote: `${++footnoteIndex}`}
    }

    return node
  })
}

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

export const buildPrerenderSubsections = (
  nodes,
  projects = {},
  sections = {}
) => {
  const subsections = []
  const seen = new Set()

  for (const node of nodes) {
    if (node.kind === 'section') {
      const section = sections[node.sectionId]

      if (!section || seen.has(`s:${node.sectionId}`)) {
        continue
      }

      seen.add(`s:${node.sectionId}`)

      if (section.details) {
        subsections.push({
          key: `prerender-s-${node.sectionId}`,
          kind: 'section-detail',
          title: node.text,
          details: section.details
        })
      } else if (Array.isArray(section.projectIds)) {
        const items = []

        for (const subId of section.projectIds) {
          const subProject = projects[subId]

          if (!subProject || seen.has(`p:${subProject.id}`)) {
            continue
          }

          seen.add(`p:${subProject.id}`)
          items.push({
            key: `prerender-p-${subProject.id}`,
            name: subProject.name,
            details: subProject.details,
            links: Array.isArray(subProject.links) ? subProject.links : []
          })
        }

        if (items.length > 0) {
          subsections.push({
            key: `prerender-s-${node.sectionId}`,
            kind: 'section-projects',
            title: node.text,
            projects: items
          })
        }
      }
    } else if (node.kind === 'project') {
      const project = projects[node.projectId]

      if (!project || seen.has(`p:${project.id}`)) {
        continue
      }

      seen.add(`p:${project.id}`)
      subsections.push({
        key: `prerender-p-${project.id}`,
        kind: 'project',
        title: project.name,
        details: project.details,
        links: Array.isArray(project.links) ? project.links : []
      })
    }
  }

  return subsections
}

export const getCollapsedPrefetchUrls = (projects = {}, sections = {}) => {
  const urls = []
  const seen = new Set()

  for (const sec of Object.values(sections)) {
    if (!Array.isArray(sec?.projectIds)) {
      continue
    }

    for (const id of sec.projectIds) {
      const media = projects[id]?.media

      if (!media) {
        continue
      }

      const candidate =
        media.kind === 'image' ? media.prefetchUrl : media.webm || media.mp4

      if (candidate && !seen.has(candidate)) {
        seen.add(candidate)
        urls.push({
          href: candidate,
          as: media.kind === 'image' ? 'image' : 'video'
        })
      }
    }
  }

  return urls
}

// Reusable scratch buffers for zero-allocation Catmull-Rom underline path generation
let scratchPtsX = new Float64Array(64)
let scratchPtsY = new Float64Array(64)

const writeUnderlinePoint = (idx, glyph, localX, dyLocal, originX, originY) => {
  const px0 = glyph.x + glyph.width * 0.5
  const py0 = glyph.y + glyph.lineHeight * glyphOriginYRatio

  if (glyph.tx === 0 && glyph.ty === 0 && glyph.angle === 0) {
    scratchPtsX[idx] = px0 + localX - originX
    scratchPtsY[idx] = py0 + dyLocal - originY
    return
  }

  const rad = (glyph.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  scratchPtsX[idx] = px0 + glyph.tx + localX * cos - dyLocal * sin - originX
  scratchPtsY[idx] = py0 + glyph.ty + localX * sin + dyLocal * cos - originY
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

  const n = glyphs.length + 2

  if (scratchPtsX.length < n) {
    scratchPtsX = new Float64Array(n * 2)
    scratchPtsY = new Float64Array(n * 2)
  }

  const dyLocal = run.underlineOffset - run.pivotOffsetY
  const first = glyphs[0]
  const last = glyphs[glyphs.length - 1]

  writeUnderlinePoint(0, first, -first.width * 0.5, dyLocal, originX, originY)

  for (let i = 0; i < glyphs.length; i++) {
    writeUnderlinePoint(i + 1, glyphs[i], 0, dyLocal, originX, originY)
  }

  writeUnderlinePoint(n - 1, last, last.width * 0.5, dyLocal, originX, originY)

  const preX = 2 * scratchPtsX[0] - scratchPtsX[1]
  const preY = 2 * scratchPtsY[0] - scratchPtsY[1]
  const postX = 2 * scratchPtsX[n - 1] - scratchPtsX[n - 2]
  const postY = 2 * scratchPtsY[n - 1] - scratchPtsY[n - 2]

  let d = `M ${scratchPtsX[0].toFixed(2)} ${scratchPtsY[0].toFixed(2)}`

  for (let i = 0; i < n - 1; i++) {
    const p0x = i === 0 ? preX : scratchPtsX[i - 1]
    const p0y = i === 0 ? preY : scratchPtsY[i - 1]
    const p1x = scratchPtsX[i]
    const p1y = scratchPtsY[i]
    const p2x = scratchPtsX[i + 1]
    const p2y = scratchPtsY[i + 1]
    const p3x = i + 2 >= n ? postX : scratchPtsX[i + 2]
    const p3y = i + 2 >= n ? postY : scratchPtsY[i + 2]

    const d1 = Math.max(1e-4, Math.hypot(p1x - p0x, p1y - p0y) ** 0.5)
    const d2 = Math.max(1e-4, Math.hypot(p2x - p1x, p2y - p1y) ** 0.5)
    const d3 = Math.max(1e-4, Math.hypot(p3x - p2x, p3y - p2y) ** 0.5)

    const d1Sq = d1 * d1
    const d2Sq = d2 * d2
    const d3Sq = d3 * d3

    const denom1 = 3 * d1 * (d1 + d2)
    const denom2 = 3 * d3 * (d2 + d3)

    const w1 = 2 * d1Sq + 3 * d1 * d2 + d2Sq
    const w2 = 2 * d3Sq + 3 * d2 * d3 + d2Sq

    const c1x = (d1Sq * p2x - d2Sq * p0x + w1 * p1x) / denom1
    const c1y = (d1Sq * p2y - d2Sq * p0y + w1 * p1y) / denom1
    const c2x = (d3Sq * p1x - d2Sq * p3x + w2 * p2x) / denom2
    const c2y = (d3Sq * p1y - d2Sq * p3y + w2 * p2y) / denom2

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2x.toFixed(2)} ${p2y.toFixed(2)}`
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
      kind: 'link',
      key: `${ownerPrefix}-link-${linkIndex}`,
      text: link.label,
      href: link.href,
      external: link.external,
      styleRole: 'detailLink',
      activeSection
    })

    if (opensNewTab(link)) {
      linkTokens.push({
        kind: 'sup',
        key: `${ownerPrefix}-link-ext-${linkIndex}`,
        text: externalLinkArrow,
        styleRole: 'detailLinkSup',
        supPosition: 'trailing',
        baseAngle: externalLinkArrowAngle,
        activeSection
      })
    }
  })

  return linkTokens
}

const buildExpandedProjectSegments = (
  project,
  activeSection = true,
  footnote = null
) => {
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
  const detailTokens = []

  if (footnote) {
    detailTokens.push({
      kind: 'sup',
      key: `p-${project.id}-fn`,
      text: footnote,
      styleRole: 'detailSup',
      supPosition: 'leading',
      activeSection
    })
  }

  detailTokens.push({
    kind: 'text',
    key: `p-${project.id}-details`,
    text: project.details,
    styleRole: 'detail',
    activeSection
  })

  segments.push({
    kind: 'flow',
    ownerId: project.id,
    baseRole: 'detail',
    clearExpandedFloat: !hasLinks,
    tokens: detailTokens
  })

  if (hasLinks) {
    segments.push({
      kind: 'flow',
      ownerId: project.id,
      baseRole: 'detailLink',
      marginTopRole: 'detailLink',
      marginTopRatio: detailLinksGapRatio,
      inheritIndent: Boolean(footnote),
      clearExpandedFloat: true,
      tokens: buildLinkTokens(`p-${project.id}`, project.links, activeSection)
    })
  }

  return segments
}

const buildDetailSectionSegments = (
  sectionId,
  section,
  activeSection = true,
  footnote = null
) => {
  const detailTokens = []

  if (footnote) {
    detailTokens.push({
      kind: 'sup',
      key: `s-${sectionId}-fn`,
      text: footnote,
      styleRole: 'detailSup',
      supPosition: 'leading',
      activeSection
    })
  }

  detailTokens.push({
    kind: 'text',
    key: `s-${sectionId}-details`,
    text: section.details,
    styleRole: 'detail',
    activeSection
  })

  return [
    {
      kind: 'flow',
      ownerId: sectionId,
      baseRole: 'detail',
      marginTopRole: 'detail',
      marginTopRatio: sectionTopGapRatio,
      clearExpandedFloat: true,
      tokens: detailTokens
    }
  ]
}

const buildProjectListSegments = (
  sectionId,
  projectIds,
  projects,
  expandedSet,
  isExpanded,
  sectionFootnote = null
) => {
  const segments = []
  let prevSubExpanded = false
  let subFootnoteIndex = 0

  projectIds.forEach((subId, subIndex) => {
    const subProject = projects[subId]

    if (!subProject) {
      return
    }

    const subExpanded = isExpanded && expandedSet.has(subProject.id)
    const isFirst = subIndex === 0
    const isLast = subIndex === projectIds.length - 1
    const subFootnote =
      romanNumerals[subFootnoteIndex++] ?? `${subFootnoteIndex}`
    const rowTokens = []

    if (isFirst && sectionFootnote) {
      rowTokens.push({
        kind: 'sup',
        key: `s-${sectionId}-fn`,
        text: sectionFootnote,
        styleRole: 'olderProjectSup',
        supPosition: 'leading',
        activeSection: isExpanded
      })
    }

    rowTokens.push({
      kind: 'project-toggle',
      key: `p-${subProject.id}-toggle`,
      projectId: subProject.id,
      text: subProject.name,
      styleRole: 'olderProject',
      expanded: subExpanded,
      activeSection: isExpanded
    })

    rowTokens.push({
      kind: 'sup',
      key: `p-${subProject.id}-sup`,
      text: subFootnote,
      styleRole: 'olderProjectSup',
      supPosition: 'trailing',
      activeSection: isExpanded
    })

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
      baseRole: 'olderProject',
      marginTopRole,
      marginTopRatio,
      inheritIndent: !isFirst && Boolean(sectionFootnote),
      clearExpandedFloat: isLast && !subExpanded,
      tokens: rowTokens
    })

    if (subExpanded) {
      segments.push(
        ...buildExpandedProjectSegments(subProject, true, subFootnote)
      )
    }

    prevSubExpanded = subExpanded
  })

  return segments
}

const buildSectionSegments = (
  sectionId,
  section,
  projects,
  expandedSet,
  footnote = null
) => {
  if (!section) {
    return []
  }

  if (section.details) {
    return buildDetailSectionSegments(sectionId, section, true, footnote)
  }

  if (Array.isArray(section.projectIds)) {
    return buildProjectListSegments(
      sectionId,
      section.projectIds,
      projects,
      expandedSet,
      true,
      footnote
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
  let footnoteIndex = 0

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
      const footnote = section ? `${++footnoteIndex}` : null

      currentFlow.push({
        kind: 'section-toggle',
        key: `s-${node.sectionId}-toggle`,
        sectionId: node.sectionId,
        text: node.text,
        expanded,
        activeSection: expanded
      })

      if (footnote) {
        currentFlow.push({
          kind: 'sup',
          key: `s-${node.sectionId}-sup`,
          text: footnote,
          styleRole: 'bodySup',
          supPosition: 'trailing',
          activeSection: expanded
        })
      }

      if (nodes[i + 1]?.kind === 'text' && nodes[i + 1].text === '.') {
        currentFlow.push(nodes[i + 1])
        i++
      }

      if (!expanded) {
        continue
      }

      flushFlow()
      segments.push(
        ...buildSectionSegments(
          node.sectionId,
          section,
          projects,
          expandedSet,
          footnote
        )
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

      if (node.kind === 'link' && opensNewTab(node)) {
        currentFlow.push({
          kind: 'sup',
          key: `${node.key}-ext`,
          text: externalLinkArrow,
          styleRole: 'bodyArrow',
          supPosition: 'trailing',
          baseAngle: externalLinkArrowAngle
        })
      }

      continue
    }

    afterExpanded = false
    const project = projects[node.projectId]

    if (!project) {
      continue
    }

    const expanded = expandedSet.has(project.id)
    const footnote = `${++footnoteIndex}`

    currentFlow.push({
      kind: 'project-toggle',
      key: `p-${project.id}-toggle`,
      projectId: project.id,
      text: project.name,
      expanded,
      activeSection: expanded
    })

    currentFlow.push({
      kind: 'sup',
      key: `p-${project.id}-sup`,
      text: footnote,
      styleRole: 'bodySup',
      supPosition: 'trailing',
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
        expanded: false
      })
      continue
    }

    flushFlow()
    segments.push(...buildExpandedProjectSegments(project, true, footnote))
    afterExpanded = true
  }

  flushFlow()

  return segments
}

export const computeTypographyStyles = (rootEl, ctx) => {
  const computed = getComputedStyle(rootEl)
  const fontFamily = computed.fontFamily
  const bodyFontSize = parseFloat(computed.fontSize) || 48
  const parsedBodyLh = parseFloat(computed.lineHeight)
  const bodyLineHeight = Number.isFinite(parsedBodyLh)
    ? parsedBodyLh
    : bodyFontSize * 1.25

  const styles = Object.create(null)

  for (let i = 0; i < roleNames.length; i++) {
    const role = roleNames[i]
    const spec = roleSpecs[role]
    const fontStyle = spec.fontStyle || 'normal'
    const fontWeight = spec.fontWeight || '400'
    const fontSize = Number((bodyFontSize * spec.scale).toFixed(4))
    const lineHeight =
      spec.scale === 1
        ? bodyLineHeight
        : Number((fontSize * spec.lineHeightRatio).toFixed(4))
    const letterSpacing = spec.letterSpacingEm
      ? Number((fontSize * spec.letterSpacingEm).toFixed(4))
      : 0
    const baselineShift = spec.verticalAlignEm
      ? Number((fontSize * spec.verticalAlignEm).toFixed(4))
      : 0
    const font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`

    applyCtxFont(ctx, {font, letterSpacing})
    const fontMetrics = ctx.measureText('Hg')
    const fontAscent = Number.isFinite(fontMetrics.fontBoundingBoxAscent)
      ? fontMetrics.fontBoundingBoxAscent
      : fontSize * 0.8
    const fontDescent = Number.isFinite(fontMetrics.fontBoundingBoxDescent)
      ? fontMetrics.fontBoundingBoxDescent
      : fontSize * 0.25
    const maxWidth = spec.maxCh ? ctx.measureText('0').width * spec.maxCh : null
    const baselineOffset = (lineHeight + fontAscent - fontDescent) / 2
    const strokeWidth = Math.max(
      1.5,
      Math.round(underlineStrokeWidth * spec.scale * 2) / 2
    )
    const underlineOffset =
      baselineOffset + fontSize * underlineOffsetRatio + strokeWidth * 0.5
    const pivotOffsetY = lineHeight * glyphOriginYRatio

    styles[role] = {
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

  return {
    styles,
    styleKey: `${fontFamily}|${bodyFontSize}|${bodyLineHeight}`
  }
}

export const prepareSegmentList = (segments, styles, ctx, widthCache, cache) =>
  segments.map(segment => {
    if (segment.kind !== 'flow') {
      return segment
    }

    const sig = segment.tokens
      .map(
        t =>
          `${t.key}:${t.kind}:${t.styleRole ?? ''}:${t.supPosition ?? ''}:${t.text ?? ''}`
      )
      .join('|')
    let prepared = cache[sig]

    if (!prepared) {
      prepared = prepareFlowTokens(
        segment.tokens,
        styles,
        ctx,
        widthCache,
        getSupGap,
        getMediaAspect
      )
      cache[sig] = prepared
    }

    return {
      ...segment,
      prepared
    }
  })

const formatTransform = (tx, ty, angle, sx = 1, sy = 1) => {
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

export const computeWordTransform = word => {
  const dx = (word.visX ?? word.x) - (word.originX ?? 0)
  const dy = (word.visY ?? word.y) - (word.originY ?? 0)
  return `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`
}

export const computeUnderlineTransform = run => {
  const dx = (run.visX ?? run.x) - (run.originX ?? 0)
  const dy = (run.visY ?? run.y) - (run.originY ?? 0)
  return `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`
}

export const computeGlyphTransform = glyph =>
  formatTransform(
    glyph.tx ?? 0,
    glyph.ty ?? 0,
    (glyph.baseAngle ?? 0) + (glyph.angle ?? 0)
  )

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
