// Idle screensaver virtual-pointer trajectory controller.
// Uses curvature-smoothed clothoid steering so arcs flow naturally across the
// text body, gently swirling out past its margins and curving back in.

export const idleDelayMs = 33000
export const screensaverExitDurationMs = 360
export const screensaverSmoothing = 0.14
export const screensaverExitMinSmoothing = 0.075

const maxStepDtSeconds = 0.064
const insideStartRampSeconds = 1.4
const outsideStartRampSeconds = 0.5
const outsideFadeSeconds = 0.9
const maxOmega = 1.12
const omegaResponsiveness = 2.6

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const smoothstep = (edge0, edge1, x) => {
  if (edge1 <= edge0) {
    return x >= edge1 ? 1 : 0
  }

  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

const randRange = (min, max) => min + Math.random() * (max - min)

const wrapAngle = angle => {
  let a = (angle + Math.PI) % (Math.PI * 2)

  if (a < 0) {
    a += Math.PI * 2
  }

  return a - Math.PI
}

const distToRect = (bounds, x, y) => {
  const dx = Math.max(bounds.left - x, 0, x - (bounds.left + bounds.width))
  const dy = Math.max(bounds.top - y, 0, y - (bounds.top + bounds.height))
  return Math.hypot(dx, dy)
}

// Point along ray from bounds center at `angle` pushed outside bounds so its
// Euclidean distance to the rectangle equals `margin`.
const pointOutsideAtAngle = (bounds, angle, margin) => {
  const w = Math.max(1, bounds.width)
  const h = Math.max(1, bounds.height)
  const cx = bounds.left + w * 0.5
  const cy = bounds.top + h * 0.5
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const hw = w * 0.5
  const hh = h * 0.5
  const tx = Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity
  const tEdge = Math.min(tx, ty)

  // Bisect along the ray from the edge point to hit exact Euclidean distance `margin`
  let lo = 0
  let hi = margin * 1.5 + 1

  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) * 0.5
    const px = cx + dx * (tEdge + mid)
    const py = cy + dy * (tEdge + mid)

    if (distToRect(bounds, px, py) < margin) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const s = (lo + hi) * 0.5
  return {
    x: cx + dx * (tEdge + s),
    y: cy + dy * (tEdge + s)
  }
}

export const createScreensaverController = ({radius}) => {
  let active = false
  let elapsed = 0
  let startedFromInside = false
  let curX = 0
  let curY = 0
  let curStrength = 0
  let heading = 0
  let omega = 0
  let swirlDir = 1
  let phaseA = 0
  let phaseB = 0
  let mode = 'sweep'
  let sweepStopsLeft = 2
  let lastQuadrant = -1
  let targetX = 0
  let targetY = 0
  let targetArcBias = 0
  let exitTargetDist = 0
  let modeElapsed = 0

  const pickInteriorTarget = (bounds, preferFarFromCurrent = true) => {
    const w = Math.max(1, bounds.width)
    const h = Math.max(1, bounds.height)
    const padX = Math.min(w * 0.1, 42)
    const padY = Math.min(h * 0.12, 36)
    const innerW = Math.max(1, w - padX * 2)
    const innerH = Math.max(1, h - padY * 2)

    // Pick a quadrant different from the last one so motion covers the full body
    const candidates = [0, 1, 2, 3].filter(q => q !== lastQuadrant)
    let bestPt = null
    let bestScore = -Infinity

    for (let i = 0; i < candidates.length; i++) {
      const q = candidates[i]
      const qx = q % 2
      const qy = q >> 1
      const px =
        bounds.left + padX + (qx * 0.5 + randRange(0.06, 0.44)) * innerW
      const py = bounds.top + padY + (qy * 0.5 + randRange(0.06, 0.44)) * innerH
      const dist = Math.hypot(px - curX, py - curY)
      const angleDiff = Math.abs(
        wrapAngle(Math.atan2(py - curY, px - curX) - heading)
      )
      // Favor targets roughly ahead/broadside over sharp reversals, plus good distance
      const forwardScore = Math.cos(angleDiff * 0.65)
      const distScore = preferFarFromCurrent
        ? Math.min(1.4, dist / Math.max(120, Math.hypot(w, h) * 0.45))
        : 0.5
      const score = forwardScore * 1.1 + distScore + Math.random() * 0.45

      if (score > bestScore) {
        bestScore = score
        bestPt = {x: px, y: py, q}
      }
    }

    lastQuadrant = bestPt.q
    return {x: bestPt.x, y: bestPt.y}
  }

  const beginSweepStop = bounds => {
    const next = pickInteriorTarget(bounds, true)
    targetX = next.x
    targetY = next.y
    // Flip swirl direction occasionally for graceful S-curves inside the body
    if (Math.random() < 0.42) {
      swirlDir = -swirlDir
    }
    targetArcBias = swirlDir * randRange(0.32, 0.68)
    mode = 'sweep'
    modeElapsed = 0
  }

  const beginExit = bounds => {
    const cx = bounds.left + bounds.width * 0.5
    const cy = bounds.top + bounds.height * 0.5
    // Continue generally along current heading with a gentle swirl curve out past the edge
    const projectedX = curX + Math.cos(heading) * Math.max(bounds.width, 320)
    const projectedY = curY + Math.sin(heading) * Math.max(bounds.height, 320)
    const exitAngle =
      Math.atan2(projectedY - cy, projectedX - cx) +
      swirlDir * randRange(0.18, 0.45)
    const fullBreath = Math.random() < 0.6
    exitTargetDist = fullBreath
      ? radius * randRange(0.92, 1.06)
      : radius * randRange(0.58, 0.82)
    const outerPt = pointOutsideAtAngle(bounds, exitAngle, exitTargetDist + 18)

    targetX = outerPt.x
    targetY = outerPt.y
    targetArcBias = swirlDir * randRange(0.12, 0.28)
    mode = 'exit'
    modeElapsed = 0
  }

  const beginReenter = bounds => {
    const cx = bounds.left + bounds.width * 0.5
    const cy = bounds.top + bounds.height * 0.5
    const curAngle = Math.atan2(curY - cy, curX - cx)
    // Swing slightly further around the body margin so reentry arcs smoothly inward
    const swingAngle = curAngle + swirlDir * randRange(0.45, 0.85)
    const entryHint = pointOutsideAtAngle(bounds, swingAngle, 0)
    const next = pickInteriorTarget(bounds, true)

    // Blend toward an interior point on the entry side first so the curve loops smoothly back in
    targetX = entryHint.x * 0.35 + next.x * 0.65
    targetY = entryHint.y * 0.35 + next.y * 0.65
    targetArcBias = swirlDir * randRange(0.28, 0.55)
    sweepStopsLeft = Math.random() < 0.45 ? 3 : 2
    mode = 'reenter'
    modeElapsed = 0
  }

  const start = (bounds, startPointer = null) => {
    active = true
    elapsed = 0
    omega = 0
    swirlDir = Math.random() < 0.5 ? 1 : -1
    phaseA = Math.random() * Math.PI * 2
    phaseB = Math.random() * Math.PI * 2
    lastQuadrant = -1

    const cx = bounds.left + bounds.width * 0.5
    const cy = bounds.top + bounds.height * 0.5
    const pointerDist = startPointer
      ? distToRect(bounds, startPointer.x, startPointer.y)
      : Infinity

    if (startPointer && pointerDist < radius) {
      // Seamlessly detach from the resting cursor and drift into an interior arc
      startedFromInside = true
      curX = startPointer.x
      curY = startPointer.y
      curStrength = 1

      const distToCenter = Math.hypot(cx - curX, cy - curY)
      heading =
        distToCenter > Math.min(bounds.width, bounds.height) * 0.15
          ? Math.atan2(cy - curY, cx - curX) + swirlDir * randRange(0.25, 0.6)
          : Math.random() * Math.PI * 2
      sweepStopsLeft = 2
      beginSweepStop(bounds)
    } else {
      // Start just outside the repulsion radius and glide smoothly into the body
      startedFromInside = false
      const startAngle = Math.random() * Math.PI * 2
      const startPt = pointOutsideAtAngle(bounds, startAngle, radius + 20)
      curX = startPt.x
      curY = startPt.y
      curStrength = 0

      // Aim obliquely inward so entry immediately curves across the body
      const inwardAngle = Math.atan2(cy - curY, cx - curX)
      heading = inwardAngle + swirlDir * randRange(0.22, 0.48)
      sweepStopsLeft = Math.random() < 0.5 ? 3 : 2
      beginSweepStop(bounds)
      mode = 'reenter'
    }

    return {x: curX, y: curY, strength: curStrength}
  }

  const stop = () => {
    active = false
  }

  const step = (dtMs, bounds) => {
    if (!active) {
      return {x: curX, y: curY, strength: curStrength}
    }

    const dt = clamp(dtMs / 1000, 0, maxStepDtSeconds)
    elapsed += dt
    modeElapsed += dt

    const w = Math.max(1, bounds.width)
    const h = Math.max(1, bounds.height)
    const minDim = Math.min(w, h)
    const diag = Math.hypot(w, h)
    const distOut = distToRect(bounds, curX, curY)
    const distToTarget = Math.hypot(targetX - curX, targetY - curY)

    // State transitions
    if (mode === 'reenter') {
      if (
        (distOut === 0 && distToTarget < Math.max(95, minDim * 0.32)) ||
        modeElapsed > 7.5
      ) {
        if (sweepStopsLeft > 1) {
          sweepStopsLeft--
          beginSweepStop(bounds)
        } else {
          beginExit(bounds)
        }
      }
    } else if (mode === 'sweep') {
      const arriveDist = Math.max(85, minDim * 0.28)

      if (distToTarget < arriveDist || modeElapsed > 6.5) {
        if (sweepStopsLeft > 1) {
          sweepStopsLeft--
          beginSweepStop(bounds)
        } else {
          beginExit(bounds)
        }
      }
    } else if (mode === 'exit') {
      if (distOut >= exitTargetDist || distToTarget < 64 || modeElapsed > 6.5) {
        beginReenter(bounds)
      }
    }

    // Desired heading toward target plus a smooth lateral arc bias that fades on approach
    let desiredAngle = Math.atan2(targetY - curY, targetX - curX)
    const biasFade = smoothstep(45, Math.max(160, minDim * 0.65), distToTarget)
    desiredAngle += targetArcBias * biasFade

    // Safety pull back toward body if ever pushed far past radius (e.g. viewport resize)
    if (distOut > radius * 1.18) {
      const cx = bounds.left + w * 0.5
      const cy = bounds.top + h * 0.5
      desiredAngle = Math.atan2(cy - curY, cx - curX)
    }

    let angleErr = wrapAngle(desiredAngle - heading)

    if (Math.abs(angleErr) > 2.4 && Math.sign(angleErr) !== swirlDir) {
      angleErr = swirlDir * (Math.PI * 2 - Math.abs(angleErr))
    }

    const targetOmega = clamp(angleErr * 1.35, -maxOmega, maxOmega)
    const omegaAlpha = 1 - Math.exp(-omegaResponsiveness * dt)
    omega += (targetOmega - omega) * omegaAlpha
    heading = wrapAngle(heading + omega * dt)

    // Slow, breathing speed that eases gently into turns
    const cruiseSpeed = clamp(diag * 0.145, 92, 152)
    const breath =
      1 +
      0.14 * Math.sin(elapsed * 0.29 + phaseA) +
      0.08 * Math.sin(elapsed * 0.13 + phaseB)
    const startRamp = startedFromInside
      ? smoothstep(0, insideStartRampSeconds, elapsed)
      : smoothstep(0, outsideStartRampSeconds, elapsed)
    const turnSlowdown = 1 / (1 + Math.abs(omega) * 0.42)
    const outsideBoost =
      1 + 0.16 * smoothstep(radius * 0.65, radius * 1.05, distOut)
    const speed = cruiseSpeed * breath * startRamp * turnSlowdown * outsideBoost

    curX += Math.cos(heading) * speed * dt
    curY += Math.sin(heading) * speed * dt
    curStrength = startedFromInside
      ? 1
      : smoothstep(0, outsideFadeSeconds, elapsed)

    return {x: curX, y: curY, strength: curStrength}
  }

  return {
    start,
    stop,
    step,
    isActive: () => active
  }
}
