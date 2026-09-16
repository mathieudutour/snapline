import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'

/**
 * One confirm sheet for every destructive action.
 *
 * `confirm()` and `prompt()` break the visual language, cannot carry the context that
 * makes the decision safe ("and everything on it"), and give a delete the same weight as
 * a cancel. This is the same call shape — `await confirmAction(...)` — so the call sites
 * read the way they did, but the sheet can say what is about to happen and put the
 * destructive action in a filled red button.
 */
export interface ConfirmOptions {
  title: string
  body?: ReactNode
  /** names the action, e.g. "Delete project" — never just "OK" */
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

/** the same sheet, asking for a value instead of a yes or no — this replaces `prompt()` */
export interface AskOptions extends Omit<ConfirmOptions, 'danger'> {
  /** the field's own label, e.g. "Distance" */
  field: string
  initial?: string
  placeholder?: string
  /** one-click answers, e.g. room names read off the underlay */
  suggestions?: string[]
}

interface Pending extends ConfirmOptions {
  ask?: AskOptions
  resolve: (answer: boolean | string | null) => void
}

const useConfirmStore = create<{ pending: Pending | null; open: (p: Pending) => void; answer: (a: boolean | string | null) => void }>((set, get) => ({
  pending: null,
  open: (pending) => set({ pending }),
  answer: (a) => {
    const p = get().pending
    set({ pending: null })
    p?.resolve(a)
  },
}))

/** a second request while a sheet is open cancels the first rather than stacking sheets */
function openSheet(pending: Omit<Pending, 'resolve'>): Promise<boolean | string | null> {
  const state = useConfirmStore.getState()
  if (state.pending) state.answer(pending.ask ? null : false)
  return new Promise((resolve) => useConfirmStore.getState().open({ ...pending, resolve }))
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return openSheet(options) as Promise<boolean>
}

/** resolves with the typed value, or null if it was cancelled */
export function askForValue(options: AskOptions): Promise<string | null> {
  return openSheet({ ...options, danger: false, ask: options }) as Promise<string | null>
}

export function ConfirmSheet() {
  const pending = useConfirmStore((s) => s.pending)
  const answer = useConfirmStore((s) => s.answer)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    if (!pending) return
    setValue(pending.ask?.initial ?? '')
    if (!pending.ask) confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(pending.ask ? null : false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, answer])
  if (!pending) return null
  const cancel = () => answer(pending.ask ? null : false)
  const accept = () => answer(pending.ask ? value : true)
  const suggestions = pending.ask?.suggestions?.filter((s) => s !== value) ?? []
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal confirm" role={pending.ask ? 'dialog' : 'alertdialog'} aria-modal="true" aria-label={pending.title} onPointerDown={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            accept()
          }}
        >
          <div className="confirm-body">
            <h2>{pending.title}</h2>
            {pending.body && <p>{pending.body}</p>}
            {pending.ask && (
              <label className="field" style={{ marginTop: 6 }}>
                <span>{pending.ask.field}</span>
                <span className="field-input">
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input autoFocus value={value} placeholder={pending.ask.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
                </span>
              </label>
            )}
            {suggestions.length > 0 && (
              <div className="chips" style={{ marginTop: 8 }}>
                {suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => answer(s)} title="Found on the underlay">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="row end">
            <button type="button" onClick={cancel}>
              {pending.cancelLabel ?? 'Cancel'}
            </button>
            <button ref={confirmRef} type="submit" className={pending.danger === false ? 'primary' : 'danger'} disabled={!!pending.ask && !value.trim()}>
              {pending.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Rename in place. Double-click already implies it on every row that can be renamed, so
 * the row becomes the field rather than opening a browser prompt somewhere else on screen.
 * Enter commits, Escape and blur-with-no-change cancel.
 */
export function InlineRename({ value, onCommit, onCancel, placeholder, suggestions }: { value: string; onCommit: (name: string) => void; onCancel: () => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState(value)
  const listId = useId()
  const commit = () => {
    const name = text.trim()
    if (name && name !== value) onCommit(name)
    else onCancel()
  }
  return (
    <>
      {/* names read off the underlay, offered by the browser's own suggestion list under the field */}
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <input
        className="inline-rename"
        autoFocus
        list={suggestions && suggestions.length > 0 ? listId : undefined}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onCancel()
        }}
      />
    </>
  )
}
