# Dirty Watch · plugin de Orca

Plugin experimental para [Orca](https://github.com/stablyai/orca) que avisa
cuando tus worktrees tienen **cambios sin commitear**.

## Qué hace

- **Notificaciones de escritorio**: cuando un repo pasa de limpio a sucio
  (y cuando vuelve a quedar limpio), con el número de archivos afectados.
- **Escaneo automático**:
  - cuando un agente cambia de estado (`agent.status.changed`),
  - sondeo suave cada ~2 min mientras el worker está vivo,
  - manual: comando **“Dirty Watch: escanear worktrees ahora”**.
- **Panel en el sidebar derecho**: muestra el worktree activo (nombre y
  rama) y permite escribir `git status` en su terminal.

Solo escanea worktrees **locales** (los remotos vía SSH se omiten porque el
git de esta máquina no los ve).

## Instalarlo en Orca (modo desarrollo)

1. Abre **Ajustes → Plugins** en Orca.
2. Baja hasta la sección **Desarrollo** y pulsa **Añadir ruta**.
3. Pon la ruta de esta carpeta clonada, por ejemplo:
   `/Users/tu-usuario/Proyectos/orca-plugin-dirty-watch`
4. Orca te mostrará el **consentimiento de permisos** (capabilities del
   manifiesto). Revísalos y actívalos.
5. Activa el plugin con el toggle. No se ejecuta nada hasta que lo actives.

> El sistema de plugins es **experimental** (pluginApi 1) y los plugins de
> desarrollo se recargan desde la carpeta local, así que cualquier cambio en
> este repo se refleja al recargar.

## Limitaciones conocidas

- La API de plugins v0 no expone git status ni listado de worktrees como
  métodos del host; este plugin usa `git` y el CLI `orca` desde el worker
  (Node plano). Si un runtime futuro restringe `child_process`, el plugin se
  degrada y lo deja registrado en el log.
- La primera pasada no notifica: solo toma el estado inicial.
- Los sondeos periódicos solo corren mientras el worker del plugin esté
  vivo; los eventos y el comando lo reactivan.

## Estructura

```
orca-plugin.json   manifiesto (id, capabilities, panels, commands, events)
main.mjs           worker: escaneo git + notificaciones + storage
panel.html         panel del sidebar (contexto del worktree activo)
```

## Licencia

MIT