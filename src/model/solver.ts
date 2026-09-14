/**
 * Small dense Levenberg–Marquardt least-squares solver with sparse numeric Jacobians.
 * Each residual declares which variables it depends on so the Jacobian only costs
 * (#dependent vars) evaluations per residual.
 */
export interface Residual {
  /** indices of the variables this residual reads */
  vars: number[]
  /** evaluate residual values for the current variable vector */
  fn: (x: Float64Array) => number[]
  weight: number
}

export interface SolveResult {
  x: Float64Array<ArrayBufferLike>
  iterations: number
  cost: number
}

function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  // Gaussian elimination with partial pivoting on a copy of A (row-major n×n)
  const M = new Float64Array(A)
  const r = new Float64Array(b)
  for (let col = 0; col < n; col++) {
    let pivot = col
    let best = Math.abs(M[col * n + col])
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row * n + col])
      if (val > best) {
        best = val
        pivot = row
      }
    }
    if (best < 1e-14) return null
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const tmp = M[col * n + k]
        M[col * n + k] = M[pivot * n + k]
        M[pivot * n + k] = tmp
      }
      const tmp = r[col]
      r[col] = r[pivot]
      r[pivot] = tmp
    }
    const inv = 1 / M[col * n + col]
    for (let row = col + 1; row < n; row++) {
      const f = M[row * n + col] * inv
      if (f === 0) continue
      for (let k = col; k < n; k++) M[row * n + k] -= f * M[col * n + k]
      r[row] -= f * r[col]
    }
  }
  const x = new Float64Array(n)
  for (let row = n - 1; row >= 0; row--) {
    let s = r[row]
    for (let k = row + 1; k < n; k++) s -= M[row * n + k] * x[k]
    x[row] = s / M[row * n + row]
  }
  return x
}

interface Evaluated {
  r: Float64Array
  /** rows: list of {row, col, value} entries */
  J: { row: number; col: number; value: number }[]
  cost: number
}

function evaluate(x: Float64Array, residuals: Residual[], withJacobian: boolean): Evaluated {
  const rows: number[] = []
  const J: Evaluated['J'] = []
  let cost = 0
  let row = 0
  for (const res of residuals) {
    const base = res.fn(x)
    for (let i = 0; i < base.length; i++) {
      const val = base[i] * res.weight
      rows.push(val)
      cost += val * val
    }
    if (withJacobian) {
      for (const col of res.vars) {
        const h = 1e-6
        const old = x[col]
        x[col] = old + h
        const plus = res.fn(x)
        x[col] = old - h
        const minus = res.fn(x)
        x[col] = old
        for (let i = 0; i < base.length; i++) {
          const d = ((plus[i] - minus[i]) / (2 * h)) * res.weight
          if (d !== 0) J.push({ row: row + i, col, value: d })
        }
      }
    }
    row += base.length
  }
  return { r: Float64Array.from(rows), J, cost }
}

export function solveLM(x0: Float64Array, residuals: Residual[], opts: { maxIter?: number; tol?: number } = {}): SolveResult {
  const n = x0.length
  const maxIter = opts.maxIter ?? 40
  const tol = opts.tol ?? 1e-12
  const x = new Float64Array(x0)
  if (n === 0 || residuals.length === 0) return { x, iterations: 0, cost: 0 }
  let lambda = 1e-3
  let current = evaluate(x, residuals, true)
  let iterations = 0
  const A = new Float64Array(n * n)
  const g = new Float64Array(n)
  for (; iterations < maxIter; iterations++) {
    if (current.cost < tol) break
    A.fill(0)
    g.fill(0)
    // Build JᵀJ and Jᵀr from sparse entries grouped by row
    const byRow = new Map<number, { col: number; value: number }[]>()
    for (const e of current.J) {
      let list = byRow.get(e.row)
      if (!list) {
        list = []
        byRow.set(e.row, list)
      }
      list.push(e)
    }
    for (const [row, entries] of byRow) {
      const rv = current.r[row]
      for (const e1 of entries) {
        g[e1.col] += e1.value * rv
        for (const e2 of entries) A[e1.col * n + e2.col] += e1.value * e2.value
      }
    }
    let accepted = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const Ad = new Float64Array(A)
      for (let i = 0; i < n; i++) Ad[i * n + i] += lambda * (A[i * n + i] + 1e-9)
      const negG = new Float64Array(n)
      for (let i = 0; i < n; i++) negG[i] = -g[i]
      const delta = solveLinear(Ad, negG, n)
      if (!delta) {
        lambda *= 10
        continue
      }
      const trial = new Float64Array(x)
      let maxStep = 0
      for (let i = 0; i < n; i++) {
        trial[i] += delta[i]
        maxStep = Math.max(maxStep, Math.abs(delta[i]))
      }
      const evalTrial = evaluate(trial, residuals, false)
      if (evalTrial.cost < current.cost) {
        x.set(trial)
        current = evaluate(x, residuals, true)
        lambda = Math.max(lambda / 3, 1e-9)
        accepted = true
        if (maxStep < 1e-9) return { x, iterations: iterations + 1, cost: current.cost }
        break
      }
      lambda *= 4
    }
    if (!accepted) break
  }
  return { x, iterations, cost: current.cost }
}
