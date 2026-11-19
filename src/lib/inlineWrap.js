// Lightweight Latin rich-inline token measurement, float line-wrapping, and
// trailing-line runt rebalancing (`text-wrap: pretty` equivalent).

const floatGutter = 28
const floatMarginTop = 14
const floatMarginBottom = 14
const minWrapWidth = 220

const prettyTailMaxLines = 4
const prettyMaxStepBacks = 3
const prettyMinLineFill = 0.3
const prettyWidthStepEpsilon = 0.1

const runTokenRegex = /[ \t]+|[^ \t]+/g
const softBreakSplitRegex =
  /[^-\u2013\u2014/]*[-\u2013\u2014/]+|[^-\u2013\u2014/]+/g
const endsWithSoftBreakRegex = /[-\u2013\u2014/]$/
const startsClosingPunctRegex = /^[.,;:!?)]/
const isWhitespaceRegex = /^\s+$/

export const applyCtxFont = (ctx, style) => {
  ctx.font = style.font

  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = style.letterSpacing
      ? `${style.letterSpacing}px`
      : '0.000001px'
  }
}

export const measureTextWidth = (ctx, style, text, widthCache) => {
  if (!text) {
    return 0
  }

  const key = `${style.font}\0${style.letterSpacing}\0${text}`
  const cached = widthCache[key]

  if (typeof cached === 'number') {
    return cached
  }

  applyCtxFont(ctx, style)
  const width = ctx.measureText(text).width
  widthCache[key] = width
  return width
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

  applyCtxFont(ctx, styles[role])
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
      isSpace: isWhitespaceRegex.test(segment)
    })
  }

  cache[cacheKey] = metrics
  return metrics
}

export const prepareFlowTokens = (
  tokens,
  styles,
  ctx,
  widthCache,
  getSupGap,
  getMediaAspect
) => {
  const atoms = []

  for (let itemIndex = 0; itemIndex < tokens.length; itemIndex++) {
    const token = tokens[itemIndex]
    const roleStyle = styles[token.styleRole || 'body']

    if (token.kind === 'media') {
      const boxWidth = roleStyle.lineHeight * getMediaAspect(token)
      atoms.push({
        type: 'piece',
        itemIndex,
        isMedia: true,
        sourceStart: 0,
        sourceEnd: 0,
        extraBefore: 0,
        extraAfter: boxWidth,
        breakAfter: false
      })
      continue
    }

    const text = token.text || ''

    if (!text) {
      continue
    }

    const supGap = getSupGap(token, styles)
    const leadExtra =
      token.kind === 'sup' && token.supPosition === 'trailing' ? supGap : 0
    const trailExtra =
      token.kind === 'sup' && token.supPosition === 'leading' ? supGap : 0
    const tokenAtoms = []
    let firstPieceIdx = -1
    let lastPieceIdx = -1

    runTokenRegex.lastIndex = 0
    let match = runTokenRegex.exec(text)

    while (match !== null) {
      const chunk = match[0]
      const chunkStart = match.index

      if (chunk[0] === ' ' || chunk[0] === '\t') {
        tokenAtoms.push({
          type: 'space',
          itemIndex,
          width: measureTextWidth(ctx, roleStyle, chunk, widthCache)
        })
      } else {
        softBreakSplitRegex.lastIndex = 0
        let sub = softBreakSplitRegex.exec(chunk)

        while (sub !== null) {
          const pieceText = sub[0]
          const sourceStart = chunkStart + sub.index
          const sourceEnd = sourceStart + pieceText.length
          const idx = tokenAtoms.length

          if (firstPieceIdx < 0) {
            firstPieceIdx = idx
          }

          lastPieceIdx = idx
          tokenAtoms.push({
            type: 'piece',
            itemIndex,
            isMedia: false,
            sourceStart,
            sourceEnd,
            extraBefore: 0,
            extraAfter: 0,
            breakAfter: endsWithSoftBreakRegex.test(pieceText)
          })
          sub = softBreakSplitRegex.exec(chunk)
        }
      }

      match = runTokenRegex.exec(text)
    }

    if (firstPieceIdx >= 0 && leadExtra > 0) {
      tokenAtoms[firstPieceIdx].extraBefore = leadExtra
    }

    if (lastPieceIdx >= 0 && trailExtra > 0) {
      tokenAtoms[lastPieceIdx].extraAfter = trailExtra
    }

    for (let a = 0; a < tokenAtoms.length; a++) {
      atoms.push(tokenAtoms[a])
    }
  }

  const clusters = []
  let currentCluster = null
  let pendingGap = 0
  let pendingGapItemIndex = -1
  let prevBreakAfter = false

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]

    if (atom.type === 'space') {
      pendingGap += atom.width

      if (pendingGapItemIndex < 0) {
        pendingGapItemIndex = atom.itemIndex
      }

      continue
    }

    const slice = atom.isMedia
      ? ''
      : tokens[atom.itemIndex].text.slice(atom.sourceStart, atom.sourceEnd)
    const startsClosing = startsClosingPunctRegex.test(slice)
    const canBreak =
      currentCluster !== null &&
      (pendingGap > 0 || (prevBreakAfter && !startsClosing))

    if (!currentCluster || canBreak) {
      currentCluster = {
        gapBefore: currentCluster ? pendingGap : 0,
        gapItemIndex: currentCluster ? pendingGapItemIndex : -1,
        pieces: [atom]
      }
      clusters.push(currentCluster)
    } else {
      currentCluster.pieces.push(atom)
    }

    pendingGap = 0
    pendingGapItemIndex = -1
    prevBreakAfter = atom.breakAfter
  }

  return {tokens, styles, ctx, widthCache, clusters}
}

export const materializeClusterRange = (prepared, startCluster, endCluster) => {
  const {tokens, styles, ctx, widthCache, clusters} = prepared
  const fragments = []

  for (let c = startCluster; c < endCluster; c++) {
    const cluster = clusters[c]

    for (let p = 0; p < cluster.pieces.length; p++) {
      const piece = cluster.pieces[p]
      const gapBefore = c > startCluster && p === 0 ? cluster.gapBefore : 0
      const gapItemIndex =
        c > startCluster && p === 0 ? cluster.gapItemIndex : -1
      const prev = fragments[fragments.length - 1]

      if (
        prev &&
        !prev.isMedia &&
        !piece.isMedia &&
        prev.itemIndex === piece.itemIndex &&
        (gapBefore === 0 || gapItemIndex === piece.itemIndex)
      ) {
        prev.sourceEnd = piece.sourceEnd
        prev.extraAfter = piece.extraAfter
      } else {
        fragments.push({
          itemIndex: piece.itemIndex,
          isMedia: piece.isMedia,
          sourceStart: piece.sourceStart,
          sourceEnd: piece.sourceEnd,
          gapBefore,
          gapItemIndex,
          extraBefore: piece.extraBefore,
          extraAfter: piece.extraAfter,
          text: '',
          occupiedWidth: 0
        })
      }
    }
  }

  let totalWidth = 0

  for (let f = 0; f < fragments.length; f++) {
    const frag = fragments[f]

    if (frag.isMedia) {
      frag.occupiedWidth = frag.extraBefore + frag.extraAfter
    } else {
      const token = tokens[frag.itemIndex]
      const roleStyle = styles[token.styleRole || 'body']
      frag.text = token.text.slice(frag.sourceStart, frag.sourceEnd)
      frag.occupiedWidth =
        measureTextWidth(ctx, roleStyle, frag.text, widthCache) +
        frag.extraBefore +
        frag.extraAfter
    }

    totalWidth += frag.gapBefore + frag.occupiedWidth
  }

  return {
    startCluster,
    endCluster,
    clusterCount: endCluster - startCluster,
    fragments,
    width: totalWidth
  }
}

const layoutNextClusterRange = (prepared, limitWidth, startCluster) => {
  const count = prepared.clusters.length

  if (startCluster >= count) {
    return null
  }

  let best = null

  for (let end = startCluster + 1; end <= count; end++) {
    const candidate = materializeClusterRange(prepared, startCluster, end)

    if (candidate.width <= limitWidth || end === startCluster + 1) {
      best = candidate

      if (candidate.width > limitWidth) {
        break
      }
    } else {
      break
    }
  }

  return best
}

const rebalancePrettyTail = (prepared, lines, stepLine) => {
  const lineCount = lines.length
  const totalClusters = prepared.clusters.length

  if (lineCount < 2 || lines[lineCount - 1].range.clusterCount !== 1) {
    return lines
  }

  const tailCount = Math.min(prettyTailMaxLines, lineCount)
  const tailStart = lineCount - tailCount
  const tailStartCluster =
    tailStart === 0 ? 0 : lines[tailStart - 1].range.endCluster
  const tailStartY = lines[tailStart].y

  let bestTail = null
  let bestScore = Infinity
  const chosen = new Array(tailCount)

  const search = (depth, startCluster, y) => {
    if (depth === tailCount - 1) {
      const last = stepLine(startCluster, y)

      if (
        !last ||
        last.range.endCluster !== totalClusters ||
        last.range.clusterCount === 1
      ) {
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

    const greedy = stepLine(startCluster, y)

    if (!greedy) {
      return
    }

    const candidates = [
      {
        ...greedy,
        singleUnit: greedy.range.clusterCount === 1
      }
    ]
    let probeFrom = candidates[0]

    for (let step = 0; step < prettyMaxStepBacks; step++) {
      if (probeFrom.singleUnit) {
        break
      }

      const probeWidth = probeFrom.range.width - prettyWidthStepEpsilon
      const minWidth = Math.max(1, probeFrom.maxWidth * prettyMinLineFill)

      if (probeWidth < minWidth) {
        break
      }

      const alt = stepLine(startCluster, y, probeWidth)

      if (
        !alt ||
        alt.range.endCluster === probeFrom.range.endCluster ||
        alt.range.width < minWidth
      ) {
        break
      }

      const altCandidate = {
        ...alt,
        singleUnit: alt.range.clusterCount === 1
      }
      candidates.push(altCandidate)
      probeFrom = altCandidate
    }

    for (let c = 0; c < candidates.length; c++) {
      const cand = candidates[c]
      chosen[depth] = cand
      search(depth + 1, cand.range.endCluster, cand.y + cand.lineHeight)
    }
  }

  search(0, tailStartCluster, tailStartY)

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

export const placeExpandedMediaFloat = (
  seg,
  maxWidth,
  currentY,
  maxFloatBottom,
  placedFloats
) => {
  const aspect = seg.media?.aspect || seg.aspect || 1
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
  startLineIndex,
  inheritedIndent = 0
) => {
  const segBaseRole =
    seg.baseRole || seg.marginTopRole || seg.tokens[0]?.styleRole || 'body'
  const segStyleMaxWidth =
    segBaseRole !== 'body' && segBaseRole !== 'name'
      ? activeStyles[segBaseRole]?.maxWidth
      : null
  const hasLeadingSup =
    seg.tokens[0]?.kind === 'sup' && seg.tokens[0]?.supPosition === 'leading'
  let hangingIndent = 0
  let checkLineHeight = activeStyles[segBaseRole].lineHeight

  for (let t = 0; t < seg.tokens.length; t++) {
    const tStyle = activeStyles[seg.tokens[t].styleRole || 'body']

    if (tStyle.lineHeight > checkLineHeight) {
      checkLineHeight = tStyle.lineHeight
    }
  }

  const stepSegmentLine = (startCluster, y, overrideMaxWidth = null) => {
    const isFirstLine = startCluster === 0
    let floatOffsetX = 0

    for (let p = 0; p < placedFloats.length; p++) {
      const fl = placedFloats[p]

      if (y + checkLineHeight > fl.y && y < fl.clearBottom) {
        const rightEdge = fl.x + fl.width + floatGutter

        if (rightEdge > floatOffsetX) {
          floatOffsetX = rightEdge
        }
      }
    }

    const extraIndent = hasLeadingSup
      ? isFirstLine
        ? 0
        : hangingIndent
      : inheritedIndent
    const lineOffsetX = floatOffsetX + extraIndent
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
    const range = layoutNextClusterRange(seg.prepared, limitWidth, startCluster)

    if (!range) {
      return null
    }

    if (
      hasLeadingSup &&
      isFirstLine &&
      hangingIndent === 0 &&
      range.fragments[0]?.itemIndex === 0
    ) {
      hangingIndent = range.fragments[0].occupiedWidth
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
  let cursor = 0
  const greedyLines = []

  while (cursor < seg.prepared.clusters.length) {
    const line = stepSegmentLine(cursor, currentY)

    if (!line) {
      break
    }

    greedyLines.push({
      ...line,
      lineIndex: localLineIndex++
    })
    currentY += line.lineHeight
    cursor = line.range.endCluster
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
    nextLineIndex: localLineIndex,
    hangingIndent
  }
}
