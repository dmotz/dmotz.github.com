<script>
  import {onMount} from 'svelte'
  import {SvelteSet} from 'svelte/reactivity'
  import {resolve} from '$app/paths'
  import {materializeRichInlineLineRange} from '@chenglou/pretext/rich-inline'
  import garamondGlyphs from '#lib/glyphs'
  import {
    buildLayoutSegments,
    buildUnderlinePath,
    buildWarmSpecs,
    computeBoxTransform,
    computeGlyphTransform,
    computeUnderlineTransform,
    computeWordTransform,
    detailBottomGapRatio,
    detailLinksGapRatio,
    evalReflowEase,
    getMediaAspect,
    getParentSectionId,
    getStyleKey,
    hasDescender,
    isInteractiveToken,
    isSvelteKitRoute,
    layoutFlowSegmentLines,
    measureFragmentGlyphs,
    normalizeCopy,
    opensNewTab,
    placeExpandedMediaFloat,
    prepareSegmentList,
    readTypography
  } from '#lib/kineticLayout'
  import '../styles/main.css'

  const {copy = [], projects = {}, sections = {}} = $props()

  const normalizedCopy = $derived(normalizeCopy(copy))

  // pointer/ripple params
  const maxDegrees = 24
  const maxRepulsion = 28
  const radius = 280
  const coreRadius = 156
  const smoothing = 0.2

  const rippleSpeed = 640
  const rippleBandWidth = 170
  const rippleFlipInterval = 45

  const tangentSoftSq = 36

  const offscreenBuffer = 80
  const offscreenLineStagger = 52
  const offscreenWordStagger = 28
  const reflowDurationMs = 340
  const enterDurationMs = 400
  const enterDurationJitterMs = 60
  const enterLineDelayMs = 48
  const enterWordDelayMs = 24
  const enterMaxStaggerMs = 260
  const enterDelayJitterMs = 26
  const enterWordXSpread = 48
  const enterWordYSpread = 28

  let paragraphEl = $state(null)
  let detailProbeEl = $state(null)
  let detailLinkProbeEl = $state(null)
  let detailSupProbeEl = $state(null)
  let detailLinkGapProbeEl = $state(null)
  let olderProjectProbeEl = $state(null)
  let nameProbeEl = $state(null)
  let layoutHeight = $state(0)
  let hasLayout = $state(false)
  let renderGroups = $state.raw([])
  const expandedIds = new SvelteSet()
  let isReflowing = $state(false)
  let reducedMotion = $state(false)
  let hoveredProjectId = $state(null)

  let measureCtx = null
  let cachedStyleKey = ''
  let cachedStyles = null
  let cachedMaxWidth = 0
  let cachedOffscreenX = 0
  let cachedDocLeft = 0
  let cachedDocTop = 0
  let cachedScrollX = 0
  let cachedScrollY = 0
  let cachedExpandedKey = ''
  let cachedDataVersion = -1
  let dataVersion = 0
  let cachedPlan = null
  let cachedLocale = ''
  let cachedSegmenter = null
  let preparedSegmentCache = Object.create(null)
  let preparedCacheStyleKey = ''
  let fragmentGlyphCache = Object.create(null)
  let fragmentCacheStyleKey = ''
  let fontsReady = false
  let hasInitializedProps = false
  let underlineRuns = []
  let activeGlyphItems = []
  let activeReflowItems = []
  let allReflowItems = []
  let movingReflowItems = []
  let activeGroups = []
  let activeUnderlines = []
  let exitingGroups = []
  let prevToggleBottomById = Object.create(null)
  let deferredLayoutHeight = null
  let reflowActive = false
  let reflowStartTime = 0
  let reflowTotalDurationMs = reflowDurationMs
  let hasActiveGlyphMotion = false

  let pointerActive = false
  let pointerClientX = 0
  let pointerClientY = 0
  let touchOnly = false
  let activeTouchId = null
  let lastToggleClickEvent = null
  let lastToggleBlockedBySelection = false
  let warmIdleHandle = null
  let warmIdleUsesCallback = false
  let warmedCacheKey = ''
  let rafId = null
  const ripples = []

  const evalItemReflowEase = (item, elapsed) => {
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

  const getSegmenter = () => {
    const locale = document.documentElement.lang || 'en'

    if (!cachedSegmenter || cachedLocale !== locale) {
      cachedLocale = locale
      cachedSegmenter = new Intl.Segmenter(locale, {granularity: 'grapheme'})
    }

    return cachedSegmenter
  }

  const getMeasureContext = () => {
    if (!measureCtx) {
      const canvas = document.createElement('canvas')
      measureCtx = canvas.getContext('2d')
    }

    return measureCtx
  }

  const getFragmentGlyphs = (ctx, styles, styleKey, role, text) => {
    if (fragmentCacheStyleKey !== styleKey) {
      fragmentGlyphCache = Object.create(null)
      fragmentCacheStyleKey = styleKey
    }

    return measureFragmentGlyphs(
      ctx,
      styles,
      role,
      text,
      getSegmenter(),
      fragmentGlyphCache
    )
  }

  const preparePlanSegments = (segments, styles, styleKey) => {
    if (preparedCacheStyleKey !== styleKey) {
      preparedSegmentCache = Object.create(null)
      preparedCacheStyleKey = styleKey
    }

    return prepareSegmentList(segments, styles, preparedSegmentCache)
  }

  const preparePlan = (styles, styleKey) =>
    preparePlanSegments(
      buildLayoutSegments(normalizedCopy, projects, sections, expandedIds),
      styles,
      styleKey
    )

  const warmSegmentList = (planSegments, activeStyles, styleKey, maxWidth) => {
    const ctx = getMeasureContext()
    const placedFloats = []
    let currentY = 0
    let maxFloatBottom = 0
    let activeClearBottom = 0
    let localLineIndex = 0

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
        maxFloatBottom = placement.nextMaxFloatBottom
        activeClearBottom = placement.clearBottom
        currentY = placement.nextY
        continue
      }

      if (seg.marginTopRole) {
        const ratio = seg.marginTopRatio ?? detailLinksGapRatio
        currentY += Math.round(activeStyles[seg.marginTopRole].fontSize * ratio)
      }

      const {flowLines, nextY, nextLineIndex} = layoutFlowSegmentLines(
        seg,
        activeStyles,
        maxWidth,
        placedFloats,
        currentY,
        localLineIndex
      )
      currentY = nextY
      localLineIndex = nextLineIndex

      for (let l = 0; l < flowLines.length; l++) {
        const line = materializeRichInlineLineRange(
          seg.prepared,
          flowLines[l].range
        )

        for (let f = 0; f < line.fragments.length; f++) {
          const fragment = line.fragments[f]
          const token = seg.tokens[fragment.itemIndex]
          const tokenRole = token.styleRole || 'body'
          getFragmentGlyphs(
            ctx,
            activeStyles,
            styleKey,
            tokenRole,
            fragment.text
          )
        }
      }

      if (seg.clearExpandedFloat && s < planSegments.length - 1) {
        const bottomGap = Math.round(
          activeStyles.detail.fontSize * detailBottomGapRatio
        )
        currentY = Math.max(currentY + bottomGap, activeClearBottom)
        activeClearBottom = 0
      }
    }
  }

  const cancelCacheWarm = () => {
    if (warmIdleHandle === null) {
      return
    }

    if (warmIdleUsesCallback && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(warmIdleHandle)
    } else {
      clearTimeout(warmIdleHandle)
    }

    warmIdleHandle = null
  }

  const scheduleCacheWarm = () => {
    if (!cachedStyles || cachedMaxWidth <= 0) {
      return
    }

    const targetKey = `${dataVersion}:${cachedStyleKey}@${cachedMaxWidth}`

    if (warmedCacheKey === targetKey) {
      return
    }

    cancelCacheWarm()

    const warmSpecs = buildWarmSpecs(normalizedCopy, projects, sections)

    if (warmSpecs.length === 0) {
      warmedCacheKey = targetKey
      return
    }

    let specIndex = 0

    const enqueueNext = fn => {
      if (typeof requestIdleCallback === 'function') {
        warmIdleUsesCallback = true
        warmIdleHandle = requestIdleCallback(fn, {timeout: 300})
      } else {
        warmIdleUsesCallback = false
        warmIdleHandle = setTimeout(fn, 32)
      }
    }

    const runSlice = () => {
      warmIdleHandle = null

      if (
        !cachedStyles ||
        `${dataVersion}:${cachedStyleKey}@${cachedMaxWidth}` !== targetKey
      ) {
        return
      }

      const sliceStart = performance.now()

      while (specIndex < warmSpecs.length) {
        const ids = warmSpecs[specIndex++]
        const pseudoSet = {has: id => ids.includes(id)}
        const plan = preparePlanSegments(
          buildLayoutSegments(normalizedCopy, projects, sections, pseudoSet),
          cachedStyles,
          cachedStyleKey
        )
        warmSegmentList(plan, cachedStyles, cachedStyleKey, cachedMaxWidth)

        if (performance.now() - sliceStart > 4) {
          break
        }
      }

      if (specIndex < warmSpecs.length) {
        enqueueNext(runSlice)
      } else {
        warmedCacheKey = targetKey
      }
    }

    enqueueNext(runSlice)
  }

  const computeLayout = ({animate = false, checkStyles = true} = {}) => {
    if (
      !paragraphEl ||
      !detailProbeEl ||
      !detailLinkProbeEl ||
      !detailSupProbeEl ||
      !detailLinkGapProbeEl ||
      !olderProjectProbeEl ||
      !nameProbeEl
    ) {
      return
    }

    const maxWidth = paragraphEl.clientWidth

    if (maxWidth <= 0) {
      return
    }

    const ctx = getMeasureContext()
    let styles = cachedStyles
    let styleKey = cachedStyleKey

    if (checkStyles || !styles) {
      const bodyStyle = readTypography(paragraphEl, ctx)
      styles = {
        body: bodyStyle,
        name: readTypography(nameProbeEl, ctx, bodyStyle.fontSize),
        detail: readTypography(detailProbeEl, ctx, bodyStyle.fontSize),
        detailLink: readTypography(detailLinkProbeEl, ctx, bodyStyle.fontSize),
        detailSup: readTypography(detailSupProbeEl, ctx, bodyStyle.fontSize),
        detailLinkGap: readTypography(
          detailLinkGapProbeEl,
          ctx,
          bodyStyle.fontSize
        ),
        olderProject: readTypography(
          olderProjectProbeEl,
          ctx,
          bodyStyle.fontSize
        )
      }
      styleKey = getStyleKey(styles)
    }

    const pRect = paragraphEl.getBoundingClientRect()
    const pLeft = Number.isFinite(pRect.left) ? pRect.left : 0
    const pTop = Number.isFinite(pRect.top) ? pRect.top : 0
    cachedScrollX = window.scrollX
    cachedScrollY = window.scrollY
    cachedDocLeft = pLeft + cachedScrollX
    cachedDocTop = pTop + cachedScrollY
    const offscreenX =
      Math.max(maxWidth, window.innerWidth - pLeft) + offscreenBuffer
    const expandedKey = [...expandedIds].sort().join(',')

    if (
      !animate &&
      cachedPlan &&
      cachedDataVersion === dataVersion &&
      cachedStyleKey === styleKey &&
      cachedExpandedKey === expandedKey &&
      cachedMaxWidth === maxWidth &&
      cachedOffscreenX === offscreenX
    ) {
      return
    }

    if (
      !cachedPlan ||
      cachedDataVersion !== dataVersion ||
      cachedStyleKey !== styleKey ||
      cachedExpandedKey !== expandedKey
    ) {
      cachedPlan = preparePlan(styles, styleKey)
      cachedStyles = styles
      cachedStyleKey = styleKey
      cachedExpandedKey = expandedKey
      cachedDataVersion = dataVersion
    }

    cachedMaxWidth = maxWidth
    cachedOffscreenX = offscreenX
    const activeStyles = cachedStyles

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
            ? item.reflowStartX +
              (item.reflowEndX - item.reflowStartX) * itemEase
            : item.x
        const visY =
          typeof item.reflowStartY === 'number'
            ? item.reflowStartY +
              (item.reflowEndY - item.reflowStartY) * itemEase
            : item.y
        prevReflowById[item.id] = {
          item,
          visX,
          visY
        }

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
        prevGlyphById[g.id] = {
          glyph: g,
          visX: g.x,
          visY: g.y
        }
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

    const layoutSegmentList = (planSegments, {isHidden = false} = {}) => {
      const localGlyphItems = []
      const localReflowItems = []
      const localUnderlines = []
      const localGroups = []
      const placedFloats = []
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
          y +
          (lineBaseline - mediaStyle.baselineShift - mediaStyle.baselineOffset)
        const boxWidth = mediaLineHeight * getMediaAspect(mediaToken)
        const boxId = `media-${mediaToken.projectId}`
        const boxEntry = carryState(boxId, {
          kind: 'box',
          id: boxId,
          projectId: mediaToken.projectId,
          media: mediaToken.media,
          alt: mediaToken.alt,
          alts: null,
          expanded: false,
          inExpanded: Boolean(group.token.activeSection),
          hidden: isHidden,
          exiting: false,
          x: boxX,
          y: mediaY,
          width: boxWidth,
          height: mediaLineHeight,
          cx: boxX + boxWidth / 2,
          cy: mediaY + mediaLineHeight / 2,
          isSpace: false,
          isInteractive: true,
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

          if (!isHidden) {
            const boxId = `media-${seg.projectId}`
            const boxEntry = carryState(boxId, {
              kind: 'box',
              id: boxId,
              projectId: seg.projectId,
              media: seg.media,
              alt: seg.alt,
              alts: null,
              expanded: true,
              inExpanded: Boolean(seg.activeSection),
              hidden: false,
              exiting: false,
              x: placement.boxX,
              y: placement.boxY,
              width: placement.boxWidth,
              height: placement.boxHeight,
              cx: placement.boxX + placement.boxWidth / 2,
              cy: placement.boxY + placement.boxHeight / 2,
              isSpace: false,
              isInteractive: true,
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

            const group = {
              key: seg.key,
              ownerId: seg.ownerId ?? null,
              token: seg,
              items: [boxEntry],
              hidden: false,
              exiting: false,
              afterHiddenId: null
            }
            localGlyphItems.push(boxEntry)
            localReflowItems.push(boxEntry)
            localGroups.push(group)
          }

          maxFloatBottom = placement.nextMaxFloatBottom
          activeClearBottom = placement.clearBottom
          currentY = placement.nextY
          continue
        }

        if (seg.marginTopRole) {
          const ratio = seg.marginTopRatio ?? detailLinksGapRatio
          currentY += Math.round(
            activeStyles[seg.marginTopRole].fontSize * ratio
          )
        }

        const flowGroups = seg.tokens.map(token => {
          const group = {
            key: token.key,
            ownerId: seg.ownerId ?? null,
            token,
            items: [],
            hidden: isHidden,
            exiting: false,
            afterHiddenId: token.afterHiddenId ?? null
          }
          localGroups.push(group)
          return group
        })
        const runCountByGroup = new Array(seg.tokens.length).fill(0)
        const {flowLines, nextY, nextLineIndex} = layoutFlowSegmentLines(
          seg,
          activeStyles,
          maxWidth,
          placedFloats,
          currentY,
          localLineIndex
        )
        currentY = nextY
        localLineIndex = nextLineIndex

        const hasMoreSegments = s < planSegments.length - 1

        for (let l = 0; l < flowLines.length; l++) {
          const {range, y, lineHeight, lineBaseline, offsetX, lineIndex} =
            flowLines[l]
          const line = materializeRichInlineLineRange(seg.prepared, range)
          const lineGlyphsByItem = new Array(seg.tokens.length)
          const tokenWordIndex = new Array(seg.tokens.length).fill(-1)
          let wordIndex = -1
          let sawSpace = true
          let cursorX = offsetX

          for (let f = 0; f < line.fragments.length; f++) {
            const fragment = line.fragments[f]

            if (fragment.gapBefore > 0 && fragment.gapItemIndex >= 0) {
              sawSpace = true
              const gapGroup = flowGroups[fragment.gapItemIndex]
              const gapToken = seg.tokens[fragment.gapItemIndex]
              const gapRole = gapToken.styleRole || 'body'
              const gapStyle = activeStyles[gapRole]
              const gapY =
                y +
                (lineBaseline -
                  gapStyle.baselineShift -
                  gapStyle.baselineOffset)
              const gapId = `${gapToken.key}-s${l}-${f}`
              const gapWordIndex = Math.max(0, wordIndex)
              const gapInteractive = isInteractiveToken(gapToken)
              const gapEntry = carryState(gapId, {
                kind: 'glyph',
                id: gapId,
                styleRole: gapRole,
                char: ' ',
                displayChar: ' ',
                alts: null,
                nextFlipAt: 0,
                localX: cursorX,
                localY: gapY,
                domX: cursorX,
                domY: gapY,
                x: cursorX,
                y: gapY,
                width: fragment.gapBefore,
                height: gapStyle.lineHeight,
                cx: cursorX + fragment.gapBefore / 2,
                cy: gapY + gapStyle.lineHeight / 2,
                lineHeight: gapStyle.lineHeight,
                isSpace: true,
                isInteractive: gapInteractive,
                sectionLineIndex: lineIndex,
                wordIndex: gapWordIndex,
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

              gapEntry.hidden = isHidden
              gapGroup.items.push(gapEntry)

              if (gapInteractive) {
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
            const tokenRole = token.styleRole || 'body'
            const tokenStyle = activeStyles[tokenRole]
            const tokenY =
              y +
              (lineBaseline -
                tokenStyle.baselineShift -
                tokenStyle.baselineOffset)
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
                hidden: isHidden,
                x: cursorX,
                y: tokenY,
                width: fragment.occupiedWidth,
                height: tokenStyle.lineHeight,
                sectionLineIndex: lineIndex,
                wordIndex: fixedWordIndex
              })
            }

            const glyphMetrics = getFragmentGlyphs(
              ctx,
              activeStyles,
              styleKey,
              tokenRole,
              fragment.text
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
              const wordX = cursorX + firstGm.relX
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
              const signature = `${styleKey}\0${tokenRole}\0${interactive ? 1 : 0}\0${wordText}`
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
                width: wordWidth,
                height: wordHeight,
                inExpanded,
                hidden: isHidden,
                exiting: false,
                isInteractive: interactive,
                sectionLineIndex: lineIndex,
                wordIndex: currentWordIdx,
                children: null,
                renderedTransform: prevWord?.renderedTransform ?? '',
                reflowStartDx: 0,
                reflowStartDy: 0,
                reflowEndDx: 0,
                reflowEndDy: 0,
                curReflowDx: 0,
                curReflowDy: 0,
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
                    alts: garamondGlyphs[segment] || null,
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

                const x = cursorX + gm.relX
                const glyphWidth = gm.width
                const glyphId = `${token.key}-c${(token.sourceOffset ?? 0) + fragment.sourceStart + gm.index}`
                const spaceEntry = carryState(glyphId, {
                  kind: 'glyph',
                  id: glyphId,
                  styleRole: tokenRole,
                  char: gm.char,
                  displayChar: gm.char,
                  alts: null,
                  nextFlipAt: 0,
                  localX: x,
                  localY: tokenY,
                  domX: x,
                  domY: tokenY,
                  x,
                  y: tokenY,
                  width: glyphWidth,
                  height: tokenStyle.lineHeight,
                  cx: x + glyphWidth * 0.5,
                  cy: tokenY + tokenStyle.lineHeight * 0.5,
                  lineHeight: tokenStyle.lineHeight,
                  isSpace: true,
                  isInteractive: interactive,
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

                spaceEntry.hidden = isHidden
                group.items.push(spaceEntry)

                if (interactive) {
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

            const nextToken = seg.tokens[fragment.itemIndex + 1]

            if (nextToken?.kind === 'media') {
              const lastGm = glyphMetrics[glyphMetrics.length - 1]
              const nbspWidth = lastGm ? lastGm.relX + lastGm.width : 0
              registerMediaBox(
                flowGroups[fragment.itemIndex + 1],
                nextToken,
                cursorX + nbspWidth,
                y,
                lineBaseline,
                lineIndex,
                Math.max(0, wordIndex)
              )
            }

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
              width: runWidth,
              height: runStyle.lineHeight,
              underlineOffset: runStyle.underlineOffset,
              pivotOffsetY: runStyle.pivotOffsetY,
              strokeWidth: runStyle.strokeWidth,
              inExpanded: Boolean(group.token.activeSection),
              hidden: isHidden,
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
              renderedSvgTransform: prevRun?.renderedSvgTransform ?? '',
              reflowStartDx: 0,
              reflowStartDy: 0,
              reflowEndDx: 0,
              reflowEndDy: 0,
              curReflowDx: 0,
              curReflowDy: 0
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

          if (
            (l < flowLines.length - 1 || hasMoreSegments) &&
            line.fragments.length > 0
          ) {
            const lastFrag = line.fragments[line.fragments.length - 1]
            flowGroups[lastFrag.itemIndex].items.push({
              kind: 'gap',
              id: `${flowGroups[lastFrag.itemIndex].key}-gap-${l}`,
              char: ' ',
              hidden: isHidden,
              x: offsetX + line.width,
              y,
              sectionLineIndex: lineIndex,
              wordIndex: Math.max(0, wordIndex)
            })
          }
        }

        if (seg.clearExpandedFloat && hasMoreSegments) {
          const bottomGap = Math.round(
            activeStyles.detail.fontSize * detailBottomGapRatio
          )
          currentY = Math.max(currentY + bottomGap, activeClearBottom)
          activeClearBottom = 0
        }
      }

      return {
        groups: localGroups,
        glyphItems: localGlyphItems,
        reflowItems: localReflowItems,
        underlines: localUnderlines,
        toggleBottomById,
        endY: currentY,
        maxFloatBottom
      }
    }

    const isReflowTarget = entry =>
      entry.kind === 'word' ||
      entry.kind === 'box' ||
      entry.kind === 'underline'

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

          const relLine =
            (entry.sectionLineIndex ?? minLineIndex) - minLineIndex
          const slotWord =
            (entry.wordIndex ?? 0) + (entry.kind === 'box' ? 1 : 0)
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

    const mainResult = layoutSegmentList(cachedPlan, {isHidden: false})
    const mainLayoutHeight = Math.max(
      mainResult.endY,
      mainResult.maxFloatBottom
    )
    const shouldAnimate = animate && !isInitialLayout && !reducedMotion
    const mainGroupKeys = Object.create(null)

    for (let g = 0; g < mainResult.groups.length; g++) {
      mainGroupKeys[mainResult.groups[g].key] = true
    }

    const enteringTargets = Object.create(null)
    const nextExitingGroups = []
    const exitingReflowItems = []
    const nextMovingReflowItems = []

    if (shouldAnimate) {
      const enteringByOwner = Object.create(null)

      for (let g = 0; g < mainResult.groups.length; g++) {
        const group = mainResult.groups[g]

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
          mainResult.toggleBottomById[ownerId] ??
          (parentId ? mainResult.toggleBottomById[parentId] : null) ??
          0
        const map = computeOffscreenTargetMap(
          enteringByOwner[ownerId],
          anchorY,
          mainLayoutHeight,
          {stagger: true}
        )
        Object.assign(enteringTargets, map)
      }
    }

    for (let i = 0; i < mainResult.reflowItems.length; i++) {
      const entry = mainResult.reflowItems[i]
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
          mainResult.toggleBottomById[ownerId] ??
          prevToggleBottomById[ownerId] ??
          (parentId
            ? (mainResult.toggleBottomById[parentId] ??
              prevToggleBottomById[parentId])
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

    for (let i = 0; i < mainResult.glyphItems.length; i++) {
      const g = mainResult.glyphItems[i]

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

    hasActiveGlyphMotion = anyGlyphMotion
    activeGroups = mainResult.groups
    activeGlyphItems = mainResult.glyphItems
    activeReflowItems = mainResult.reflowItems
    activeUnderlines = mainResult.underlines
    exitingGroups = nextExitingGroups
    prevToggleBottomById = mainResult.toggleBottomById
    allReflowItems =
      exitingReflowItems.length > 0
        ? [...activeReflowItems, ...exitingReflowItems]
        : activeReflowItems
    movingReflowItems = nextMovingReflowItems
    underlineRuns = activeUnderlines
    hasLayout = activeGroups.length > 0
    renderGroups =
      exitingGroups.length > 0
        ? [...activeGroups, ...exitingGroups]
        : activeGroups

    if (shouldAnimate && nextMovingReflowItems.length > 0) {
      let maxEndMs = reflowDurationMs

      for (let i = 0; i < nextMovingReflowItems.length; i++) {
        const it = nextMovingReflowItems[i]
        const endMs =
          (it.reflowDelay ?? 0) + (it.reflowDuration ?? reflowDurationMs)

        if (endMs > maxEndMs) {
          maxEndMs = endMs
        }
      }

      reflowActive = true
      reflowStartTime = performance.now()
      reflowTotalDurationMs = maxEndMs
      isReflowing = true

      if (mainLayoutHeight < layoutHeight) {
        deferredLayoutHeight = mainLayoutHeight
      } else {
        layoutHeight = mainLayoutHeight
        deferredLayoutHeight = null
      }
    } else {
      reflowActive = false
      reflowTotalDurationMs = reflowDurationMs
      isReflowing = false
      layoutHeight = mainLayoutHeight
      deferredLayoutHeight = null
    }

    scheduleCacheWarm()
  }

  const bindWord = (node, word) => {
    word.el = node
    const initTransform = computeWordTransform(word)
    node.style.transform = initTransform
    word.renderedTransform = initTransform

    return {
      update(nextWord) {
        nextWord.el = node
        const nextTransform = computeWordTransform(nextWord)

        if (nextTransform !== node.style.transform) {
          node.style.transform = nextTransform
        }

        nextWord.renderedTransform = nextTransform
      }
    }
  }

  const bindGlyph = (node, item) => {
    item.el = node
    const initTransform = computeGlyphTransform(item)

    if (initTransform !== '') {
      node.style.transform = initTransform
    }

    item.renderedTransform = initTransform

    if (item.displayChar !== item.char) {
      node.textContent = item.displayChar
      item.renderedChar = item.displayChar
    }

    return {
      update(nextItem) {
        nextItem.el = node
        const nextTransform = computeGlyphTransform(nextItem)

        if (nextTransform !== node.style.transform) {
          node.style.transform = nextTransform
        }

        nextItem.renderedTransform = nextTransform

        if (nextItem.displayChar !== nextItem.renderedChar) {
          node.textContent = nextItem.displayChar
          nextItem.renderedChar = nextItem.displayChar
        }
      }
    }
  }

  const bindBox = (node, item) => {
    item.el = node
    const initTransform = computeBoxTransform(item)

    if (initTransform !== '') {
      node.style.transform = initTransform
    }

    item.renderedTransform = initTransform

    const video = node.querySelector('video')

    if (video && video.paused) {
      video.play().catch(() => {})
    }

    return {
      update(nextItem) {
        nextItem.el = node
        const nextTransform = computeBoxTransform(nextItem)

        if (nextTransform !== node.style.transform) {
          node.style.transform = nextTransform
        }

        nextItem.renderedTransform = nextTransform
      }
    }
  }

  const bindUnderlineSvg = (node, run) => {
    run.svgEl = node
    const initTransform = computeUnderlineTransform(run)
    node.style.transform = initTransform
    run.renderedSvgTransform = initTransform

    return {
      update(nextRun) {
        nextRun.svgEl = node
        const nextTransform = computeUnderlineTransform(nextRun)

        if (nextTransform !== node.style.transform) {
          node.style.transform = nextTransform
        }

        nextRun.renderedSvgTransform = nextTransform
      }
    }
  }

  const bindUnderlinePath = (node, run) => {
    run.pathEl = node
    node.setAttribute('d', run.pathD)
    run.renderedD = run.pathD

    return {
      update(nextRun) {
        nextRun.pathEl = node

        if (nextRun.pathD !== node.getAttribute('d')) {
          node.setAttribute('d', nextRun.pathD)
        }

        nextRun.renderedD = nextRun.pathD
      }
    }
  }

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

  const stepAxis = (current, target) => {
    const delta = target - current
    return Math.abs(delta) > 0.02 ? current + delta * smoothing : target
  }

  const finishReflow = () => {
    const needsDomCleanup = exitingGroups.length > 0
    let hadDeferredBox = false

    reflowActive = false
    isReflowing = false
    exitingGroups = []
    movingReflowItems = []

    for (let i = 0; i < activeReflowItems.length; i++) {
      const entry = activeReflowItems[i]
      entry.reflowDelay = 0
      entry.reflowDuration = reflowDurationMs

      if (entry.kind === 'word') {
        entry.reflowStartX = entry.x
        entry.reflowStartY = entry.y
        entry.reflowEndX = entry.x
        entry.reflowEndY = entry.y
        entry.visX = entry.x
        entry.visY = entry.y

        if (entry.el) {
          const finalT = computeWordTransform(entry)

          if (finalT !== entry.renderedTransform) {
            entry.el.style.transform = finalT
            entry.renderedTransform = finalT
          }
        }
      } else if (entry.kind === 'underline') {
        entry.reflowStartX = entry.x
        entry.reflowStartY = entry.y
        entry.reflowEndX = entry.x
        entry.reflowEndY = entry.y
        entry.visX = entry.x
        entry.visY = entry.y

        if (entry.svgEl) {
          const finalT = computeUnderlineTransform(entry)

          if (finalT !== entry.renderedSvgTransform) {
            entry.svgEl.style.transform = finalT
            entry.renderedSvgTransform = finalT
          }
        }
      } else if (entry.kind === 'box') {
        const targetCx = entry.x + entry.width * 0.5
        const targetCy = entry.y + entry.height * 0.5
        entry.reflowStartCx = targetCx
        entry.reflowStartCy = targetCy
        entry.reflowEndCx = targetCx
        entry.reflowEndCy = targetCy
        entry.visCx = targetCx
        entry.visCy = targetCy
        entry.reflowStartSx = 1
        entry.reflowStartSy = 1
        entry.reflowEndSx = 1
        entry.reflowEndSy = 1
        entry.curReflowSx = 1
        entry.curReflowSy = 1

        if (entry.hasDeferredLayout) {
          entry.domWidth = entry.finalWidth
          entry.domHeight = entry.finalHeight
          entry.hasDeferredLayout = false
          hadDeferredBox = true

          if (entry.el) {
            entry.el.style.width = `${entry.domWidth}px`
            entry.el.style.height = `${entry.domHeight}px`
          }
        }

        if (entry.el) {
          const finalT = computeBoxTransform(entry)

          if (finalT !== entry.renderedTransform) {
            entry.el.style.transform = finalT
            entry.renderedTransform = finalT
          }
        }
      }
    }

    if (hadDeferredBox) {
      const clonedBoxById = Object.create(null)
      activeGroups = activeGroups.map(group =>
        group.items.some(it => it.kind === 'box')
          ? {
              ...group,
              items: group.items.map(it => {
                if (it.kind !== 'box') {
                  return it
                }

                const cloned = {...it}
                clonedBoxById[cloned.id] = cloned
                return cloned
              })
            }
          : group
      )
      activeReflowItems = activeReflowItems.map(
        it => clonedBoxById[it.id] || it
      )
      activeGlyphItems = activeGlyphItems.map(it => clonedBoxById[it.id] || it)
    }

    allReflowItems = activeReflowItems

    if (needsDomCleanup || hadDeferredBox) {
      underlineRuns = activeUnderlines
      renderGroups = activeGroups.slice()
    }

    if (deferredLayoutHeight !== null) {
      layoutHeight = deferredLayoutHeight
      deferredLayoutHeight = null
    }
  }

  const stepAnimation = now => {
    rafId = null

    if (!paragraphEl || !hasLayout) {
      return
    }

    if (reducedMotion) {
      ripples.length = 0
    } else {
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
      pointerActive &&
      !reducedMotion &&
      (maxDegrees !== 0 || maxRepulsion !== 0)
    const hasRipples = ripples.length > 0

    let reflowElapsed = 0
    let reflowJustFinished = false
    const wasReflowActive = reflowActive

    if (wasReflowActive) {
      reflowElapsed = Math.max(0, now - reflowStartTime)

      if (reflowElapsed >= reflowTotalDurationMs) {
        reflowJustFinished = true
      }
    }

    let needsMore = hasRipples || (wasReflowActive && !reflowJustFinished)

    if (wasReflowActive && !reflowJustFinished) {
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

    if (active || hasActiveGlyphMotion || hasRipples) {
      const mx = active ? pointerClientX - (cachedDocLeft - cachedScrollX) : 0
      const my = active ? pointerClientY - (cachedDocTop - cachedScrollY) : 0
      const safeRadius = Math.max(1, radius)
      const safeCore = Math.max(1, coreRadius)
      const radiusSq = safeRadius * safeRadius
      const coreSq = safeCore * safeCore
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

        if (item.kind === 'glyph' && item.alts && item.el) {
          let rippleIntensity = 0

          if (hasRipples) {
            const visCx = item.cx + wordDx
            const visCy = item.cy + wordDy

            for (let r = 0; r < ripples.length; r++) {
              const ripple = ripples[r]
              const waveR = ripple.waveR
              const innerR = Math.max(0, waveR - rippleBandWidth)
              const rdx = visCx - ripple.ox
              const rdy = visCy - ripple.oy
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

        if (active && fieldScale !== 0) {
          const dx = item.cx + wordDx - mx
          const dy = item.cy + wordDy - my
          const distSq = dx * dx + dy * dy

          if (distSq < radiusSq) {
            // Softened inverse-square gravity falloff tapered to 0 at `radius`
            const gravity =
              (1 / (1 + distSq / coreSq) - edgeFalloff) / falloffSpan
            // Tangential alignment (-sin(2θ)) creates a subtle circular ring around the cursor
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

        if (active || item.tx !== 0 || item.ty !== 0 || item.angle !== 0) {
          item.tx = stepAxis(item.tx, targetTx)
          item.ty = stepAxis(item.ty, targetTy)

          const angleDelta = targetAngle - item.angle

          if (Math.abs(angleDelta) > 0.005) {
            item.angle += angleDelta * smoothing
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

      hasActiveGlyphMotion = stillMovingGlyphs

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

    if (reflowJustFinished) {
      finishReflow()
    }

    if (needsMore) {
      rafId = requestAnimationFrame(stepAnimation)
    }
  }

  const ensureAnimationLoop = () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(stepAnimation)
    }
  }

  const hasTextSelection = () => {
    const selection = window.getSelection()
    return Boolean(
      selection && !selection.isCollapsed && selection.toString().length > 0
    )
  }

  const toggleSection = (sectionId, event = null) => {
    const blockedBySelection = hasTextSelection()

    if (event) {
      lastToggleClickEvent = event
      lastToggleBlockedBySelection = blockedBySelection
    }

    if (blockedBySelection) {
      return
    }

    if (expandedIds.has(sectionId)) {
      expandedIds.delete(sectionId)
      const childProjectIds = sections[sectionId]?.projectIds

      if (Array.isArray(childProjectIds)) {
        for (const subId of childProjectIds) {
          expandedIds.delete(subId)
        }
      }
    } else {
      expandedIds.add(sectionId)
    }

    if (hoveredProjectId === sectionId) {
      hoveredProjectId = null
    }

    computeLayout({animate: !reducedMotion, checkStyles: false})
    ensureAnimationLoop()
  }

  const handleToggleKeydown = (event, sectionId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleSection(sectionId, event)
    }
  }

  const handleButtonClick = (token, event) => {
    const blockedBySelection = hasTextSelection()
    lastToggleClickEvent = event
    lastToggleBlockedBySelection = blockedBySelection

    if (!blockedBySelection) {
      token.onclick?.(event)
    }
  }

  const handleButtonKeydown = (event, token) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleButtonClick(token, event)
    }
  }

  const handlePointerMove = event => {
    if (touchOnly) {
      return
    }

    pointerClientX = event.clientX
    pointerClientY = event.clientY
    pointerActive = true
    ensureAnimationLoop()
  }

  const handlePointerLeave = () => {
    if (touchOnly) {
      return
    }

    pointerActive = false
    hoveredProjectId = null
    ensureAnimationLoop()
  }

  const findTouchById = (touches, targetId) => {
    if (!touches || touches.length === 0 || targetId === null) {
      return null
    }

    for (let i = 0; i < touches.length; i++) {
      if ((touches[i].identifier ?? 0) === targetId) {
        return touches[i]
      }
    }

    return null
  }

  const triggerRipple = (clientX, clientY, centered = false) => {
    const rectLeft = cachedDocLeft - cachedScrollX
    const rectTop = cachedDocTop - cachedScrollY
    const rectWidth = cachedMaxWidth
    const rectHeight = layoutHeight
    const ox = centered ? rectWidth / 2 : clientX - rectLeft
    const oy = centered ? rectHeight / 2 : clientY - rectTop
    const maxRadius = Math.hypot(
      Math.max(Math.abs(ox), Math.abs(rectWidth - ox)),
      Math.max(Math.abs(oy), Math.abs(rectHeight - oy))
    )

    ripples.push({
      ox,
      oy,
      waveR: 0,
      startTime: performance.now(),
      maxRadius
    })

    ensureAnimationLoop()
  }

  const updateTouchPointer = touch => {
    activeTouchId = touch.identifier ?? 0
    pointerClientX = touch.clientX
    pointerClientY = touch.clientY
    pointerActive = true
    ensureAnimationLoop()
  }

  const handleTouchStart = event => {
    if (!touchOnly || !paragraphEl || reducedMotion || !hasLayout) {
      return
    }

    const touch = event.changedTouches?.[0] || event.touches?.[0]

    if (!touch) {
      return
    }

    updateTouchPointer(touch)
    triggerRipple(touch.clientX, touch.clientY)
  }

  const handleTouchMove = event => {
    if (!touchOnly || !paragraphEl || reducedMotion || !hasLayout) {
      return
    }

    const touch =
      findTouchById(event.touches, activeTouchId) ||
      findTouchById(event.changedTouches, activeTouchId) ||
      event.changedTouches?.[0] ||
      event.touches?.[0]

    if (!touch) {
      return
    }

    updateTouchPointer(touch)
  }

  const handleTouchEnd = event => {
    if (!touchOnly) {
      return
    }

    if (event.type === 'touchend' && event.touches.length > 0) {
      if (pointerActive && !findTouchById(event.touches, activeTouchId)) {
        updateTouchPointer(event.touches[0])
      }

      return
    }

    activeTouchId = null

    if (pointerActive) {
      pointerActive = false
      ensureAnimationLoop()
    }
  }

  const handleClick = event => {
    const wasToggleEvent = event === lastToggleClickEvent
    lastToggleClickEvent = null

    if (touchOnly || !paragraphEl || reducedMotion || !hasLayout) {
      return
    }

    if (wasToggleEvent) {
      if (lastToggleBlockedBySelection) {
        return
      }
    } else if (ripples.length > 0 && hasTextSelection()) {
      return
    }

    triggerRipple(event.clientX, event.clientY, event.detail === 0)
  }

  const handleScroll = () => {
    cachedScrollX = window.scrollX
    cachedScrollY = window.scrollY

    if (pointerActive) {
      ensureAnimationLoop()
    }
  }

  const handleResize = () => {
    if (!fontsReady) {
      return
    }

    computeLayout({animate: false, checkStyles: true})
    ensureAnimationLoop()
  }

  $effect(() => {
    void copy
    void projects
    void sections

    if (!hasInitializedProps) {
      hasInitializedProps = true
      return
    }

    dataVersion++
    preparedSegmentCache = Object.create(null)
    cachedPlan = null
    warmedCacheKey = ''
    cancelCacheWarm()
    expandedIds.clear()
    activeGroups = []
    activeGlyphItems = []
    activeReflowItems = []
    allReflowItems = []
    movingReflowItems = []
    activeUnderlines = []
    exitingGroups = []
    underlineRuns = []
    prevToggleBottomById = Object.create(null)
    hoveredProjectId = null

    if (fontsReady && paragraphEl) {
      computeLayout({animate: false, checkStyles: true})
      ensureAnimationLoop()
    }
  })

  onMount(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const touchOnlyQuery = window.matchMedia(
      '(hover: none) and (pointer: coarse)'
    )
    reducedMotion = motionQuery.matches
    touchOnly = touchOnlyQuery.matches

    const onMotionChange = event => {
      reducedMotion = event.matches
      ensureAnimationLoop()
    }

    const onTouchOnlyChange = event => {
      touchOnly = event.matches
      activeTouchId = null
      pointerActive = false
      hoveredProjectId = null
      ensureAnimationLoop()
    }

    motionQuery.addEventListener('change', onMotionChange)
    touchOnlyQuery.addEventListener('change', onTouchOnlyChange)

    let resizeObserver = null
    let cancelled = false

    document.fonts.ready.then(() => {
      if (cancelled || !paragraphEl) {
        return
      }

      fontsReady = true
      computeLayout({animate: false, checkStyles: true})
      resizeObserver = new ResizeObserver(() => {
        computeLayout({animate: false, checkStyles: true})
        ensureAnimationLoop()
      })
      resizeObserver.observe(paragraphEl)
    })

    return () => {
      cancelled = true
      cancelCacheWarm()
      motionQuery.removeEventListener('change', onMotionChange)
      touchOnlyQuery.removeEventListener('change', onTouchOnlyChange)

      if (resizeObserver) {
        resizeObserver.disconnect()
      }

      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  })
</script>

<svelte:window
  onpointermove={handlePointerMove}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
  ontouchcancel={handleTouchEnd}
  onclick={handleClick}
  onscroll={handleScroll}
  onresize={handleResize}
/>

<svelte:document onmouseleave={handlePointerLeave} />

{#snippet mediaContent(media, alt)}
  {#if media.sources}
    <enhanced:img src={media} {alt} />
  {:else}
    <video src={media} loop muted autoplay playsinline></video>
  {/if}
{/snippet}

{#snippet glyphSpan(item)}
  <span
    use:bindGlyph={item}
    class="glyph"
    class:descender={item.isInteractive && hasDescender(item.char)}
    class:name={item.styleRole === 'name'}
    class:detail={item.styleRole === 'detail'}
    class:detail-link={item.styleRole === 'detailLink'}
    class:detail-sup={item.styleRole === 'detailSup'}
    class:older-project={item.styleRole === 'olderProject'}
    style:left="{item.domX}px"
    style:top="{item.domY}px"
    style:width="{item.width}px"
    style:height="{item.lineHeight}px"
    style:line-height="{item.lineHeight}px">{item.char}</span
  >
{/snippet}

{#snippet layoutItem(item)}
  {#if item.kind === 'word'}
    <span
      use:bindWord={item}
      class="word"
      class:in-expanded={item.inExpanded}
      class:section-exiting={item.exiting}
      aria-hidden={item.exiting ? 'true' : null}
      style:width="{item.width}px"
      style:height="{item.height}px"
      >{#each item.children as child (child.id)}{@render glyphSpan(
          child
        )}{/each}</span
    >
  {:else if item.kind === 'glyph'}
    <span
      class="glyph space"
      class:name={item.styleRole === 'name'}
      class:detail={item.styleRole === 'detail'}
      class:detail-link={item.styleRole === 'detailLink'}
      class:detail-sup={item.styleRole === 'detailSup'}
      class:older-project={item.styleRole === 'olderProject'}
      style:left="{item.domX}px"
      style:top="{item.domY}px"
      style:width="{item.width}px"
      style:height="{item.lineHeight}px"
      style:line-height="{item.lineHeight}px">{item.char}</span
    >
  {:else if item.kind === 'box'}
    <span
      use:bindBox={item}
      class="inline-box"
      class:expanded={item.expanded}
      class:in-expanded={item.inExpanded}
      class:section-exiting={item.exiting}
      role="button"
      tabindex={item.exiting ? -1 : 0}
      aria-expanded={item.expanded}
      aria-hidden={item.exiting ? 'true' : null}
      inert={Boolean(item.exiting)}
      aria-label={`${item.expanded ? 'Collapse' : 'Expand'} ${item.alt}`}
      style:width="{item.domWidth}px"
      style:height="{item.domHeight}px"
      onclick={event => toggleSection(item.projectId, event)}
      onkeydown={event => handleToggleKeydown(event, item.projectId)}
      onmouseenter={() => (hoveredProjectId = item.projectId)}
      onmouseleave={() => {
        if (hoveredProjectId === item.projectId) {
          hoveredProjectId = null
        }
      }}
    >
      {@render mediaContent(item.media, item.alt)}
    </span>
  {:else if item.kind === 'hitbox'}
    <span
      class="hit-box"
      class:section-exiting={item.exiting}
      aria-hidden="true"
      style:left="{item.x}px"
      style:top="{item.y}px"
      style:width="{item.width}px"
      style:height="{item.height}px"
    ></span>
  {:else if item.kind === 'underline'}
    <svg
      use:bindUnderlineSvg={item}
      class="underline-svg"
      class:in-expanded={item.inExpanded}
      class:section-exiting={item.exiting}
      aria-hidden="true"
      width={Math.ceil(item.width)}
      height={Math.ceil(item.height)}
    >
      <path
        use:bindUnderlinePath={item}
        fill="none"
        stroke="blue"
        stroke-width={item.strokeWidth}
        stroke-linecap="butt"
      />
    </svg>
  {:else}
    <span class="line-gap">{item.char}</span>
  {/if}
{/snippet}

{#snippet activeLinkBody(group)}
  {#each group.items as item (item.id)}
    {@render layoutItem(item)}
  {/each}
{/snippet}

{#snippet fallbackLinkBody(node)}
  {node.text}
{/snippet}

{#snippet linkElement(token, exiting, bodySnippet, bodyArg)}
  {#if isSvelteKitRoute(token)}
    <a
      href={resolve(token.href)}
      class:section-exiting={exiting}
      tabindex={exiting ? -1 : null}
      aria-hidden={exiting ? 'true' : null}
      inert={Boolean(exiting)}
    >
      {@render bodySnippet(bodyArg)}
    </a>
  {:else if opensNewTab(token)}
    <a
      href={token.href}
      rel="external noopener noreferrer"
      target="_blank"
      class:section-exiting={exiting}
      tabindex={exiting ? -1 : null}
      aria-hidden={exiting ? 'true' : null}
      inert={Boolean(exiting)}
    >
      {@render bodySnippet(bodyArg)}
    </a>
  {:else}
    <a
      href={token.href}
      rel="external"
      class:section-exiting={exiting}
      tabindex={exiting ? -1 : null}
      aria-hidden={exiting ? 'true' : null}
      inert={Boolean(exiting)}
    >
      {@render bodySnippet(bodyArg)}
    </a>
  {/if}
{/snippet}

<p
  bind:this={paragraphEl}
  class:pretext-active={hasLayout}
  class:reflowing={isReflowing}
  class:has-expanded={expandedIds.size > 0}
  style:height={hasLayout ? `${layoutHeight}px` : null}
>
  <span class="detail-probe detail" aria-hidden="true" bind:this={detailProbeEl}
  ></span>
  <span
    class="detail-probe detail-link"
    aria-hidden="true"
    bind:this={detailLinkProbeEl}
  ></span>
  <span
    class="detail-probe detail-sup"
    aria-hidden="true"
    bind:this={detailSupProbeEl}
  ></span>
  <span
    class="detail-probe detail-link-gap"
    aria-hidden="true"
    bind:this={detailLinkGapProbeEl}
  ></span>
  <span
    class="detail-probe older-project"
    aria-hidden="true"
    bind:this={olderProjectProbeEl}
  ></span>
  <span class="detail-probe name" aria-hidden="true" bind:this={nameProbeEl}
  ></span>
  {#if hasLayout}
    {#each renderGroups as group (group.key)}
      {#if group.token.kind === 'button'}
        <span
          role="button"
          tabindex="0"
          onclick={event => handleButtonClick(group.token, event)}
          onkeydown={event => handleButtonKeydown(event, group.token)}
        >
          {#each group.items as item (item.id)}
            {@render layoutItem(item)}
          {/each}
        </span>
      {:else if group.token.kind === 'section-toggle'}
        <span
          role="button"
          tabindex="0"
          class="section-toggle"
          class:expanded={group.token.expanded}
          aria-expanded={group.token.expanded}
          onclick={event => toggleSection(group.token.sectionId, event)}
          onkeydown={event => handleToggleKeydown(event, group.token.sectionId)}
        >
          {#each group.items as item (item.id)}
            {@render layoutItem(item)}
          {/each}
        </span>
      {:else if group.token.kind === 'project-toggle'}
        <span
          role="button"
          tabindex={group.exiting ? -1 : 0}
          class="project-toggle"
          class:expanded={group.token.expanded}
          class:hovered={hoveredProjectId === group.token.projectId}
          class:section-exiting={group.exiting}
          aria-expanded={group.token.expanded}
          aria-hidden={group.exiting ? 'true' : null}
          inert={Boolean(group.exiting)}
          onclick={event => toggleSection(group.token.projectId, event)}
          onkeydown={event => handleToggleKeydown(event, group.token.projectId)}
        >
          {#each group.items as item (item.id)}
            {@render layoutItem(item)}
          {/each}
        </span>
      {:else if group.token.kind === 'sup'}
        <sup
          class="detail-sup-group"
          class:section-exiting={group.exiting}
          aria-hidden={group.exiting ? 'true' : null}
          inert={Boolean(group.exiting)}
        >
          {#each group.items as item (item.id)}
            {@render layoutItem(item)}
          {/each}
        </sup>
      {:else if group.token.kind === 'link'}
        {@render linkElement(group.token, group.exiting, activeLinkBody, group)}
      {:else}
        {#each group.items as item (item.id)}
          {@render layoutItem(item)}
        {/each}
      {/if}
    {/each}
  {:else}
    {#each normalizedCopy as node (node.key)}
      {#if node.kind === 'button'}
        <span
          role="button"
          tabindex="0"
          onclick={event => handleButtonClick(node, event)}
          onkeydown={event => handleButtonKeydown(event, node)}
          >{node.text}</span
        >
      {:else if node.kind === 'section'}
        <span role="button">{node.text}</span>
      {:else if node.kind === 'project'}
        {@const project = projects[node.projectId]}
        {#if project}
          <span class="project-fallback"
            ><span role="button">{project.name}</span>&nbsp;<span
              class="inline-media-fallback"
            >
              {@render mediaContent(project.media, project.alt)}
            </span></span
          >
        {/if}
      {:else if node.kind === 'link'}
        {@render linkElement(node, false, fallbackLinkBody, node)}
      {:else if node.styleRole === 'name'}
        <span class="name">{node.text}</span>
      {:else}
        {node.text}
      {/if}
    {/each}
  {/if}
</p>

<style>
  p.pretext-active {
    position: relative;
    font-variant-ligatures: none;
  }

  p a {
    color: inherit;
    text-decoration: underline blue 4px;
  }

  p.pretext-active a,
  p.pretext-active [role='button'] {
    text-decoration: none;
  }

  .word {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    display: inline-block;
    will-change: transform;
    contain: size layout style;
  }

  .glyph {
    position: absolute;
    z-index: 1;
    display: inline-block;
    white-space: pre;
    transform-origin: 50% 54%;
    contain: size layout style;
  }

  .descender {
    text-shadow:
      -2px -2px 0 #fff,
      2px -2px 0 #fff,
      -2px 2px 0 #fff,
      2px 2px 0 #fff,
      0px -2px 0 #fff,
      0px 2px 0 #fff,
      -2px 0px 0 #fff,
      2px 0px 0 #fff;
    z-index: -1 !important;
  }

  .detail-probe {
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }

  .detail-probe.detail,
  .glyph.detail {
    max-width: 60ch;
    font-size: 0.56em;
    line-height: 1.32;
  }

  .detail-probe.detail-link,
  .glyph.detail-link {
    max-width: 50ch;
    font-size: 0.44em;
    line-height: 1.35;
  }

  .detail-sup-group {
    font-size: inherit;
    line-height: inherit;
    vertical-align: baseline;
  }

  .detail-probe.detail-sup,
  .glyph.detail-sup {
    font-size: 0.31em;
    line-height: 1;
    vertical-align: 0.58em;
  }

  .detail-probe.detail-link-gap {
    font-size: 0.44em;
    line-height: 1.35;
    letter-spacing: 1.4em;
  }

  .detail-probe.older-project,
  .glyph.older-project {
    max-width: 50ch;
    font-size: 0.6em;
    line-height: 1.25;
  }

  .detail-probe.name,
  .glyph.name,
  .name {
    font-weight: 600;
    font-style: italic;
  }

  .hit-box {
    position: absolute;
    z-index: 2;
    cursor: pointer;
    user-select: none;
  }

  .underline-svg {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -2;
    display: block;
    overflow: visible;
    pointer-events: none;
    will-change: transform;
  }

  .glyph.space {
    pointer-events: none;
  }

  [role='button'] .word,
  p.pretext-active a .word {
    z-index: 3;
    cursor: pointer;
  }

  [role='button'] .glyph,
  p.pretext-active a .glyph {
    z-index: 3;
    pointer-events: auto;
    cursor: pointer;
  }

  .section-toggle:hover .glyph,
  .project-toggle:hover .glyph,
  .project-toggle.hovered .glyph,
  p.pretext-active a:hover .glyph,
  .project-fallback:has(.inline-media-fallback:hover) [role='button'] {
    color: blue;
  }

  .project-fallback {
    white-space: nowrap;
  }

  .inline-box {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
    display: inline-block;
    text-decoration: none;
    transform-origin: 50% 50%;
    cursor: pointer;
    will-change: transform;
  }

  p.pretext-active .section-exiting,
  p.pretext-active .section-exiting .word,
  p.pretext-active .section-exiting .glyph,
  p.pretext-active .word.section-exiting,
  p.pretext-active .inline-box.section-exiting,
  p.pretext-active .underline-svg.section-exiting,
  p.pretext-active .hit-box.section-exiting {
    pointer-events: none;
    user-select: none;
  }

  .inline-box :global(picture),
  .inline-box :global(img),
  .inline-box :global(video),
  .inline-media-fallback :global(picture),
  .inline-media-fallback :global(img),
  .inline-media-fallback :global(video) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .inline-media-fallback {
    display: inline-block;
    height: 1lh;
    aspect-ratio: 1;
    vertical-align: top;
  }

  .line-gap {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    white-space: pre;
    pointer-events: none;
  }
</style>
