<script>
  import {onMount} from 'svelte'
  import {SvelteSet} from 'svelte/reactivity'
  import {resolve} from '$app/paths'
  import {materializeRichInlineLineRange} from '@chenglou/pretext/rich-inline'
  import garamondGlyphs from '#lib/glyphs'
  import {
    annotateCopyFootnotes,
    buildLayoutSegments,
    buildPrerenderSubsections,
    buildUnderlinePath,
    buildWarmSpecs,
    computeBoxTransform,
    computeGlyphTransform,
    computeUnderlineTransform,
    computeWordTransform,
    detailBottomGapRatio,
    detailLinksGapRatio,
    evalReflowEase,
    externalLinkArrow,
    getMediaAspect,
    getParentSectionId,
    getStyleKey,
    getSupGap,
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
  import {
    createScreensaverController,
    idleDelayMs,
    screensaverExitDurationMs,
    screensaverExitMinSmoothing,
    screensaverSmoothing
  } from '#lib/kineticScreensaver'
  import '../styles/main.css'

  const {copy = [], projects = {}, sections = {}} = $props()

  const normalizedCopy = $derived(normalizeCopy(copy))
  const fallbackCopy = $derived(
    annotateCopyFootnotes(normalizedCopy, projects, sections)
  )
  const prerenderSubsections = $derived(
    buildPrerenderSubsections(normalizedCopy, projects, sections)
  )

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
  let bodySupProbeEl = $state(null)
  let bodyArrowProbeEl = $state(null)
  let detailSupProbeEl = $state(null)
  let detailLinkSupProbeEl = $state(null)
  let olderProjectSupProbeEl = $state(null)
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
  let pressedKey = $state(null)
  let pressedProjectId = $state(null)
  let touchInput = $state(false)

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
  let pressedTouchId = null
  let lastToggleClickEvent = null
  let lastToggleBlockedBySelection = false
  let warmIdleHandle = null
  let warmIdleUsesCallback = false
  let warmedCacheKey = ''
  let rafId = null
  const ripples = []
  const screensaver = createScreensaverController({radius})
  let screensaverActive = false
  let screensaverX = 0
  let screensaverY = 0
  let screensaverStrength = 0
  let screensaverExitTime = 0
  let lastStepTime = 0
  let idleTimerId = null
  let idlePendingStart = false
  let touchDown = false
  let hasLastRealPointer = false
  let lastRealPointerX = 0
  let lastRealPointerY = 0

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
    const indentByOwner = Object.create(null)
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
      !bodySupProbeEl ||
      !bodyArrowProbeEl ||
      !detailSupProbeEl ||
      !detailLinkSupProbeEl ||
      !olderProjectSupProbeEl ||
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
        bodySup: readTypography(bodySupProbeEl, ctx, bodyStyle.fontSize),
        bodyArrow: readTypography(bodyArrowProbeEl, ctx, bodyStyle.fontSize),
        detailSup: readTypography(detailSupProbeEl, ctx, bodyStyle.fontSize),
        detailLinkSup: readTypography(
          detailLinkSupProbeEl,
          ctx,
          bodyStyle.fontSize
        ),
        olderProjectSup: readTypography(
          olderProjectSupProbeEl,
          ctx,
          bodyStyle.fontSize
        ),
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
        const inheritedIndent =
          seg.inheritIndent && seg.ownerId
            ? (indentByOwner[seg.ownerId] ?? 0)
            : 0
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

            const supBeforeGap =
              token.kind === 'sup' && token.supPosition === 'trailing'
                ? getSupGap(token, activeStyles)
                : 0
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
                    alts:
                      token.kind === 'sup'
                        ? null
                        : garamondGlyphs[segment] || null,
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

  const stepAxis = (current, target, factor = smoothing) => {
    const delta = target - current
    return Math.abs(delta) > 0.02 ? current + delta * factor : target
  }

  const getVisibleBodyBounds = () => {
    const pLeft = cachedDocLeft - cachedScrollX
    const pTop = cachedDocTop - cachedScrollY
    const vpLeft = -pLeft
    const vpRight = window.innerWidth - pLeft
    const vpTop = -pTop
    const vpBottom = window.innerHeight - pTop
    let left = Math.max(0, vpLeft)
    let right = Math.min(cachedMaxWidth, vpRight)
    let top = Math.max(0, vpTop)
    let bottom = Math.min(layoutHeight, vpBottom)

    if (right - left < 40) {
      left = 0
      right = cachedMaxWidth
    }

    if (bottom - top < 40) {
      top = 0
      bottom = layoutHeight
    }

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    }
  }

  const clearIdleTimer = () => {
    if (idleTimerId !== null) {
      clearTimeout(idleTimerId)
      idleTimerId = null
    }

    idlePendingStart = false
  }

  const stopScreensaver = ({smoothExit = true} = {}) => {
    if (!screensaverActive) {
      return false
    }

    screensaverActive = false
    screensaverStrength = 0
    screensaver.stop()
    screensaverExitTime = smoothExit ? performance.now() : 0
    return true
  }

  const startScreensaver = () => {
    idleTimerId = null

    if (reducedMotion || document.hidden || touchDown) {
      return
    }

    if (!fontsReady || !hasLayout || cachedMaxWidth <= 0 || layoutHeight <= 0) {
      idlePendingStart = true
      return
    }

    idlePendingStart = false
    const bounds = getVisibleBodyBounds()
    const startPointer =
      pointerActive && !touchOnly
        ? {
            x: pointerClientX - (cachedDocLeft - cachedScrollX),
            y: pointerClientY - (cachedDocTop - cachedScrollY)
          }
        : null
    const init = screensaver.start(bounds, startPointer)

    screensaverX = init.x
    screensaverY = init.y
    screensaverStrength = init.strength
    screensaverExitTime = 0
    screensaverActive = true
    lastStepTime = performance.now()
    ensureAnimationLoop()
  }

  const scheduleIdleTimer = () => {
    clearIdleTimer()

    if (reducedMotion || document.hidden || touchDown) {
      return
    }

    idleTimerId = setTimeout(startScreensaver, idleDelayMs)
  }

  const recordUserActivity = ({pauseIdle = false} = {}) => {
    const wasScreensaver = stopScreensaver({smoothExit: true})

    if (pauseIdle) {
      clearIdleTimer()
    } else {
      scheduleIdleTimer()
    }

    if (wasScreensaver) {
      ensureAnimationLoop()
    }

    return wasScreensaver
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

    const dt =
      lastStepTime > 0 ? Math.min(64, Math.max(1, now - lastStepTime)) : 16.6667
    lastStepTime = now

    if (reducedMotion) {
      ripples.length = 0
      stopScreensaver({smoothExit: false})
    } else {
      if (document.hidden && screensaverActive) {
        stopScreensaver({smoothExit: false})
      }

      if (screensaverActive) {
        const next = screensaver.step(dt, getVisibleBodyBounds())
        screensaverX = next.x
        screensaverY = next.y
        screensaverStrength = next.strength
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
      (pointerActive || screensaverActive) &&
      !reducedMotion &&
      (maxDegrees !== 0 || maxRepulsion !== 0)
    const fieldIntensity = screensaverActive ? screensaverStrength : 1
    let stepSmoothing = smoothing

    if (screensaverActive) {
      stepSmoothing = 1 - (1 - screensaverSmoothing) ** (dt / 16.6667)
    } else if (screensaverExitTime > 0) {
      const exitU = Math.min(
        1,
        Math.max(0, (now - screensaverExitTime) / screensaverExitDurationMs)
      )

      if (exitU >= 1) {
        screensaverExitTime = 0
      } else {
        const eased = exitU * exitU * (3 - 2 * exitU)
        const baseFactor =
          screensaverExitMinSmoothing +
          (smoothing - screensaverExitMinSmoothing) * eased
        stepSmoothing = 1 - (1 - baseFactor) ** (dt / 16.6667)
      }
    }

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

    let needsMore =
      screensaverActive ||
      hasRipples ||
      (wasReflowActive && !reflowJustFinished)

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
      const mx = active
        ? screensaverActive
          ? screensaverX
          : pointerClientX - (cachedDocLeft - cachedScrollX)
        : 0
      const my = active
        ? screensaverActive
          ? screensaverY
          : pointerClientY - (cachedDocTop - cachedScrollY)
        : 0
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

        if (active && fieldScale !== 0 && fieldIntensity > 0) {
          const dx = item.cx + wordDx - mx
          const dy = item.cy + wordDy - my
          const distSq = dx * dx + dy * dy

          if (distSq < radiusSq) {
            // Softened inverse-square gravity falloff tapered to 0 at `radius`
            const gravity =
              ((1 / (1 + distSq / coreSq) - edgeFalloff) / falloffSpan) *
              fieldIntensity
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
      lastStepTime = 0
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

  const setTouchInput = value => {
    if (touchInput === value) {
      return
    }

    touchInput = value
    document.documentElement.classList.toggle('touch-input', value)
  }

  const clearTouchPress = () => {
    pressedTouchId = null
    pressedKey = null
    pressedProjectId = null
  }

  const handleTouchInterrupt = () => {
    const hadTouch = touchDown
    touchDown = false
    clearTouchPress()
    hoveredProjectId = null

    if (hadTouch && !screensaverActive && idleTimerId === null) {
      scheduleIdleTimer()
    }
  }

  const handlePageHide = () => {
    handleTouchInterrupt()
    clearIdleTimer()
    stopScreensaver({smoothExit: false})
  }

  const handlePageShow = () => {
    if (!screensaverActive && idleTimerId === null) {
      scheduleIdleTimer()
    }
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      handleTouchInterrupt()
      clearIdleTimer()
      stopScreensaver({smoothExit: false})
    } else {
      scheduleIdleTimer()

      if (hasActiveGlyphMotion) {
        ensureAnimationLoop()
      }
    }
  }

  const handlePointerDown = event => {
    const isTouch = event.pointerType === 'touch'

    if (isTouch) {
      touchDown = true
    }

    recordUserActivity({pauseIdle: isTouch})

    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      setTouchInput(false)
    }

    if (!touchOnly && !isTouch) {
      lastRealPointerX = event.clientX
      lastRealPointerY = event.clientY
      hasLastRealPointer = true
      pointerClientX = event.clientX
      pointerClientY = event.clientY
      pointerActive = true
      ensureAnimationLoop()
    }
  }

  const handlePointerMove = event => {
    if (
      hasLastRealPointer &&
      event.clientX === lastRealPointerX &&
      event.clientY === lastRealPointerY
    ) {
      return
    }

    lastRealPointerX = event.clientX
    lastRealPointerY = event.clientY
    hasLastRealPointer = true
    recordUserActivity({pauseIdle: touchDown})

    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      setTouchInput(false)
    }

    if (touchOnly) {
      return
    }

    pointerClientX = event.clientX
    pointerClientY = event.clientY
    pointerActive = true
    ensureAnimationLoop()
  }

  const handlePointerLeave = () => {
    hasLastRealPointer = false

    if (touchOnly) {
      return
    }

    pointerActive = false
    hoveredProjectId = null
    recordUserActivity()
    ensureAnimationLoop()
  }

  const handleKeyDown = () => {
    recordUserActivity({pauseIdle: touchDown})
  }

  const handleWheel = () => {
    recordUserActivity({pauseIdle: touchDown})
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
    touchDown = true
    recordUserActivity({pauseIdle: true})
    setTouchInput(true)
    hoveredProjectId = null

    const touch = event.changedTouches?.[0] || event.touches?.[0]

    if (touch && paragraphEl) {
      const targetEl =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement
      const interactiveEl = targetEl?.closest(
        '[data-press-key], [data-project-id]'
      )

      if (
        interactiveEl &&
        paragraphEl.contains(interactiveEl) &&
        !interactiveEl.closest('.section-exiting')
      ) {
        pressedTouchId = touch.identifier ?? 0

        if (interactiveEl.dataset.projectId) {
          pressedProjectId = interactiveEl.dataset.projectId
          pressedKey = null
        } else {
          pressedKey = interactiveEl.dataset.pressKey ?? null
          pressedProjectId = null
        }
      } else if (
        pressedTouchId !== null &&
        (event.touches.length <= 1 ||
          !findTouchById(event.touches, pressedTouchId))
      ) {
        clearTouchPress()
      }
    }

    if (!touchOnly || !paragraphEl || reducedMotion || !hasLayout || !touch) {
      return
    }

    updateTouchPointer(touch)
    triggerRipple(touch.clientX, touch.clientY)
  }

  const handleTouchMove = event => {
    touchDown = event.touches.length > 0
    recordUserActivity({pauseIdle: touchDown})

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
    touchDown = event.type === 'touchend' && event.touches.length > 0
    recordUserActivity({pauseIdle: touchDown})

    if (
      pressedTouchId !== null &&
      (event.type !== 'touchend' ||
        event.touches.length === 0 ||
        !findTouchById(event.touches, pressedTouchId))
    ) {
      clearTouchPress()
    }

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
    recordUserActivity({pauseIdle: touchDown})
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
    const wasScreensaver = recordUserActivity({pauseIdle: touchDown})

    if (pointerActive || wasScreensaver) {
      ensureAnimationLoop()
    }
  }

  const handleResize = () => {
    recordUserActivity({pauseIdle: touchDown})

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
    clearTouchPress()
    stopScreensaver({smoothExit: false})
    scheduleIdleTimer()

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

      if (reducedMotion) {
        clearIdleTimer()
        stopScreensaver({smoothExit: false})
      } else {
        scheduleIdleTimer()
      }

      ensureAnimationLoop()
    }

    const onTouchOnlyChange = event => {
      touchOnly = event.matches
      activeTouchId = null
      touchDown = false
      pointerActive = false
      hoveredProjectId = null
      clearTouchPress()
      stopScreensaver({smoothExit: false})
      scheduleIdleTimer()
      ensureAnimationLoop()
    }

    motionQuery.addEventListener('change', onMotionChange)
    touchOnlyQuery.addEventListener('change', onTouchOnlyChange)
    scheduleIdleTimer()

    let resizeObserver = null
    let cancelled = false

    document.fonts.ready.then(() => {
      if (cancelled || !paragraphEl) {
        return
      }

      fontsReady = true
      computeLayout({animate: false, checkStyles: true})

      if (idlePendingStart) {
        startScreensaver()
      }

      resizeObserver = new ResizeObserver(() => {
        computeLayout({animate: false, checkStyles: true})
        ensureAnimationLoop()
      })
      resizeObserver.observe(paragraphEl)
    })

    return () => {
      cancelled = true
      clearIdleTimer()
      stopScreensaver({smoothExit: false})
      cancelCacheWarm()
      clearTouchPress()
      setTouchInput(false)
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
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
  ontouchcancel={handleTouchEnd}
  onkeydown={handleKeyDown}
  onwheel={handleWheel}
  onblur={handleTouchInterrupt}
  onpagehide={handlePageHide}
  onpageshow={handlePageShow}
  oncontextmenu={clearTouchPress}
  onclick={handleClick}
  onscroll={handleScroll}
  onresize={handleResize}
/>

<svelte:document
  onmouseleave={handlePointerLeave}
  onvisibilitychange={handleVisibilityChange}
/>

{#snippet mediaContent(media, alt)}
  {#if media.sources}
    <enhanced:img src={media} {alt} loading="eager" />
  {:else}
    <video src={media} preload="auto" loop muted autoplay playsinline></video>
  {/if}
{/snippet}

{#snippet preloadMediaContent(media, alt)}
  {#if media.sources}
    <enhanced:img src={media} {alt} loading="eager" decoding="async" />
  {:else}
    <video src={media} preload="auto" muted playsinline></video>
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
    class:body-sup={item.styleRole === 'bodySup'}
    class:body-arrow={item.styleRole === 'bodyArrow'}
    class:detail-sup={item.styleRole === 'detailSup'}
    class:detail-link-sup={item.styleRole === 'detailLinkSup'}
    class:older-project-sup={item.styleRole === 'olderProjectSup'}
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
      class:body-sup={item.styleRole === 'bodySup'}
      class:body-arrow={item.styleRole === 'bodyArrow'}
      class:detail-sup={item.styleRole === 'detailSup'}
      class:detail-link-sup={item.styleRole === 'detailLinkSup'}
      class:older-project-sup={item.styleRole === 'olderProjectSup'}
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
      data-project-id={item.exiting ? null : item.projectId}
      tabindex={item.exiting ? -1 : 0}
      aria-expanded={item.expanded}
      aria-hidden={item.exiting ? 'true' : null}
      inert={Boolean(item.exiting)}
      aria-label={`${item.expanded ? 'Collapse' : 'Expand'} ${item.alt}`}
      style:width="{item.domWidth}px"
      style:height="{item.domHeight}px"
      onclick={event => toggleSection(item.projectId, event)}
      onkeydown={event => handleToggleKeydown(event, item.projectId)}
      onpointerenter={event => {
        if (event.pointerType === 'touch' || touchOnly) {
          return
        }

        setTouchInput(false)
        hoveredProjectId = item.projectId
      }}
      onpointerleave={() => {
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
  {node.text ?? node.label}
{/snippet}

{#snippet linkElement(token, exiting, bodySnippet, bodyArg)}
  {@const pressKey = exiting ? null : (token.key ?? null)}
  {@const isTouchActive = Boolean(pressKey) && pressedKey === pressKey}
  {#if isSvelteKitRoute(token)}
    <a
      href={resolve(token.href)}
      data-press-key={pressKey}
      class:touch-active={isTouchActive}
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
      data-press-key={pressKey}
      class:touch-active={isTouchActive}
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
      data-press-key={pressKey}
      class:touch-active={isTouchActive}
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
  class:touch-input={touchInput}
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
    class="detail-probe body-sup"
    aria-hidden="true"
    bind:this={bodySupProbeEl}
  ></span>
  <span
    class="detail-probe body-arrow"
    aria-hidden="true"
    bind:this={bodyArrowProbeEl}
  ></span>
  <span
    class="detail-probe detail-sup"
    aria-hidden="true"
    bind:this={detailSupProbeEl}
  ></span>
  <span
    class="detail-probe detail-link-sup"
    aria-hidden="true"
    bind:this={detailLinkSupProbeEl}
  ></span>
  <span
    class="detail-probe older-project-sup"
    aria-hidden="true"
    bind:this={olderProjectSupProbeEl}
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
          data-press-key={group.key}
          class:touch-active={pressedKey === group.key}
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
          data-press-key={group.key}
          class:expanded={group.token.expanded}
          class:touch-active={pressedKey === group.key}
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
          data-project-id={group.exiting ? null : group.token.projectId}
          class:expanded={group.token.expanded}
          class:hovered={!group.exiting &&
            hoveredProjectId === group.token.projectId}
          class:touch-active={!group.exiting &&
            pressedProjectId === group.token.projectId}
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
    {#each fallbackCopy as node (node.key)}
      {#if node.kind === 'button'}
        <span
          role="button"
          tabindex="0"
          data-press-key={node.key}
          class:touch-active={pressedKey === node.key}
          onclick={event => handleButtonClick(node, event)}
          onkeydown={event => handleButtonKeydown(event, node)}
          >{node.text}</span
        >
      {:else if node.kind === 'section'}
        <span
          role="button"
          data-press-key={node.key}
          class:touch-active={pressedKey === node.key}>{node.text}</span
        >{#if node.footnote}<sup class="body-sup-fallback">{node.footnote}</sup
          >{/if}
      {:else if node.kind === 'project'}
        {@const project = projects[node.projectId]}
        {#if project}
          <span
            class="project-fallback"
            data-project-id={node.projectId}
            class:touch-active={pressedProjectId === node.projectId}
            ><span role="button">{project.name}</span>{#if node.footnote}<sup
                class="body-sup-fallback">{node.footnote}</sup
              >{/if}&nbsp;<span class="inline-media-fallback">
              {@render mediaContent(project.media, project.alt)}
            </span></span
          >
        {/if}
      {:else if node.kind === 'link'}
        {@render linkElement(
          node,
          false,
          fallbackLinkBody,
          node
        )}{#if opensNewTab(node)}<sup class="body-arrow-fallback"
            >{externalLinkArrow}</sup
          >{/if}
      {:else if node.styleRole === 'name'}
        <span class="name">{node.text}</span>
      {:else}
        {node.text}
      {/if}
    {/each}
  {/if}
</p>

{#if prerenderSubsections.length > 0}
  <div class="prerendered-subsections" aria-hidden="true" inert>
    {#each prerenderSubsections as sub (sub.key)}
      <section>
        <h2>{sub.title}</h2>
        {#if sub.kind === 'section-projects'}
          {#each sub.projects as project (project.key)}
            <article>
              <h3>{project.name}</h3>
              {#if project.media}
                {@render preloadMediaContent(project.media, project.alt)}
              {/if}
              {#if project.details}
                <p>{project.details}</p>
              {/if}
              {#if project.links.length > 0}
                <ul>
                  {#each project.links as link (link.href)}
                    <li>
                      {@render linkElement(link, false, fallbackLinkBody, link)}
                    </li>
                  {/each}
                </ul>
              {/if}
            </article>
          {/each}
        {:else}
          {#if sub.details}
            <p>{sub.details}</p>
          {/if}
          {#if sub.links.length > 0}
            <ul>
              {#each sub.links as link (link.href)}
                <li>
                  {@render linkElement(link, false, fallbackLinkBody, link)}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}

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

  .detail-probe.body-sup,
  .glyph.body-sup {
    font-size: 0.34em;
    line-height: 1;
    vertical-align: 1.35em;
  }

  .detail-probe.body-arrow,
  .glyph.body-arrow {
    font-size: 0.3em;
    line-height: 1;
    vertical-align: 1.55em;
  }

  .body-sup-fallback {
    font-size: 0.34em;
    line-height: 1;
    vertical-align: 1.35em;
    margin-left: 0.05em;
  }

  .body-arrow-fallback {
    display: inline-block;
    font-size: 0.3em;
    line-height: 1;
    vertical-align: 1.55em;
    margin-left: 0.05em;
    transform: rotate(-45deg);
  }

  .detail-probe.detail-sup,
  .glyph.detail-sup {
    font-size: 0.34em;
    line-height: 1;
    vertical-align: 0.56em;
  }

  .detail-probe.detail-link-sup,
  .glyph.detail-link-sup {
    font-size: 0.24em;
    line-height: 1;
    vertical-align: 0.92em;
  }

  .detail-probe.older-project-sup,
  .glyph.older-project-sup {
    font-size: 0.36em;
    line-height: 1;
    vertical-align: 0.72em;
  }

  .detail-probe.detail-link-gap {
    font-size: 0.44em;
    line-height: 1.35;
    letter-spacing: 0.8em;
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

  @media (hover: hover) and (pointer: fine) {
    p:not(.touch-input) .section-toggle:hover .glyph,
    p:not(.touch-input) .project-toggle:hover .glyph,
    p.pretext-active:not(.touch-input) a:hover .glyph,
    p:not(.touch-input) [role='button']:hover .glyph,
    p:not(.touch-input)
      .project-fallback:has(.inline-media-fallback:hover)
      [role='button'] {
      color: blue;
    }
  }

  .project-toggle.hovered .glyph,
  .touch-active .glyph,
  p:not(.pretext-active) a.touch-active,
  p:not(.pretext-active) [role='button'].touch-active,
  .project-fallback.touch-active [role='button'] {
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

  .prerendered-subsections {
    position: fixed;
    top: 0;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
    pointer-events: none;
  }
</style>
