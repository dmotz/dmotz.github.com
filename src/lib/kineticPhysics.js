// Layout materialization, staggered offscreen reflow transitions, and
// dt-normalized magnetic pointer / diacritic ripple physics.

import garamondGlyphs from '#lib/glyphs'
import {
  layoutFlowSegmentLines,
  measureFragmentGlyphs,
  placeExpandedMediaFloat
} from '#lib/inlineWrap'
import {
  buildUnderlinePath,
  computeBoxTransform,
  computeGlyphTransform,
  computeUnderlineTransform,
  computeWordTransform,
  detailBottomGapRatio,
  detailLinksGapRatio,
  evalReflowEase,
  getMediaAspect,
  getParentSectionId,
  getSupGap,
  isInteractiveToken
} from '#lib/kineticLayout'
import {
  screensaverExitDurationMs,
  screensaverExitMinSmoothing,
  screensaverSmoothing
} from '#lib/kineticScreensaver'

export const radius = 280
const maxDegrees = 24
const maxRepulsion = 28
const coreRadius = 156
const basePointerSmoothing = 0.2
const tangentSoftSq = 36

const rippleSpeed = 640
const rippleBandWidth = 170
const rippleFlipInterval = 45

export const offscreenBuffer = 80
const offscreenLineStagger = 52
const offscreenWordStagger = 28
export const reflowDurationMs = 340
const enterDurationMs = 400
const enterDurationJitterMs = 60
const enterLineDelayMs = 48
const enterWordDelayMs = 24
const enterMaxStaggerMs = 260
const enterDelayJitterMs = 26
const enterWordXSpread = 48
const enterWordYSpread = 28

export const evalItemReflowEase = (item, elapsed) => {
  const delay = item.reflowDelay ?? 0
  const duration = item.reflowDuration ?? reflowDurationMs

  if (elapsed <= delay) {
    return 0
  }

  if (duration <= 0 || elapsed >= delay + duration) {
    return 1
  }

  return evalReflowEase((elapsed - delay) / duration)
}

export const isReflowTarget = entry =>
  entry.kind === 'word' || entry.kind === 'box' || entry.kind === 'underline'

const pickAlternateChar = (item, intensity) => {
  const alts = item.alts

  if (!alts || alts.length < 2) {
    return item.char
  }

  if (intensity < 0.35 && Math.random() > intensity / 0.35) {
    return item.char
  }

  let next = item.displayChar

  while (next === item.displayChar) {
    next = alts[Math.floor(Math.random() * alts.length)]
  }

  return next
}

const stepAxis = (current, target, factor) => {
  const delta = target - current
  return Math.abs(delta) > 0.02 ? current + delta * factor : target
}

const applyInteractiveGroupBounds = group => {
  if (!isInteractiveToken(group.token)) {
    group.bounds = null
    return
  }

  let minX = Infinity
  let minY = Infinity
  let maxRight = -Infinity
  let maxBottom = -Infinity

  for (let i = 0; i < group.items.length; i++) {
    const it = group.items[i]

    if (it.kind !== 'hitbox') {
      continue
    }

    if (it.x < minX) {
      minX = it.x
    }

    if (it.y < minY) {
      minY = it.y
    }

    if (it.x + it.width > maxRight) {
      maxRight = it.x + it.width
    }

    if (it.y + it.height > maxBottom) {
      maxBottom = it.y + it.height
    }
  }

  if (minX === Infinity) {
    group.bounds = {x: 0, y: 0, width: 0, height: 0}
    return
  }

  group.bounds = {
    x: minX,
    y: minY,
    width: Math.max(1, maxRight - minX),
    height: Math.max(1, maxBottom - minY)
  }

  for (let i = 0; i < group.items.length; i++) {
    const it = group.items[i]

    if (it.kind === 'word' || it.kind === 'underline') {
      it.originX = minX
      it.originY = minY
    } else if (it.kind === 'hitbox') {
      it.localX = it.x - minX
      it.localY = it.y - minY
    }
  }
}

export const buildPositionedLayout = ({
  planSegments,
  activeStyles,
  styleKey,
  maxWidth,
  offscreenX,
  ctx,
  segmenter,
  fragmentGlyphCache,
  allReflowItems,
  activeGlyphItems,
  activeGroups,
  exitingGroups,
  prevToggleBottomById,
  layoutHeight,
  reflowActive,
  reflowStartTime,
  animate,
  reducedMotion,
  sections
}) => {
  const prevElapsed = reflowActive
    ? Math.max(0, performance.now() - reflowStartTime)
    : Infinity
  const prevReflowById = Object.create(null)
  const prevWordById = Object.create(null)
  const prevGlyphById = Object.create(null)
  const isInitialLayout = activeGroups.length === 0

  for (let i = 0; i < allReflowItems.length; i++) {
    const item = allReflowItems[i]

    if (!item || !item.id) {
      continue
    }

    const itemEase = reflowActive ? evalItemReflowEase(item, prevElapsed) : 1

    if (item.kind === 'box') {
      const curSx =
        typeof item.reflowStartSx === 'number'
          ? item.reflowStartSx +
            (item.reflowEndSx - item.reflowStartSx) * itemEase
          : 1
      const curSy =
        typeof item.reflowStartSy === 'number'
          ? item.reflowStartSy +
            (item.reflowEndSy - item.reflowStartSy) * itemEase
          : 1
      const domW = item.domWidth ?? item.width
      const domH = item.domHeight ?? item.height
      const visW = domW * curSx
      const visH = domH * curSy
      const visCx =
        typeof item.reflowStartCx === 'number'
          ? item.reflowStartCx +
            (item.reflowEndCx - item.reflowStartCx) * itemEase
          : item.x + item.width * 0.5
      const visCy =
        typeof item.reflowStartCy === 'number'
          ? item.reflowStartCy +
            (item.reflowEndCy - item.reflowStartCy) * itemEase
          : item.y + item.height * 0.5

      prevReflowById[item.id] = {
        item,
        visX: visCx - visW * 0.5,
        visY: visCy - visH * 0.5,
        visW,
        visH,
        visCx,
        visCy
      }
    } else {
      const visX =
        typeof item.reflowStartX === 'number'
          ? item.reflowStartX + (item.reflowEndX - item.reflowStartX) * itemEase
          : item.x
      const visY =
        typeof item.reflowStartY === 'number'
          ? item.reflowStartY + (item.reflowEndY - item.reflowStartY) * itemEase
          : item.y
      prevReflowById[item.id] = {item, visX, visY}

      if (item.kind === 'word') {
        if (!prevWordById[item.id] || !item.exiting) {
          prevWordById[item.id] = item
        }

        for (let c = 0; c < item.children.length; c++) {
          const child = item.children[c]
          prevGlyphById[child.id] = {
            glyph: child,
            visX: visX + child.localX,
            visY: visY + child.localY
          }
        }
      }
    }
  }

  for (let i = 0; i < activeGlyphItems.length; i++) {
    const g = activeGlyphItems[i]

    if (g.kind === 'glyph' && g.isSpace && !prevGlyphById[g.id]) {
      prevGlyphById[g.id] = {glyph: g, visX: g.x, visY: g.y}
    }
  }

  const carryState = (id, defaults) => {
    const prev = prevGlyphById[id]?.glyph || prevReflowById[id]?.item

    if (!prev) {
      return defaults
    }

    return {
      ...defaults,
      displayChar:
        defaults.kind === 'glyph' && prev.char === defaults.char
          ? prev.displayChar
          : defaults.displayChar,
      nextFlipAt: prev.nextFlipAt ?? 0,
      tx: prev.tx,
      ty: prev.ty,
      angle: prev.angle,
      renderedTx: prev.renderedTx,
      renderedTy: prev.renderedTy,
      renderedAngle: prev.renderedAngle,
      renderedTransform: prev.renderedTransform,
      renderedChar: prev.renderedChar
    }
  }

  const localGlyphItems = []
  const localReflowItems = []
  const localUnderlines = []
  const localGroups = []
  const placedFloats = []
  const indentByOwner = Object.create(null)
  const toggleBottomById = Object.create(null)
  let currentY = 0
  let maxFloatBottom = 0
  let activeClearBottom = 0
  let localLineIndex = 0

  const registerMediaBox = (
    group,
    mediaToken,
    boxX,
    y,
    lineBaseline,
    sectionLineIndex,
    wordIndex
  ) => {
    const mediaStyle = activeStyles[mediaToken.styleRole || 'body']
    const mediaLineHeight = mediaStyle.lineHeight
    const mediaY =
      y + (lineBaseline - mediaStyle.baselineShift - mediaStyle.baselineOffset)
    const boxWidth = mediaLineHeight * getMediaAspect(mediaToken)
    const boxId = `media-${mediaToken.projectId}`
    const boxEntry = carryState(boxId, {
      kind: 'box',
      id: boxId,
      projectId: mediaToken.projectId,
      media: mediaToken.media,
      alt: mediaToken.alt,
      expanded: false,
      inExpanded: Boolean(group.token.activeSection),
      exiting: false,
      x: boxX,
      y: mediaY,
      width: boxWidth,
      height: mediaLineHeight,
      cx: boxX + boxWidth / 2,
      cy: mediaY + mediaLineHeight / 2,
      isSpace: false,
      sectionLineIndex,
      wordIndex,
      tx: 0,
      ty: 0,
      angle: 0,
      renderedTx: 0,
      renderedTy: 0,
      renderedAngle: 0,
      renderedTransform: '',
      el: null,
      word: null
    })

    localGlyphItems.push(boxEntry)
    localReflowItems.push(boxEntry)
    group.items.push(boxEntry)
  }

  for (let s = 0; s < planSegments.length; s++) {
    const seg = planSegments[s]

    if (seg.kind === 'expanded-media') {
      const placement = placeExpandedMediaFloat(
        seg,
        maxWidth,
        currentY,
        maxFloatBottom,
        placedFloats
      )
      const boxId = `media-${seg.projectId}`
      const boxEntry = carryState(boxId, {
        kind: 'box',
        id: boxId,
        projectId: seg.projectId,
        media: seg.media,
        alt: seg.alt,
        expanded: true,
        inExpanded: Boolean(seg.activeSection),
        exiting: false,
        x: placement.boxX,
        y: placement.boxY,
        width: placement.boxWidth,
        height: placement.boxHeight,
        cx: placement.boxX + placement.boxWidth / 2,
        cy: placement.boxY + placement.boxHeight / 2,
        isSpace: false,
        sectionLineIndex: 0,
        wordIndex: 0,
        tx: 0,
        ty: 0,
        angle: 0,
        renderedTx: 0,
        renderedTy: 0,
        renderedAngle: 0,
        renderedTransform: '',
        el: null,
        word: null
      })

      localGlyphItems.push(boxEntry)
      localReflowItems.push(boxEntry)
      localGroups.push({
        key: seg.key,
        ownerId: seg.ownerId ?? null,
        token: seg,
        items: [boxEntry],
        bounds: null,
        exiting: false
      })

      maxFloatBottom = placement.nextMaxFloatBottom
      activeClearBottom = placement.clearBottom
      currentY = placement.nextY
      continue
    }

    if (seg.marginTopRole) {
      const ratio = seg.marginTopRatio ?? detailLinksGapRatio
      currentY += Math.round(activeStyles[seg.marginTopRole].fontSize * ratio)
    }

    const flowGroups = seg.tokens.map(token => {
      const group = {
        key: token.key,
        ownerId: seg.ownerId ?? null,
        token,
        items: [],
        bounds: null,
        exiting: false
      }
      localGroups.push(group)
      return group
    })
    const runCountByGroup = new Array(seg.tokens.length).fill(0)
    const inheritedIndent =
      seg.inheritIndent && seg.ownerId ? (indentByOwner[seg.ownerId] ?? 0) : 0
    const {flowLines, nextY, nextLineIndex, hangingIndent} =
      layoutFlowSegmentLines(
        seg,
        activeStyles,
        maxWidth,
        placedFloats,
        currentY,
        localLineIndex,
        inheritedIndent
      )

    if (hangingIndent > 0 && seg.ownerId) {
      indentByOwner[seg.ownerId] = hangingIndent
    }

    currentY = nextY
    localLineIndex = nextLineIndex

    for (let l = 0; l < flowLines.length; l++) {
      const {range, y, lineHeight, lineBaseline, offsetX, lineIndex} =
        flowLines[l]
      const lineGlyphsByItem = new Array(seg.tokens.length)
      const tokenWordIndex = new Array(seg.tokens.length).fill(-1)
      let wordIndex = -1
      let sawSpace = true
      let cursorX = offsetX

      for (let f = 0; f < range.fragments.length; f++) {
        const fragment = range.fragments[f]

        if (fragment.gapBefore > 0 && fragment.gapItemIndex >= 0) {
          sawSpace = true
          const gapToken = seg.tokens[fragment.gapItemIndex]

          if (isInteractiveToken(gapToken)) {
            const gapRole = gapToken.styleRole || 'body'
            const gapStyle = activeStyles[gapRole]
            const gapY =
              y +
              (lineBaseline - gapStyle.baselineShift - gapStyle.baselineOffset)
            const gapId = `${gapToken.key}-s${l}-${f}`
            const gapEntry = carryState(gapId, {
              kind: 'glyph',
              id: gapId,
              char: ' ',
              displayChar: ' ',
              alts: null,
              nextFlipAt: 0,
              x: cursorX,
              y: gapY,
              width: fragment.gapBefore,
              height: gapStyle.lineHeight,
              cx: cursorX + fragment.gapBefore / 2,
              cy: gapY + gapStyle.lineHeight / 2,
              lineHeight: gapStyle.lineHeight,
              isSpace: true,
              sectionLineIndex: lineIndex,
              wordIndex: Math.max(0, wordIndex),
              tx: 0,
              ty: 0,
              angle: 0,
              renderedTx: 0,
              renderedTy: 0,
              renderedAngle: 0,
              renderedTransform: '',
              renderedChar: ' ',
              el: null,
              underlineRun: null,
              word: null
            })

            localGlyphItems.push(gapEntry)

            if (!lineGlyphsByItem[fragment.gapItemIndex]) {
              lineGlyphsByItem[fragment.gapItemIndex] = []
            }

            lineGlyphsByItem[fragment.gapItemIndex].push(gapEntry)
          }
        }

        cursorX += fragment.gapBefore
        const token = seg.tokens[fragment.itemIndex]
        const group = flowGroups[fragment.itemIndex]

        if (fragment.isMedia) {
          registerMediaBox(
            group,
            token,
            cursorX,
            y,
            lineBaseline,
            lineIndex,
            Math.max(0, wordIndex)
          )
          cursorX += fragment.occupiedWidth
          continue
        }

        const tokenRole = token.styleRole || 'body'
        const tokenStyle = activeStyles[tokenRole]
        const tokenY =
          y +
          (lineBaseline - tokenStyle.baselineShift - tokenStyle.baselineOffset)
        const interactive = isInteractiveToken(token)

        if (token.kind === 'section-toggle') {
          toggleBottomById[token.sectionId] = y + lineHeight
        } else if (token.kind === 'project-toggle') {
          toggleBottomById[token.projectId] = y + lineHeight
        }

        let fixedWordIndex = -1

        if (interactive) {
          if (tokenWordIndex[fragment.itemIndex] < 0) {
            if (sawSpace) {
              wordIndex++
              sawSpace = false
            }

            tokenWordIndex[fragment.itemIndex] = Math.max(0, wordIndex)
          }

          fixedWordIndex = tokenWordIndex[fragment.itemIndex]
        } else if (token.kind === 'sup') {
          if (sawSpace) {
            wordIndex++
            sawSpace = false
          }

          fixedWordIndex = Math.max(0, wordIndex)
        } else if (token.text === '\u00A0') {
          fixedWordIndex = Math.max(0, wordIndex)
        }

        if (interactive && fragment.occupiedWidth > 0) {
          group.items.push({
            kind: 'hitbox',
            id: `${token.key}-hit-${l}-${f}`,
            x: cursorX,
            y: tokenY,
            localX: cursorX,
            localY: tokenY,
            width: fragment.occupiedWidth,
            height: tokenStyle.lineHeight,
            sectionLineIndex: lineIndex,
            wordIndex: fixedWordIndex
          })
        }

        const supBeforeGap =
          token.kind === 'sup' && token.supPosition === 'trailing'
            ? getSupGap(token, activeStyles)
            : 0
        const glyphMetrics = measureFragmentGlyphs(
          ctx,
          activeStyles,
          tokenRole,
          fragment.text,
          segmenter,
          fragmentGlyphCache
        )
        let wordStartM = -1
        let currentWordIdx = 0

        const flushWord = endM => {
          if (wordStartM < 0) {
            return
          }

          const firstGm = glyphMetrics[wordStartM]
          const lastGm = glyphMetrics[endM]
          const wordSourceOffset =
            (token.sourceOffset ?? 0) + fragment.sourceStart + firstGm.index
          const wordId = `${token.key}-w${wordSourceOffset}`
          const wordX = cursorX + supBeforeGap + firstGm.relX
          const wordY = tokenY
          const wordWidth = Math.max(
            1,
            lastGm.relX + lastGm.width - firstGm.relX
          )
          const wordHeight = tokenStyle.lineHeight
          const inExpanded = Boolean(group.token.activeSection)
          const wordText = fragment.text.slice(
            firstGm.index,
            lastGm.index + lastGm.char.length
          )
          const signature = `${styleKey}\0${tokenRole}\0${interactive ? 1 : 0}\0${token.baseAngle ?? 0}\0${wordText}`
          const prevWord = prevWordById[wordId]
          const glyphCount = endM - wordStartM + 1
          let children

          const wordEntry = {
            kind: 'word',
            id: wordId,
            styleRole: tokenRole,
            signature,
            x: wordX,
            y: wordY,
            originX: 0,
            originY: 0,
            width: wordWidth,
            height: wordHeight,
            inExpanded,
            exiting: false,
            isInteractive: interactive,
            sectionLineIndex: lineIndex,
            wordIndex: currentWordIdx,
            children: null,
            renderedTransform: prevWord?.renderedTransform ?? '',
            el: prevWord?.el ?? null
          }

          if (
            prevWord &&
            prevWord.signature === signature &&
            prevWord.children.length === glyphCount
          ) {
            children = prevWord.children

            for (let c = 0; c < glyphCount; c++) {
              const g = children[c]
              g.x = wordX + g.localX
              g.y = wordY
              g.cx = g.x + g.width * 0.5
              g.cy = wordY + wordHeight * 0.5
              g.sectionLineIndex = lineIndex
              g.wordIndex = currentWordIdx
              g.underlineRun = null
              g.word = wordEntry
              localGlyphItems.push(g)

              if (interactive) {
                if (!lineGlyphsByItem[fragment.itemIndex]) {
                  lineGlyphsByItem[fragment.itemIndex] = []
                }

                lineGlyphsByItem[fragment.itemIndex].push(g)
              }
            }
          } else {
            children = new Array(glyphCount)

            for (let c = 0; c < glyphCount; c++) {
              const gm = glyphMetrics[wordStartM + c]
              const segment = gm.char
              const localX = gm.relX - firstGm.relX
              const x = wordX + localX
              const glyphWidth = gm.width
              const glyphId = `${token.key}-c${(token.sourceOffset ?? 0) + fragment.sourceStart + gm.index}`
              const glyphEntry = carryState(glyphId, {
                kind: 'glyph',
                id: glyphId,
                styleRole: tokenRole,
                char: segment,
                displayChar: segment,
                alts:
                  token.kind === 'sup' ? null : garamondGlyphs[segment] || null,
                nextFlipAt: 0,
                localX,
                localY: 0,
                domX: localX,
                domY: 0,
                x,
                y: wordY,
                width: glyphWidth,
                height: wordHeight,
                cx: x + glyphWidth * 0.5,
                cy: wordY + wordHeight * 0.5,
                lineHeight: wordHeight,
                isSpace: false,
                isInteractive: interactive,
                sectionLineIndex: lineIndex,
                wordIndex: currentWordIdx,
                tx: 0,
                ty: 0,
                baseAngle: token.baseAngle ?? 0,
                angle: 0,
                renderedTx: 0,
                renderedTy: 0,
                renderedAngle: 0,
                renderedTransform: '',
                renderedChar: segment,
                el: null,
                underlineRun: null,
                word: wordEntry
              })

              children[c] = glyphEntry
              localGlyphItems.push(glyphEntry)

              if (interactive) {
                if (!lineGlyphsByItem[fragment.itemIndex]) {
                  lineGlyphsByItem[fragment.itemIndex] = []
                }

                lineGlyphsByItem[fragment.itemIndex].push(glyphEntry)
              }
            }
          }

          wordEntry.children = children
          localReflowItems.push(wordEntry)
          group.items.push(wordEntry)
          wordStartM = -1
        }

        for (let m = 0; m < glyphMetrics.length; m++) {
          const gm = glyphMetrics[m]

          if (gm.isSpace) {
            flushWord(m - 1)
            let glyphWordIndex = fixedWordIndex

            if (glyphWordIndex < 0) {
              sawSpace = true
              glyphWordIndex = Math.max(0, wordIndex)
            }

            // Only interactive spaces participate as virtual Catmull-Rom control points
            if (interactive) {
              const x = cursorX + gm.relX
              const glyphWidth = gm.width
              const glyphId = `${token.key}-c${(token.sourceOffset ?? 0) + fragment.sourceStart + gm.index}`
              const spaceEntry = carryState(glyphId, {
                kind: 'glyph',
                id: glyphId,
                char: gm.char,
                displayChar: gm.char,
                alts: null,
                nextFlipAt: 0,
                x,
                y: tokenY,
                width: glyphWidth,
                height: tokenStyle.lineHeight,
                cx: x + glyphWidth * 0.5,
                cy: tokenY + tokenStyle.lineHeight * 0.5,
                lineHeight: tokenStyle.lineHeight,
                isSpace: true,
                sectionLineIndex: lineIndex,
                wordIndex: glyphWordIndex,
                tx: 0,
                ty: 0,
                angle: 0,
                renderedTx: 0,
                renderedTy: 0,
                renderedAngle: 0,
                renderedTransform: '',
                renderedChar: gm.char,
                el: null,
                underlineRun: null,
                word: null
              })

              localGlyphItems.push(spaceEntry)

              if (!lineGlyphsByItem[fragment.itemIndex]) {
                lineGlyphsByItem[fragment.itemIndex] = []
              }

              lineGlyphsByItem[fragment.itemIndex].push(spaceEntry)
            }

            continue
          }

          let glyphWordIndex = fixedWordIndex

          if (glyphWordIndex < 0) {
            if (sawSpace) {
              wordIndex++
              sawSpace = false
            }

            glyphWordIndex = wordIndex
          }

          if (wordStartM < 0) {
            wordStartM = m
            currentWordIdx = glyphWordIndex
          }

          if (
            gm.char === '-' ||
            gm.char === '\u2014' ||
            gm.char === '\u2013' ||
            gm.char === '/'
          ) {
            flushWord(m)
          }
        }

        flushWord(glyphMetrics.length - 1)
        cursorX += fragment.occupiedWidth
      }

      for (
        let itemIndex = 0;
        itemIndex < lineGlyphsByItem.length;
        itemIndex++
      ) {
        const lineGlyphs = lineGlyphsByItem[itemIndex]

        if (!lineGlyphs) {
          continue
        }

        let start = 0
        let end = lineGlyphs.length

        while (start < end && lineGlyphs[start].isSpace) {
          start++
        }

        while (end > start && lineGlyphs[end - 1].isSpace) {
          end--
        }

        if (start >= end) {
          continue
        }

        const runGlyphs =
          start === 0 && end === lineGlyphs.length
            ? lineGlyphs
            : lineGlyphs.slice(start, end)
        const group = flowGroups[itemIndex]
        const runRole = group.token.styleRole || 'body'
        const runStyle = activeStyles[runRole]
        const runY = y + (lineBaseline - runStyle.baselineOffset)
        const runIndex = runCountByGroup[itemIndex]
        runCountByGroup[itemIndex] = runIndex + 1

        const firstGlyph = runGlyphs[0]
        const lastGlyph = runGlyphs[runGlyphs.length - 1]
        const runX = firstGlyph.x
        const runWidth = Math.max(1, lastGlyph.x + lastGlyph.width - runX)
        const runId = `${group.token.key}-u${runIndex}`
        const restPath = `M 0 ${runStyle.underlineOffset.toFixed(2)} L ${runWidth.toFixed(2)} ${runStyle.underlineOffset.toFixed(2)}`
        const prevRun = prevReflowById[runId]?.item
        const run = {
          kind: 'underline',
          id: runId,
          styleRole: runRole,
          x: runX,
          y: runY,
          originX: 0,
          originY: 0,
          width: runWidth,
          height: runStyle.lineHeight,
          underlineOffset: runStyle.underlineOffset,
          pivotOffsetY: runStyle.pivotOffsetY,
          strokeWidth: runStyle.strokeWidth,
          inExpanded: Boolean(group.token.activeSection),
          exiting: false,
          sectionLineIndex: lineIndex,
          wordIndex: Math.max(0, tokenWordIndex[itemIndex]),
          glyphs: runGlyphs,
          restPath,
          pathD: '',
          renderedD: '',
          dirty: false,
          pathEl: null,
          svgEl: prevRun?.svgEl ?? null,
          renderedSvgTransform: prevRun?.renderedSvgTransform ?? ''
        }

        run.pathD = buildUnderlinePath(run)
        run.renderedD = run.pathD

        for (let g = 0; g < runGlyphs.length; g++) {
          runGlyphs[g].underlineRun = run
        }

        localUnderlines.push(run)
        localReflowItems.push(run)
        group.items.push(run)
      }
    }

    for (let g = 0; g < flowGroups.length; g++) {
      applyInteractiveGroupBounds(flowGroups[g])
    }

    if (seg.clearExpandedFloat && s < planSegments.length - 1) {
      const bottomGap = Math.round(
        activeStyles.detail.fontSize * detailBottomGapRatio
      )
      currentY = Math.max(currentY + bottomGap, activeClearBottom)
      activeClearBottom = 0
    }
  }

  const computeOffscreenTargetMap = (
    groupList,
    rawAnchorY,
    clampHeight,
    {stagger = false} = {}
  ) => {
    let minX = Infinity
    let minY = Infinity
    let maxBottom = -Infinity
    let minLineIndex = Infinity

    for (let g = 0; g < groupList.length; g++) {
      const groupItems = groupList[g].items

      for (let i = 0; i < groupItems.length; i++) {
        const entry = groupItems[i]

        if (!isReflowTarget(entry)) {
          continue
        }

        if (entry.x < minX) {
          minX = entry.x
        }

        if (entry.y < minY) {
          minY = entry.y
        }

        const bottom = entry.y + (entry.height ?? 0)

        if (bottom > maxBottom) {
          maxBottom = bottom
        }

        const lineIdx = entry.sectionLineIndex ?? 0

        if (lineIdx < minLineIndex) {
          minLineIndex = lineIdx
        }
      }
    }

    const targets = Object.create(null)

    if (minX === Infinity) {
      return targets
    }

    const baseShiftX = offscreenX - minX
    const contentHeight = maxBottom - minY
    const desiredTop = rawAnchorY + minY
    const maxTop = Math.max(0, clampHeight - contentHeight)
    const clampedTop = Math.max(0, Math.min(desiredTop, maxTop))
    const shiftY = clampedTop - minY

    const slotProfiles = stagger ? Object.create(null) : null

    if (stagger) {
      let maxRawDelay = 0

      for (let g = 0; g < groupList.length; g++) {
        const groupItems = groupList[g].items

        for (let i = 0; i < groupItems.length; i++) {
          const entry = groupItems[i]

          if (!isReflowTarget(entry)) {
            continue
          }

          const relLine =
            (entry.sectionLineIndex ?? minLineIndex) - minLineIndex
          const slotWord =
            (entry.wordIndex ?? 0) + (entry.kind === 'box' ? 1 : 0)
          const slotKey = `${relLine}:${slotWord}`

          if (!slotProfiles[slotKey]) {
            const rawDelay =
              relLine * enterLineDelayMs + slotWord * enterWordDelayMs

            if (rawDelay > maxRawDelay) {
              maxRawDelay = rawDelay
            }

            slotProfiles[slotKey] = {
              rawDelay,
              delay: 0,
              duration:
                enterDurationMs +
                (Math.random() - 0.5) * 2 * enterDurationJitterMs,
              xJitter: Math.random() * enterWordXSpread,
              yJitter: (Math.random() - 0.5) * enterWordYSpread
            }
          }
        }
      }

      const delayScale =
        maxRawDelay > enterMaxStaggerMs ? enterMaxStaggerMs / maxRawDelay : 1
      let minDelay = Infinity

      for (const key of Object.keys(slotProfiles)) {
        const slot = slotProfiles[key]
        slot.delay =
          slot.rawDelay * delayScale +
          (Math.random() - 0.5) * enterDelayJitterMs

        if (slot.delay < minDelay) {
          minDelay = slot.delay
        }
      }

      if (minDelay !== Infinity) {
        for (const key of Object.keys(slotProfiles)) {
          slotProfiles[key].delay = Math.max(
            0,
            slotProfiles[key].delay - minDelay
          )
        }
      }
    }

    for (let g = 0; g < groupList.length; g++) {
      const groupItems = groupList[g].items

      for (let i = 0; i < groupItems.length; i++) {
        const entry = groupItems[i]

        if (!isReflowTarget(entry)) {
          continue
        }

        const relLine = (entry.sectionLineIndex ?? minLineIndex) - minLineIndex
        const slotWord = (entry.wordIndex ?? 0) + (entry.kind === 'box' ? 1 : 0)
        const slot = stagger ? slotProfiles[`${relLine}:${slotWord}`] : null
        const itemShiftX =
          baseShiftX +
          relLine * offscreenLineStagger +
          slotWord * offscreenWordStagger +
          (slot ? slot.xJitter : 0)

        targets[entry.id] = {
          x: entry.x + itemShiftX,
          y: entry.y + shiftY + (slot ? slot.yJitter : 0),
          delay: slot ? slot.delay : 0,
          duration: slot ? slot.duration : reflowDurationMs
        }
      }
    }

    return targets
  }

  const mainLayoutHeight = Math.max(currentY, maxFloatBottom)
  const shouldAnimate = animate && !isInitialLayout && !reducedMotion
  const mainGroupKeys = Object.create(null)

  for (let g = 0; g < localGroups.length; g++) {
    mainGroupKeys[localGroups[g].key] = true
  }

  const enteringTargets = Object.create(null)
  const nextExitingGroups = []
  const exitingReflowItems = []
  const nextMovingReflowItems = []

  if (shouldAnimate) {
    const enteringByOwner = Object.create(null)

    for (let g = 0; g < localGroups.length; g++) {
      const group = localGroups[g]

      if (!group.ownerId) {
        continue
      }

      let hasNew = false

      for (let i = 0; i < group.items.length; i++) {
        const it = group.items[i]

        if (isReflowTarget(it) && !prevReflowById[it.id]) {
          hasNew = true
          break
        }
      }

      if (hasNew) {
        if (!enteringByOwner[group.ownerId]) {
          enteringByOwner[group.ownerId] = []
        }

        enteringByOwner[group.ownerId].push(group)
      }
    }

    for (const ownerId of Object.keys(enteringByOwner)) {
      const parentId = getParentSectionId(sections, ownerId)
      const anchorY =
        toggleBottomById[ownerId] ??
        (parentId ? toggleBottomById[parentId] : null) ??
        0
      Object.assign(
        enteringTargets,
        computeOffscreenTargetMap(
          enteringByOwner[ownerId],
          anchorY,
          mainLayoutHeight,
          {stagger: true}
        )
      )
    }
  }

  for (let i = 0; i < localReflowItems.length; i++) {
    const entry = localReflowItems[i]
    let prev = prevReflowById[entry.id]

    if (!prev && entry.kind === 'word' && entry.children.length > 0) {
      const firstChild = entry.children[0]
      const prevChild = prevGlyphById[firstChild.id]

      if (prevChild) {
        prev = {
          visX: prevChild.visX - firstChild.localX,
          visY: prevChild.visY - firstChild.localY
        }
      }
    }

    if (entry.kind === 'box') {
      const targetCx = entry.x + entry.width * 0.5
      const targetCy = entry.y + entry.height * 0.5

      if (shouldAnimate && prev) {
        const shrinking =
          entry.width < prev.visW - 0.5 || entry.height < prev.visH - 0.5

        entry.reflowDelay = 0
        entry.reflowDuration = reflowDurationMs

        if (shrinking) {
          entry.domWidth = prev.visW
          entry.domHeight = prev.visH
          entry.finalWidth = entry.width
          entry.finalHeight = entry.height
          entry.hasDeferredLayout = true
          entry.reflowStartCx = prev.visCx
          entry.reflowStartCy = prev.visCy
          entry.reflowEndCx = targetCx
          entry.reflowEndCy = targetCy
          entry.reflowStartSx = 1
          entry.reflowStartSy = 1
          entry.reflowEndSx = entry.width / entry.domWidth
          entry.reflowEndSy = entry.height / entry.domHeight
        } else {
          entry.domWidth = entry.width
          entry.domHeight = entry.height
          entry.hasDeferredLayout = false
          entry.reflowStartCx = prev.visCx
          entry.reflowStartCy = prev.visCy
          entry.reflowEndCx = targetCx
          entry.reflowEndCy = targetCy
          entry.reflowStartSx = prev.visW / entry.domWidth
          entry.reflowStartSy = prev.visH / entry.domHeight
          entry.reflowEndSx = 1
          entry.reflowEndSy = 1
        }
      } else if (shouldAnimate && enteringTargets[entry.id]) {
        const off = enteringTargets[entry.id]
        entry.domWidth = entry.width
        entry.domHeight = entry.height
        entry.hasDeferredLayout = false
        entry.reflowStartCx = off.x + entry.width * 0.5
        entry.reflowStartCy = off.y + entry.height * 0.5
        entry.reflowEndCx = targetCx
        entry.reflowEndCy = targetCy
        entry.reflowStartSx = 1
        entry.reflowStartSy = 1
        entry.reflowEndSx = 1
        entry.reflowEndSy = 1
        entry.reflowDelay = off.delay
        entry.reflowDuration = off.duration
      } else {
        entry.domWidth = entry.width
        entry.domHeight = entry.height
        entry.hasDeferredLayout = false
        entry.reflowStartCx = targetCx
        entry.reflowStartCy = targetCy
        entry.reflowEndCx = targetCx
        entry.reflowEndCy = targetCy
        entry.reflowStartSx = 1
        entry.reflowStartSy = 1
        entry.reflowEndSx = 1
        entry.reflowEndSy = 1
        entry.reflowDelay = 0
        entry.reflowDuration = reflowDurationMs
      }

      entry.visCx = entry.reflowStartCx
      entry.visCy = entry.reflowStartCy
      entry.curReflowSx = entry.reflowStartSx
      entry.curReflowSy = entry.reflowStartSy

      if (
        entry.reflowStartCx !== entry.reflowEndCx ||
        entry.reflowStartCy !== entry.reflowEndCy ||
        entry.reflowStartSx !== entry.reflowEndSx ||
        entry.reflowStartSy !== entry.reflowEndSy
      ) {
        nextMovingReflowItems.push(entry)
      }

      continue
    }

    if (shouldAnimate && prev) {
      entry.reflowStartX = prev.visX
      entry.reflowStartY = prev.visY
      entry.reflowEndX = entry.x
      entry.reflowEndY = entry.y
      entry.reflowDelay = 0
      entry.reflowDuration = reflowDurationMs
    } else if (shouldAnimate && enteringTargets[entry.id]) {
      const off = enteringTargets[entry.id]
      entry.reflowStartX = off.x
      entry.reflowStartY = off.y
      entry.reflowEndX = entry.x
      entry.reflowEndY = entry.y
      entry.reflowDelay = off.delay
      entry.reflowDuration = off.duration
    } else {
      entry.reflowStartX = entry.x
      entry.reflowStartY = entry.y
      entry.reflowEndX = entry.x
      entry.reflowEndY = entry.y
      entry.reflowDelay = 0
      entry.reflowDuration = reflowDurationMs
    }

    entry.visX = entry.reflowStartX
    entry.visY = entry.reflowStartY

    if (
      entry.reflowStartX !== entry.reflowEndX ||
      entry.reflowStartY !== entry.reflowEndY
    ) {
      nextMovingReflowItems.push(entry)
    }
  }

  if (shouldAnimate) {
    const priorGroups = [...activeGroups, ...exitingGroups]
    const exitingByOwner = Object.create(null)

    for (let g = 0; g < priorGroups.length; g++) {
      const prevGroup = priorGroups[g]

      if (!prevGroup.ownerId || mainGroupKeys[prevGroup.key]) {
        continue
      }

      const clonedItems = prevGroup.items.filter(isReflowTarget)

      if (clonedItems.length === 0) {
        continue
      }

      const exitGroup = {
        ...prevGroup,
        exiting: true,
        items: clonedItems.map(it => ({
          ...it,
          exiting: true
        }))
      }
      nextExitingGroups.push(exitGroup)

      if (!exitingByOwner[exitGroup.ownerId]) {
        exitingByOwner[exitGroup.ownerId] = []
      }

      exitingByOwner[exitGroup.ownerId].push(exitGroup)
    }

    const exitClampHeight = Math.max(mainLayoutHeight, layoutHeight)

    for (const ownerId of Object.keys(exitingByOwner)) {
      const parentId = getParentSectionId(sections, ownerId)
      const anchorY =
        toggleBottomById[ownerId] ??
        prevToggleBottomById[ownerId] ??
        (parentId
          ? (toggleBottomById[parentId] ?? prevToggleBottomById[parentId])
          : null) ??
        0
      const exitTargets = computeOffscreenTargetMap(
        exitingByOwner[ownerId],
        anchorY,
        exitClampHeight
      )
      const ownerGroups = exitingByOwner[ownerId]

      for (let g = 0; g < ownerGroups.length; g++) {
        const gItems = ownerGroups[g].items

        for (let i = 0; i < gItems.length; i++) {
          const entry = gItems[i]
          const prev = prevReflowById[entry.id]
          const off = exitTargets[entry.id]

          if (entry.kind === 'box') {
            entry.domWidth = entry.domWidth ?? entry.width
            entry.domHeight = entry.domHeight ?? entry.height
            const curVisW = prev ? prev.visW : entry.domWidth
            const curVisH = prev ? prev.visH : entry.domHeight
            entry.reflowStartCx = prev
              ? prev.visCx
              : entry.x + entry.width * 0.5
            entry.reflowStartCy = prev
              ? prev.visCy
              : entry.y + entry.height * 0.5
            entry.reflowEndCx = off
              ? off.x + curVisW * 0.5
              : entry.reflowStartCx
            entry.reflowEndCy = off
              ? off.y + curVisH * 0.5
              : entry.reflowStartCy
            entry.reflowStartSx = curVisW / entry.domWidth
            entry.reflowStartSy = curVisH / entry.domHeight
            entry.reflowEndSx = entry.reflowStartSx
            entry.reflowEndSy = entry.reflowStartSy
            entry.visCx = entry.reflowStartCx
            entry.visCy = entry.reflowStartCy
            entry.curReflowSx = entry.reflowStartSx
            entry.curReflowSy = entry.reflowStartSy
          } else {
            entry.reflowStartX = prev ? prev.visX : entry.x
            entry.reflowStartY = prev ? prev.visY : entry.y
            entry.reflowEndX = off ? off.x : entry.reflowStartX
            entry.reflowEndY = off ? off.y : entry.reflowStartY
            entry.visX = entry.reflowStartX
            entry.visY = entry.reflowStartY
          }

          entry.reflowDelay = 0
          entry.reflowDuration = reflowDurationMs
          exitingReflowItems.push(entry)
          nextMovingReflowItems.push(entry)
        }
      }
    }
  }

  let anyGlyphMotion = false

  for (let i = 0; i < localGlyphItems.length; i++) {
    const g = localGlyphItems[i]

    if (
      g.tx !== 0 ||
      g.ty !== 0 ||
      g.angle !== 0 ||
      g.renderedTx !== 0 ||
      g.renderedTy !== 0 ||
      g.renderedAngle !== 0 ||
      (g.kind === 'glyph' && g.displayChar !== g.char)
    ) {
      anyGlyphMotion = true
      break
    }
  }

  return {
    groups: localGroups,
    glyphItems: localGlyphItems,
    reflowItems: localReflowItems,
    underlines: localUnderlines,
    exitingGroups: nextExitingGroups,
    exitingReflowItems,
    movingReflowItems: nextMovingReflowItems,
    toggleBottomById,
    mainLayoutHeight,
    shouldAnimate,
    anyGlyphMotion
  }
}

export const stepPhysicsFrame = ({
  now,
  dt,
  reducedMotion,
  pointerActive,
  pointerX,
  pointerY,
  screensaver,
  screensaverActive,
  screensaverX,
  screensaverY,
  screensaverStrength,
  screensaverExitTime,
  getVisibleBodyBounds,
  ripples,
  reflowActive,
  reflowStartTime,
  reflowTotalDurationMs,
  movingReflowItems,
  activeGlyphItems,
  underlineRuns,
  hasActiveGlyphMotion
}) => {
  let nextScreensaverActive = screensaverActive
  let nextScreensaverX = screensaverX
  let nextScreensaverY = screensaverY
  let nextScreensaverStrength = screensaverStrength
  let nextScreensaverExitTime = screensaverExitTime

  if (reducedMotion) {
    ripples.length = 0

    if (nextScreensaverActive) {
      nextScreensaverActive = false
      nextScreensaverStrength = 0
      screensaver.stop()
      nextScreensaverExitTime = 0
    }
  } else {
    if (document.hidden && nextScreensaverActive) {
      nextScreensaverActive = false
      nextScreensaverStrength = 0
      screensaver.stop()
      nextScreensaverExitTime = 0
    }

    if (nextScreensaverActive) {
      const next = screensaver.step(dt, getVisibleBodyBounds())
      nextScreensaverX = next.x
      nextScreensaverY = next.y
      nextScreensaverStrength = next.strength
    }

    for (let r = ripples.length - 1; r >= 0; r--) {
      const ripple = ripples[r]
      const waveR = ((now - ripple.startTime) / 1000) * rippleSpeed

      if (waveR - rippleBandWidth > ripple.maxRadius) {
        ripples.splice(r, 1)
      } else {
        ripple.waveR = waveR
      }
    }
  }

  const active =
    (pointerActive || nextScreensaverActive) &&
    !reducedMotion &&
    (maxDegrees !== 0 || maxRepulsion !== 0)
  const fieldIntensity = nextScreensaverActive ? nextScreensaverStrength : 1
  const dtRatio = dt / 16.6667
  let stepSmoothing = 1 - (1 - basePointerSmoothing) ** dtRatio

  if (nextScreensaverActive) {
    stepSmoothing = 1 - (1 - screensaverSmoothing) ** dtRatio
  } else if (nextScreensaverExitTime > 0) {
    const exitU = Math.min(
      1,
      Math.max(0, (now - nextScreensaverExitTime) / screensaverExitDurationMs)
    )

    if (exitU >= 1) {
      nextScreensaverExitTime = 0
    } else {
      const eased = exitU * exitU * (3 - 2 * exitU)
      const baseFactor =
        screensaverExitMinSmoothing +
        (basePointerSmoothing - screensaverExitMinSmoothing) * eased
      stepSmoothing = 1 - (1 - baseFactor) ** dtRatio
    }
  }

  const hasRipples = ripples.length > 0
  let reflowElapsed = 0
  let reflowJustFinished = false

  if (reflowActive) {
    reflowElapsed = Math.max(0, now - reflowStartTime)

    if (reflowElapsed >= reflowTotalDurationMs) {
      reflowJustFinished = true
    }
  }

  let needsMore =
    nextScreensaverActive || hasRipples || (reflowActive && !reflowJustFinished)

  if (reflowActive && !reflowJustFinished) {
    for (let i = 0; i < movingReflowItems.length; i++) {
      const entry = movingReflowItems[i]
      const itemEase = evalItemReflowEase(entry, reflowElapsed)

      if (entry.kind === 'word') {
        entry.visX =
          entry.reflowStartX +
          (entry.reflowEndX - entry.reflowStartX) * itemEase
        entry.visY =
          entry.reflowStartY +
          (entry.reflowEndY - entry.reflowStartY) * itemEase

        if (entry.el) {
          const nextT = computeWordTransform(entry)

          if (nextT !== entry.renderedTransform) {
            entry.el.style.transform = nextT
            entry.renderedTransform = nextT
          }
        }
      } else if (entry.kind === 'underline') {
        entry.visX =
          entry.reflowStartX +
          (entry.reflowEndX - entry.reflowStartX) * itemEase
        entry.visY =
          entry.reflowStartY +
          (entry.reflowEndY - entry.reflowStartY) * itemEase

        if (entry.svgEl) {
          const nextT = computeUnderlineTransform(entry)

          if (nextT !== entry.renderedSvgTransform) {
            entry.svgEl.style.transform = nextT
            entry.renderedSvgTransform = nextT
          }
        }
      } else if (entry.kind === 'box') {
        entry.visCx =
          entry.reflowStartCx +
          (entry.reflowEndCx - entry.reflowStartCx) * itemEase
        entry.visCy =
          entry.reflowStartCy +
          (entry.reflowEndCy - entry.reflowStartCy) * itemEase
        entry.curReflowSx =
          entry.reflowStartSx +
          (entry.reflowEndSx - entry.reflowStartSx) * itemEase
        entry.curReflowSy =
          entry.reflowStartSy +
          (entry.reflowEndSy - entry.reflowStartSy) * itemEase

        if (entry.el) {
          const nextT = computeBoxTransform(entry)

          if (nextT !== entry.renderedTransform) {
            entry.el.style.transform = nextT
            entry.renderedTransform = nextT
          }
        }
      }
    }
  }

  let nextHasActiveGlyphMotion = hasActiveGlyphMotion

  if (active || hasActiveGlyphMotion || hasRipples) {
    const mx = active
      ? nextScreensaverActive
        ? nextScreensaverX
        : pointerX
      : 0
    const my = active
      ? nextScreensaverActive
        ? nextScreensaverY
        : pointerY
      : 0
    const radiusSq = radius * radius
    const coreSq = coreRadius * coreRadius
    const edgeFalloff = 1 / (1 + radiusSq / coreSq)
    const falloffSpan = 1 - edgeFalloff
    let stillMovingGlyphs = false
    let anyUnderlineDirty = false

    for (let i = 0; i < activeGlyphItems.length; i++) {
      const item = activeGlyphItems[i]
      const wordDx = item.word
        ? (item.word.visX ?? item.word.x) - item.word.x
        : item.kind === 'box'
          ? (item.visCx ?? item.cx) - item.cx
          : 0
      const wordDy = item.word
        ? (item.word.visY ?? item.word.y) - item.word.y
        : item.kind === 'box'
          ? (item.visCy ?? item.cy) - item.cy
          : 0
      const visCx = item.cx + wordDx
      const visCy = item.cy + wordDy

      if (item.kind === 'glyph' && item.alts && item.el) {
        let rippleIntensity = 0

        if (hasRipples) {
          for (let r = 0; r < ripples.length; r++) {
            const ripple = ripples[r]
            const waveR = ripple.waveR
            const rdy = visCy - ripple.oy

            if (rdy > -waveR && rdy < waveR) {
              const innerR = Math.max(0, waveR - rippleBandWidth)
              const rdx = visCx - ripple.ox
              const distSq = rdx * rdx + rdy * rdy

              if (distSq <= waveR * waveR && distSq >= innerR * innerR) {
                const behind = waveR - Math.sqrt(distSq)
                const strength = 1 - behind / rippleBandWidth

                if (strength > rippleIntensity) {
                  rippleIntensity = strength
                }
              }
            }
          }
        }

        if (rippleIntensity > 0) {
          if (now >= item.nextFlipAt) {
            const nextChar = pickAlternateChar(item, rippleIntensity)

            if (nextChar !== item.displayChar) {
              item.displayChar = nextChar
              item.renderedChar = nextChar
              item.el.textContent = nextChar
            }

            item.nextFlipAt =
              now + rippleFlipInterval * (0.65 + Math.random() * 0.7)
          }

          stillMovingGlyphs = true
        } else {
          item.nextFlipAt = 0

          if (item.displayChar !== item.char) {
            item.displayChar = item.char
            item.renderedChar = item.char
            item.el.textContent = item.char
          }
        }
      }

      let targetTx = 0
      let targetTy = 0
      let targetAngle = 0
      const fieldScale = item.kind === 'box' ? 0.35 : 1

      if (active && fieldScale !== 0 && fieldIntensity > 0) {
        const dy = visCy - my

        // Fast Y-band reject before computing dx / distSq
        if (dy > -radius && dy < radius) {
          const dx = visCx - mx
          const distSq = dx * dx + dy * dy

          if (distSq < radiusSq) {
            const gravity =
              ((1 / (1 + distSq / coreSq) - edgeFalloff) / falloffSpan) *
              fieldIntensity
            const tangent = (-2 * dx * dy) / (distSq + tangentSoftSq)
            targetAngle = maxDegrees * gravity * tangent * fieldScale

            if (maxRepulsion !== 0) {
              const dist = Math.sqrt(distSq + tangentSoftSq)
              const push = maxRepulsion * gravity * fieldScale
              targetTx = (dx / dist) * push
              targetTy = (dy / dist) * push
            }
          }
        }
      }

      if (
        targetTx !== 0 ||
        targetTy !== 0 ||
        targetAngle !== 0 ||
        item.tx !== 0 ||
        item.ty !== 0 ||
        item.angle !== 0
      ) {
        item.tx = stepAxis(item.tx, targetTx, stepSmoothing)
        item.ty = stepAxis(item.ty, targetTy, stepSmoothing)

        const angleDelta = targetAngle - item.angle

        if (Math.abs(angleDelta) > 0.005) {
          item.angle += angleDelta * stepSmoothing
        } else {
          item.angle = targetAngle
        }

        if (
          item.tx !== targetTx ||
          item.ty !== targetTy ||
          item.angle !== targetAngle
        ) {
          needsMore = true
        }
      }

      const interactionChanged =
        Math.abs(item.tx - item.renderedTx) > 0.02 ||
        Math.abs(item.ty - item.renderedTy) > 0.02 ||
        Math.abs(item.angle - item.renderedAngle) > 0.005 ||
        (item.tx === 0 && item.renderedTx !== 0) ||
        (item.ty === 0 && item.renderedTy !== 0) ||
        (item.angle === 0 && item.renderedAngle !== 0)

      if (interactionChanged) {
        item.renderedTx = item.tx
        item.renderedTy = item.ty
        item.renderedAngle = item.angle

        if (item.underlineRun) {
          item.underlineRun.dirty = true
          anyUnderlineDirty = true
        }

        if (!item.isSpace && item.el) {
          const nextTransform =
            item.kind === 'box'
              ? reflowJustFinished && item.hasDeferredLayout
                ? item.renderedTransform
                : computeBoxTransform(item)
              : computeGlyphTransform(item)

          if (nextTransform !== item.renderedTransform) {
            item.el.style.transform = nextTransform
            item.renderedTransform = nextTransform
          }
        }
      }

      if (
        item.tx !== 0 ||
        item.ty !== 0 ||
        item.angle !== 0 ||
        item.renderedTx !== 0 ||
        item.renderedTy !== 0 ||
        item.renderedAngle !== 0
      ) {
        stillMovingGlyphs = true
      }
    }

    nextHasActiveGlyphMotion = stillMovingGlyphs

    if (anyUnderlineDirty) {
      for (let u = 0; u < underlineRuns.length; u++) {
        const run = underlineRuns[u]

        if (!run.dirty) {
          continue
        }

        run.dirty = false

        if (run.pathEl) {
          const nextD = buildUnderlinePath(run)

          if (nextD !== run.renderedD) {
            run.renderedD = nextD
            run.pathEl.setAttribute('d', nextD)
          }
        }
      }
    }
  }

  return {
    screensaverActive: nextScreensaverActive,
    screensaverX: nextScreensaverX,
    screensaverY: nextScreensaverY,
    screensaverStrength: nextScreensaverStrength,
    screensaverExitTime: nextScreensaverExitTime,
    hasActiveGlyphMotion: nextHasActiveGlyphMotion,
    reflowJustFinished,
    needsMore
  }
}
