<script>
  import {flushSync, onMount} from 'svelte'
  import {SvelteSet} from 'svelte/reactivity'
  import {
    annotateCopyFootnotes,
    buildLayoutSegments,
    buildPrerenderSubsections,
    computeBoxTransform,
    computeGlyphTransform,
    computeTypographyStyles,
    computeUnderlineTransform,
    computeWordTransform,
    externalLinkArrow,
    getCollapsedPrefetchUrls,
    hasDescender,
    normalizeCopy,
    opensNewTab,
    prepareSegmentList
  } from '#lib/kineticLayout'
  import {
    buildPositionedLayout,
    offscreenBuffer,
    radius,
    reflowDurationMs,
    stepPhysicsFrame
  } from '#lib/kineticPhysics'
  import {
    createScreensaverController,
    idleDelayMs
  } from '#lib/kineticScreensaver'

  const {copy = [], projects = {}, sections = {}} = $props()

  const normalizedCopy = $derived(normalizeCopy(copy))
  const fallbackCopy = $derived(
    annotateCopyFootnotes(normalizedCopy, projects, sections)
  )
  const prerenderSubsections = $derived(
    buildPrerenderSubsections(normalizedCopy, projects, sections)
  )

  let rootEl = $state(null)
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
  let fullResImagesReady = $state(false)

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
  let cachedPlan = null
  let cachedLocale = ''
  let cachedSegmenter = null
  let textWidthCache = Object.create(null)
  let preparedSegmentCache = Object.create(null)
  let fragmentGlyphCache = Object.create(null)
  let cacheStyleKey = ''
  let fontsReady = false
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

  const mountedVideos = []
  let visibleVideos = new WeakSet()
  let videoObserver = null

  const syncVideoPlayback = video => {
    const shouldPlay =
      !reducedMotion && !document.hidden && visibleVideos.has(video)

    if (shouldPlay) {
      if (video.paused) {
        video.play().catch(() => {})
      }
    } else {
      if (!video.paused) {
        video.pause()
      }

      if (reducedMotion && video.currentTime > 0) {
        try {
          video.currentTime = 0
        } catch {
          // Ignore seek before metadata is ready
        }
      }
    }
  }

  const syncAllVideos = () => {
    for (const video of mountedVideos) {
      syncVideoPlayback(video)
    }
  }

  const getVideoObserver = () => {
    if (!videoObserver && typeof IntersectionObserver === 'function') {
      videoObserver = new IntersectionObserver(entries => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]
          const el = entry.target

          if (entry.isIntersecting) {
            visibleVideos.add(el)
          } else {
            visibleVideos.delete(el)
          }

          syncVideoPlayback(el)
        }
      })
    }

    return videoObserver
  }

  const bindMediaVideo = video => {
    video.muted = true
    mountedVideos.push(video)
    const obs = getVideoObserver()

    if (obs) {
      obs.observe(video)
    } else {
      visibleVideos.add(video)
    }

    syncVideoPlayback(video)

    return {
      destroy() {
        const idx = mountedVideos.indexOf(video)

        if (idx >= 0) {
          mountedVideos.splice(idx, 1)
        }

        visibleVideos.delete(video)
        obs?.unobserve(video)
      }
    }
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
      measureCtx = document.createElement('canvas').getContext('2d')
    }

    return measureCtx
  }

  const preparePlan = (styles, styleKey, ctx) => {
    if (cacheStyleKey !== styleKey) {
      textWidthCache = Object.create(null)
      preparedSegmentCache = Object.create(null)
      fragmentGlyphCache = Object.create(null)
      cacheStyleKey = styleKey
    }

    return prepareSegmentList(
      buildLayoutSegments(normalizedCopy, projects, sections, expandedIds),
      styles,
      ctx,
      textWidthCache,
      preparedSegmentCache
    )
  }

  const computeLayout = ({animate = false, checkStyles = true} = {}) => {
    if (!rootEl) {
      return
    }

    const maxWidth = rootEl.clientWidth

    if (maxWidth <= 0) {
      return
    }

    const ctx = getMeasureContext()
    let styles = cachedStyles
    let styleKey = cachedStyleKey

    if (checkStyles || !styles) {
      const computed = computeTypographyStyles(rootEl, ctx)
      styles = computed.styles
      styleKey = computed.styleKey
    }

    const pRect = rootEl.getBoundingClientRect()
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
      cachedStyleKey === styleKey &&
      cachedExpandedKey === expandedKey &&
      cachedMaxWidth === maxWidth &&
      cachedOffscreenX === offscreenX
    ) {
      return
    }

    if (
      !cachedPlan ||
      cachedStyleKey !== styleKey ||
      cachedExpandedKey !== expandedKey
    ) {
      cachedPlan = preparePlan(styles, styleKey, ctx)
      cachedStyles = styles
      cachedStyleKey = styleKey
      cachedExpandedKey = expandedKey
    }

    cachedMaxWidth = maxWidth
    cachedOffscreenX = offscreenX

    const result = buildPositionedLayout({
      planSegments: cachedPlan,
      activeStyles: cachedStyles,
      styleKey: cachedStyleKey,
      maxWidth,
      offscreenX,
      ctx,
      segmenter: getSegmenter(),
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
    })

    hasActiveGlyphMotion = result.anyGlyphMotion
    activeGroups = result.groups
    activeGlyphItems = result.glyphItems
    activeReflowItems = result.reflowItems
    activeUnderlines = result.underlines
    exitingGroups = result.exitingGroups
    prevToggleBottomById = result.toggleBottomById
    allReflowItems =
      result.exitingReflowItems.length > 0
        ? [...activeReflowItems, ...result.exitingReflowItems]
        : activeReflowItems
    movingReflowItems = result.movingReflowItems
    underlineRuns = activeUnderlines
    hasLayout = activeGroups.length > 0
    renderGroups =
      exitingGroups.length > 0
        ? [...activeGroups, ...exitingGroups]
        : activeGroups

    if (result.shouldAnimate && result.movingReflowItems.length > 0) {
      let maxEndMs = reflowDurationMs

      for (let i = 0; i < result.movingReflowItems.length; i++) {
        const it = result.movingReflowItems[i]
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

      if (result.mainLayoutHeight < layoutHeight) {
        deferredLayoutHeight = result.mainLayoutHeight
      } else {
        layoutHeight = result.mainLayoutHeight
        deferredLayoutHeight = null
      }
    } else {
      reflowActive = false
      reflowTotalDurationMs = reflowDurationMs
      isReflowing = false
      layoutHeight = result.mainLayoutHeight
      deferredLayoutHeight = null
    }
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

  const getVisibleBodyBounds = () => {
    const pLeft = cachedDocLeft - cachedScrollX
    const pTop = cachedDocTop - cachedScrollY
    let left = Math.max(0, -pLeft)
    let right = Math.min(cachedMaxWidth, window.innerWidth - pLeft)
    let top = Math.max(0, -pTop)
    let bottom = Math.min(layoutHeight, window.innerHeight - pTop)

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

    if (!rootEl || !hasLayout) {
      return
    }

    const dt =
      lastStepTime > 0 ? Math.min(64, Math.max(1, now - lastStepTime)) : 16.6667
    lastStepTime = now

    const next = stepPhysicsFrame({
      now,
      dt,
      reducedMotion,
      pointerActive,
      pointerX: pointerClientX - (cachedDocLeft - cachedScrollX),
      pointerY: pointerClientY - (cachedDocTop - cachedScrollY),
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
    })

    screensaverActive = next.screensaverActive
    screensaverX = next.screensaverX
    screensaverY = next.screensaverY
    screensaverStrength = next.screensaverStrength
    screensaverExitTime = next.screensaverExitTime
    hasActiveGlyphMotion = next.hasActiveGlyphMotion

    if (next.reflowJustFinished) {
      finishReflow()
    }

    if (next.needsMore) {
      rafId = requestAnimationFrame(stepAnimation)
    }
  }

  const ensureAnimationLoop = () => {
    if (rafId === null) {
      lastStepTime = 0
      rafId = requestAnimationFrame(stepAnimation)
    }
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

  const toggleSection = sectionId => {
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
    syncAllVideos()

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

    if (touch && rootEl) {
      const targetEl =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement
      const interactiveEl = targetEl?.closest(
        '[data-press-key], [data-project-id]'
      )

      if (
        interactiveEl &&
        rootEl.contains(interactiveEl) &&
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

    if (!touchOnly || !rootEl || reducedMotion || !hasLayout || !touch) {
      return
    }

    updateTouchPointer(touch)
    triggerRipple(touch.clientX, touch.clientY)
  }

  const handleTouchMove = event => {
    touchDown = event.touches.length > 0
    recordUserActivity({pauseIdle: touchDown})

    if (!touchOnly || !rootEl || reducedMotion || !hasLayout) {
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

    if (touchOnly || !rootEl || reducedMotion || !hasLayout) {
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

  onMount(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const touchOnlyQuery = window.matchMedia(
      '(hover: none) and (pointer: coarse)'
    )
    reducedMotion = motionQuery.matches
    touchOnly = touchOnlyQuery.matches
    syncAllVideos()

    const onMotionChange = event => {
      reducedMotion = event.matches
      syncAllVideos()

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
    let prefetchIdleId = null
    let prefetchUsesIdle = false
    let cancelled = false

    const preloadAndDecodeImage = (media, expandedSize = 260) => {
      const picture = document.createElement('picture')
      const sizes = `${expandedSize}px`

      const avifSource = document.createElement('source')
      avifSource.type = 'image/avif'
      avifSource.srcset = media.avifSrcset
      avifSource.sizes = sizes

      const webpSource = document.createElement('source')
      webpSource.type = 'image/webp'
      webpSource.srcset = media.webpSrcset
      webpSource.sizes = sizes

      const img = document.createElement('img')
      img.decoding = 'async'
      picture.append(avifSource, webpSource, img)
      img.src = media.src

      return img.decode().catch(() => {})
    }

    const warmOnscreenImages = () => {
      if (cancelled) {
        return
      }

      const onscreenImageTasks = []

      for (let i = 0; i < normalizedCopy.length; i++) {
        const node = normalizedCopy[i]

        if (node.kind !== 'project') {
          continue
        }

        const project = projects[node.projectId]

        if (project?.media?.kind === 'image') {
          onscreenImageTasks.push(
            preloadAndDecodeImage(project.media, project.expandedSize)
          )
        }
      }

      if (onscreenImageTasks.length === 0) {
        fullResImagesReady = true
        return
      }

      Promise.all(onscreenImageTasks).then(() => {
        if (!cancelled) {
          fullResImagesReady = true
        }
      })
    }

    const scheduleCollapsedMediaPrefetch = () => {
      if (navigator.connection?.saveData) {
        return
      }

      const targets = getCollapsedPrefetchUrls(projects, sections)

      if (targets.length === 0) {
        return
      }

      const runPrefetch = () => {
        prefetchIdleId = null

        if (cancelled) {
          return
        }

        const probe = document.createElement('video')
        const supportsAv1Webm = Boolean(
          probe.canPlayType('video/webm; codecs="av01.0.05M.08"')
        )

        for (const sec of Object.values(sections)) {
          if (!Array.isArray(sec?.projectIds)) {
            continue
          }

          for (const id of sec.projectIds) {
            const subProject = projects[id]
            const media = subProject?.media

            if (!media) {
              continue
            }

            if (media.kind === 'image') {
              preloadAndDecodeImage(media, subProject.expandedSize)
            } else if (media.kind === 'video') {
              const url = supportsAv1Webm && media.webm ? media.webm : media.mp4

              if (url) {
                fetch(url, {priority: 'low'}).catch(() => {})
              }
            }
          }
        }
      }

      if (typeof requestIdleCallback === 'function') {
        prefetchUsesIdle = true
        prefetchIdleId = requestIdleCallback(runPrefetch, {timeout: 3000})
      } else {
        prefetchUsesIdle = false
        prefetchIdleId = setTimeout(runPrefetch, 1200)
      }
    }

    const onInitialLoadComplete = () => {
      warmOnscreenImages()
      scheduleCollapsedMediaPrefetch()
    }

    if (document.readyState === 'complete') {
      onInitialLoadComplete()
    } else {
      window.addEventListener('load', onInitialLoadComplete, {once: true})
    }

    const fontPromises = [document.fonts.load('400 1em "EB Garamond"')]

    if (normalizedCopy.some(node => node.styleRole === 'name')) {
      fontPromises.push(document.fonts.load('italic 600 1em "EB Garamond"'))
    }

    Promise.all([...fontPromises, document.fonts.ready])
      .catch(() => {})
      .finally(() => {
        if (cancelled || !rootEl) {
          return
        }

        flushSync(() => {
          fontsReady = true
          computeLayout({animate: false, checkStyles: true})
        })

        window.dispatchEvent(new Event('oxism:ready'))
        requestAnimationFrame(() => {
          document.body.classList.add('fonts-loaded')
        })

        if (idlePendingStart) {
          startScreensaver()
        }

        resizeObserver = new ResizeObserver(() => {
          computeLayout({animate: false, checkStyles: true})
          ensureAnimationLoop()
        })
        resizeObserver.observe(rootEl)
      })

    return () => {
      cancelled = true
      clearIdleTimer()
      stopScreensaver({smoothExit: false})
      clearTouchPress()
      setTouchInput(false)
      motionQuery.removeEventListener('change', onMotionChange)
      touchOnlyQuery.removeEventListener('change', onTouchOnlyChange)

      if (prefetchIdleId !== null) {
        if (prefetchUsesIdle && typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(prefetchIdleId)
        } else {
          clearTimeout(prefetchIdleId)
        }
      }

      resizeObserver?.disconnect()
      videoObserver?.disconnect()
      videoObserver = null
      mountedVideos.length = 0
      visibleVideos = new WeakSet()

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

{#snippet mediaContent(media, alt, expanded = false, expandedSize = 260)}
  {#if media.kind === 'image'}
    {@const sizes =
      expanded || fullResImagesReady ? `${expandedSize}px` : '60px'}
    <picture>
      <source type="image/avif" srcset={media.avifSrcset} {sizes} />
      <source type="image/webp" srcset={media.webpSrcset} {sizes} />
      <img
        src={media.src}
        {alt}
        width={media.width}
        height={media.height}
        loading="eager"
        decoding={fullResImagesReady ? 'sync' : 'async'}
      />
    </picture>
  {:else}
    <video use:bindMediaVideo preload="auto" loop muted playsinline>
      <source src={media.webm} type="video/webm; codecs=av01.0.05M.08" />
      <source src={media.mp4} type="video/mp4" />
    </video>
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
    style:line-height="{item.lineHeight}px"
  >
    {item.char}
  </span>
{/snippet}

{#snippet layoutItem(item)}
  {#if item.kind === 'word'}
    <span
      use:bindWord={item}
      class="word"
      class:in-expanded={item.inExpanded}
      class:section-exiting={item.exiting}
      aria-hidden="true"
      style:width="{item.width}px"
      style:height="{item.height}px"
    >
      {#each item.children as child (child.id)}{@render glyphSpan(child)}{/each}
    </span>
  {:else if item.kind === 'box'}
    <button
      type="button"
      use:bindBox={item}
      class="inline-box"
      class:expanded={item.expanded}
      class:in-expanded={item.inExpanded}
      class:section-exiting={item.exiting}
      data-project-id={item.exiting ? null : item.projectId}
      tabindex={item.expanded && !item.exiting ? 0 : -1}
      aria-expanded={item.expanded ? true : null}
      aria-hidden={!item.expanded || item.exiting ? 'true' : null}
      inert={Boolean(item.exiting)}
      aria-label={item.expanded ? `Collapse ${item.alt}` : null}
      style:width="{item.domWidth}px"
      style:height="{item.domHeight}px"
      onclick={() => toggleSection(item.projectId)}
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
      {@render mediaContent(
        item.media,
        item.alt,
        item.expanded,
        item.expandedSize
      )}
    </button>
  {:else if item.kind === 'hitbox'}
    <span
      class="hit-box"
      class:section-exiting={item.exiting}
      aria-hidden="true"
      style:left="{item.localX}px"
      style:top="{item.localY}px"
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
  {/if}
{/snippet}

{#snippet linkElement(token, exiting, bounds, items)}
  {@const pressKey = exiting ? null : (token.key ?? null)}
  {@const isTouchActive = Boolean(pressKey) && pressedKey === pressKey}
  {@const isNewTab = opensNewTab(token)}
  <a
    href={token.href}
    rel={isNewTab ? 'external noopener noreferrer' : null}
    target={isNewTab ? '_blank' : null}
    class:kinetic-link={Boolean(bounds)}
    class:touch-active={isTouchActive}
    class:section-exiting={exiting}
    data-press-key={pressKey}
    tabindex={exiting ? -1 : null}
    aria-hidden={exiting ? 'true' : null}
    inert={Boolean(exiting)}
    style:left={bounds ? `${bounds.x}px` : null}
    style:top={bounds ? `${bounds.y}px` : null}
    style:width={bounds ? `${bounds.width}px` : null}
    style:height={bounds ? `${bounds.height}px` : null}
  >
    {#if items}
      <span class="sr-only">{token.text}</span>
      {#each items as item (item.id)}
        {@render layoutItem(item)}
      {/each}
    {:else}
      {token.text ?? token.label}
    {/if}
  </a>
{/snippet}

<div
  class="kinetic-body"
  bind:this={rootEl}
  class:layout-active={hasLayout}
  class:reflowing={isReflowing}
  class:touch-input={touchInput}
  style:height={hasLayout ? `${layoutHeight}px` : null}
>
  {#if hasLayout}
    {#each renderGroups as group (group.key)}
      {#if group.token.kind === 'section-toggle'}
        <button
          type="button"
          class="kinetic-btn section-toggle"
          data-press-key={group.key}
          class:expanded={group.token.expanded}
          class:touch-active={pressedKey === group.key}
          aria-expanded={group.token.expanded}
          style:left="{group.bounds.x}px"
          style:top="{group.bounds.y}px"
          style:width="{group.bounds.width}px"
          style:height="{group.bounds.height}px"
          onclick={() => toggleSection(group.token.sectionId)}
        >
          <span class="sr-only">{group.token.text}</span>
          {#each group.items as item (item.id)}
            {@render layoutItem(item)}
          {/each}
        </button>
      {:else if group.token.kind === 'project-toggle'}
        <button
          type="button"
          class="kinetic-btn project-toggle"
          data-project-id={group.exiting ? null : group.token.projectId}
          tabindex={group.exiting ? -1 : 0}
          class:expanded={group.token.expanded}
          class:hovered={!group.exiting &&
            hoveredProjectId === group.token.projectId}
          class:touch-active={!group.exiting &&
            pressedProjectId === group.token.projectId}
          class:section-exiting={group.exiting}
          aria-expanded={group.token.expanded}
          aria-hidden={group.exiting ? 'true' : null}
          inert={Boolean(group.exiting)}
          style:left="{group.bounds.x}px"
          style:top="{group.bounds.y}px"
          style:width="{group.bounds.width}px"
          style:height="{group.bounds.height}px"
          onclick={() => toggleSection(group.token.projectId)}
        >
          <span class="sr-only">{group.token.text}</span>
          {#each group.items as item (item.id)}
            {@render layoutItem(item)}
          {/each}
        </button>
      {:else if group.token.kind === 'link'}
        {@render linkElement(
          group.token,
          group.exiting,
          group.bounds,
          group.items
        )}
      {:else}
        {#if !group.exiting && group.token.text && group.token.text !== '\u00A0'}
          {#if group.token.heading}
            <h1 class="sr-only" style:top="{group.items[0]?.y ?? 0}px">
              {group.token.text}
            </h1>
          {:else}
            <span class="sr-only" style:top="{group.items[0]?.y ?? 0}px">
              {group.token.text}
            </span>
          {/if}
        {/if}
        {#each group.items as item (item.id)}
          {@render layoutItem(item)}
        {/each}
      {/if}
    {/each}
  {:else}
    {#each fallbackCopy as node (node.key)}
      {#if node.kind === 'section'}
        <span
          role="button"
          class="fallback-btn"
          data-press-key={node.key}
          class:touch-active={pressedKey === node.key}
        >
          {node.text}
        </span>{#if node.footnote}<sup class="body-sup-fallback">
            {node.footnote}
          </sup>{/if}
      {:else if node.kind === 'project'}
        {@const project = projects[node.projectId]}
        {#if project}
          <span
            class="project-fallback"
            data-project-id={node.projectId}
            class:touch-active={pressedProjectId === node.projectId}
          >
            <span role="button" class="fallback-btn">
              {project.name}
            </span>{#if node.footnote}<sup class="body-sup-fallback">
                {node.footnote}
              </sup>{/if}&nbsp;<span class="inline-media-fallback">
              {@render mediaContent(
                project.media,
                project.alt,
                false,
                project.expandedSize
              )}
            </span>
          </span>
        {/if}
      {:else if node.kind === 'link'}
        {@render linkElement(
          node,
          false,
          null,
          null
        )}{#if opensNewTab(node)}<sup class="body-arrow-fallback">
            {externalLinkArrow}
          </sup>{/if}
      {:else if node.heading}
        <h1 class="name fallback-heading">{node.text}</h1>
      {:else if node.styleRole === 'name'}
        <span class="name">{node.text}</span>
      {:else}
        {node.text}
      {/if}
    {/each}
  {/if}
</div>

{#if prerenderSubsections.length > 0}
  <div class="prerendered-subsections" aria-hidden="true" inert>
    {#each prerenderSubsections as sub (sub.key)}
      <section>
        <h2>{sub.title}</h2>
        {#if sub.kind === 'section-projects'}
          {#each sub.projects as project (project.key)}
            <article>
              <h3>{project.name}</h3>
              {#if project.details}
                <p>{project.details}</p>
              {/if}
              {#if project.links.length > 0}
                <ul>
                  {#each project.links as link (link.href)}
                    <li>
                      {@render linkElement(link, false, null, null)}
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
          {#if sub.links?.length > 0}
            <ul>
              {#each sub.links as link (link.href)}
                <li>
                  {@render linkElement(link, false, null, null)}
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
  .kinetic-body.layout-active {
    position: relative;
    font-variant-ligatures: none;
  }

  .kinetic-btn,
  .kinetic-link {
    position: absolute;
    z-index: 2;
    padding: 0;
    margin: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    pointer-events: none;
    outline: none;
  }

  .word {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    display: inline-block;
    contain: size layout style;
  }

  .reflowing .word,
  .reflowing .underline-svg {
    will-change: transform;
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

  .glyph.detail {
    font-size: 0.56em;
    line-height: 1.32;
  }

  .glyph.detail-link {
    font-size: 0.44em;
    line-height: 1.35;
  }

  .glyph.body-sup {
    font-size: 0.34em;
    line-height: 1;
    vertical-align: 1.35em;
  }

  .glyph.body-arrow {
    font-size: 0.3em;
    line-height: 1;
    vertical-align: 1.55em;
  }

  .glyph.detail-sup {
    font-size: 0.34em;
    line-height: 1;
    vertical-align: 0.56em;
  }

  .glyph.detail-link-sup {
    font-size: 0.24em;
    line-height: 1;
    vertical-align: 0.92em;
  }

  .glyph.older-project-sup {
    font-size: 0.36em;
    line-height: 1;
    vertical-align: 0.72em;
  }

  .glyph.older-project {
    font-size: 0.6em;
    line-height: 1.25;
  }

  .hit-box {
    position: absolute;
    z-index: 2;
    pointer-events: auto;
    cursor: pointer;
  }

  .underline-svg {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -2;
    display: block;
    overflow: visible;
    pointer-events: none;
  }

  .kinetic-btn .word,
  .kinetic-link .word {
    z-index: 3;
    cursor: pointer;
  }

  .kinetic-btn .glyph,
  .kinetic-link .glyph {
    z-index: 3;
    pointer-events: auto;
    cursor: pointer;
  }

  @media (hover: hover) and (pointer: fine) {
    .kinetic-body:not(.touch-input) .kinetic-btn:hover .glyph,
    .kinetic-body:not(.touch-input) .kinetic-link:hover .glyph,
    .kinetic-body:not(.touch-input) .fallback-btn:hover,
    .kinetic-body:not(.layout-active):not(.touch-input) a:hover,
    .kinetic-body:not(.touch-input)
      .project-fallback:has(.inline-media-fallback:hover)
      .fallback-btn {
      color: blue;
    }
  }

  .kinetic-btn:focus-visible .glyph,
  .kinetic-link:focus-visible .glyph,
  .project-toggle.hovered .glyph,
  .touch-active .glyph,
  .kinetic-body:not(.layout-active) a.touch-active,
  .fallback-btn.touch-active,
  .project-fallback.touch-active .fallback-btn {
    color: blue;
  }

  .inline-box {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
    display: inline-block;
    padding: 0;
    margin: 0;
    border: 0;
    background: none;
    text-decoration: none;
    transform-origin: 50% 50%;
    cursor: pointer;
    outline: none;
  }

  .reflowing .inline-box {
    will-change: transform;
  }

  .inline-box.expanded:focus-visible {
    outline: 2px solid blue;
    outline-offset: 3px;
  }

  .layout-active .section-exiting,
  .layout-active .section-exiting .word,
  .layout-active .section-exiting .glyph,
  .layout-active .section-exiting .hit-box,
  .layout-active .word.section-exiting,
  .layout-active .inline-box.section-exiting,
  .layout-active .underline-svg.section-exiting,
  .layout-active .hit-box.section-exiting {
    pointer-events: none;
  }

  .inline-box :global(picture),
  .inline-box :global(img),
  .inline-box :global(video) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
</style>
