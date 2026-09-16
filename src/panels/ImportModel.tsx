import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../model/store'
import { guessUnitScale, parseModelFile, type ParsedModel } from '../furniture/customModels'
import { renderModelIcons } from '../furniture/renderIcon'
import { formatLength } from '../model/units'
import { Icon } from '../brand/Icons'

const UNIT_OPTIONS: { label: string; scale: number }[] = [
  { label: 'metres', scale: 1 },
  { label: 'centimetres', scale: 0.01 },
  { label: 'millimetres', scale: 0.001 },
  { label: 'inches', scale: 0.0254 },
  { label: 'feet', scale: 0.3048 },
]

export function ImportModelDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const importModel = useEditor((s) => s.importModel)
  const units = useEditor((s) => s.units)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [unitScale, setUnitScale] = useState(1)
  const [parsed, setParsed] = useState<ParsedModel | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bufferRef = useRef<ArrayBuffer | null>(null)

  const pick = async (f: File) => {
    setFile(f)
    setName(f.name.replace(/\.(glb|gltf)$/i, ''))
    setError(null)
    setParsed(null)
    setPreview(null)
    try {
      const buffer = await f.arrayBuffer()
      bufferRef.current = buffer
      const raw = await parseModelFile(buffer, 1)
      const guess = guessUnitScale(Math.max(raw.width, raw.depth, raw.height))
      setUnitScale(guess)
      await measure(buffer, guess)
    } catch (e) {
      setError((e as Error).message || 'Could not read this file.')
    }
  }
  const measure = async (buffer: ArrayBuffer, scale: number) => {
    const p = await parseModelFile(buffer, scale)
    setParsed(p)
    const icons = await renderModelIcons(p.object, p.width, p.depth, p.height)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(icons.thumb)
    })
  }
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await importModel(file, name, unitScale)
      onImported()
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <strong>Import a 3D model</strong>
          <button className="x" onClick={onClose} title="Close">
            <Icon name="close" size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="props">
          <label className="file-drop">
            <input
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void pick(f)
              }}
            />
            {file ? file.name : 'Choose a .glb or .gltf file…'}
          </label>
          {parsed && (
            <>
              <div className="import-preview">
                {preview && <img src={preview} alt="" />}
                <div>
                  <label className="field">
                    <span>Name</span>
                    <span className="field-input">
                      <input value={name} onChange={(e) => setName(e.target.value)} />
                    </span>
                  </label>
                  <label className="field">
                    <span>File units</span>
                    <select
                      value={unitScale}
                      onChange={(e) => {
                        const scale = Number(e.target.value)
                        setUnitScale(scale)
                        if (bufferRef.current) void measure(bufferRef.current, scale)
                      }}
                    >
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u.scale} value={u.scale}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted small">
                    Size {formatLength(parsed.width, units)} × {formatLength(parsed.depth, units)} × {formatLength(parsed.height, units)} (width × depth × height). Change the file units if that looks wrong; you can also resize each placed piece later.
                  </p>
                </div>
              </div>
              <p className="muted small">The front of the model is its +Z side, which is drawn at the bottom of the plan symbol. Only import models you are allowed to use.</p>
            </>
          )}
          {error && <p className="warn small">{error}</p>}
          <div className="row end">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!parsed || busy} onClick={submit}>
              {busy ? 'Importing…' : 'Add to my models'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
