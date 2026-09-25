// Dirty Watch — worker del plugin de Orca.
//
// Se ejecuta en el worker de plugins (Node plano, fuera de Electron) cuando
// Orca lo activa. Escanea los worktrees registrados con `git status`,
// compara con el estado anterior (guardado en storage del plugin) y muestra
// notificaciones cuando un repo pasa de limpio a sucio o viceversa.
//
// Disparadores:
//   - Comando "Dirty Watch: escanear worktrees ahora" (desde la paleta)
//   - Evento `agent.status.changed` (cuando un agente cambia de estado)
//   - Sondeo suave cada 2 min mientras el worker siga vivo

// El worker es Node plano, pero importamos child_process de forma defensiva:
// si algún runtime lo restringe, el plugin se degrada con un error claro en
// el log en lugar de morir al cargar.
let cp = null
try {
  cp = await import('node:child_process')
} catch (_) {
  /* sin child_process: solo quedará el comando como no-op informativo */
}

const SCAN_TIMEOUT_MS = 20_000
const GIT_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 120_000
const DEBOUNCE_MS = 4_000

function exec(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })
}

export default function activate(orca) {
  const log = (...parts) => orca.log?.('[dirty-watch]', ...parts)

  let scanning = false
  let debounceTimer = null

  async function readCounts() {
    const res = await orca.host.call('storage.get', { key: 'counts' })
    return (res && res.value && typeof res.value === 'object' && !Array.isArray(res.value)
      ? res.value
      : {})
  }

  async function listWorktrees() {
    const out = await exec('orca', ['worktree', 'list', '--json'], SCAN_TIMEOUT_MS)
    const data = JSON.parse(out)
    const worktrees = (data && data.result && data.result.worktrees) || []
    // Solo rutas locales: los worktrees SSH remotos no se pueden escanear con
    // el git de esta máquina, así que se omiten.
    const seen = new Set()
    const out2 = []
    for (const w of worktrees) {
      const path = typeof w.path === 'string' ? w.path : ''
      if (!path || seen.has(path)) continue
      seen.add(path)
      out2.push({
        path,
        name: (typeof w.displayName === 'string' && w.displayName) ||
          path.split('/').filter(Boolean).pop() ||
          path
      })
    }
    return out2
  }

  async function countDirty(path) {
    // `git status --porcelain -uall`: modificados + staged + sin trackear.
    const out = await exec('git', ['-C', path, 'status', '--porcelain', '-uall'], GIT_TIMEOUT_MS)
    return out.split('\n').filter((l) => l.trim().length > 0).length
  }

  async function scan() {
    if (!cp) {
      log('node:child_process no está disponible en este runtime')
      return { ok: false, reason: 'child_process unavailable' }
    }
    if (scanning) return { ok: false, reason: 'already-scanning' }
    scanning = true
    try {
      const worktrees = await listWorktrees()
      const counts = {}
      const entries = []
      for (const w of worktrees) {
        let count = null
        try {
          count = await countDirty(w.path)
        } catch (_) {
          continue // no es un repo git accesible; se omite
        }
        counts[w.path] = count
        entries.push({ name: w.name, path: w.path, count })
      }

      const prev = await readCounts()
      const isFirstRun = Object.keys(prev).length === 0

      for (const entry of entries) {
        const before = prev[entry.path]
        if (before === entry.count) continue
        if (isFirstRun) continue // la primera pasada solo inicializa, no notifica
        if (entry.count > 0) {
          await orca.host.call('notifications.show', {
            title: `Dirty Watch · ${entry.name}`,
            body: `${entry.count} archivo(s) sin commitear`
          })
        } else if (before > 0) {
          await orca.host.call('notifications.show', {
            title: `Dirty Watch · ${entry.name}`,
            body: 'repositorio limpio ✓'
          })
        }
      }

      await orca.host.call('storage.set', { key: 'counts', value: counts })
      await orca.host.call('storage.set', {
        key: 'lastResult',
        value: { at: Date.now(), entries }
      })
      const dirty = entries.filter((e) => e.count > 0)
      log(
        `escaneo: ${entries.length} worktrees, ${dirty.length} con cambios`,
        dirty.map((e) => `${e.name}(${e.count})`).join(', ')
      )
      return { ok: true, entries }
    } finally {
      scanning = false
    }
  }

  function debouncedScan() {
    if (debounceTimer) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      scan().catch((err) => log('error en escaneo:', err && err.message))
    }, DEBOUNCE_MS)
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref()
  }

  orca.commands.register('dirty-scan', scan)

  orca.events.on('agent.status.changed', () => {
    // Un agente que pasa a idle/done suele dejar trabajo sin commitear:
    // escaneo tras un debounce para no martillear git.
    debouncedScan()
  })

  // Red de seguridad: sondeo suave mientras el worker esté vivo. Los workers
  // pueden dormirse cuando no hay triggers; los eventos y el comando lo
  // reactivan.
  const interval = setInterval(() => {
    scan().catch((err) => log('error en sondeo:', err && err.message))
  }, POLL_INTERVAL_MS)
  if (typeof interval.unref === 'function') interval.unref()

  log('activado')
}