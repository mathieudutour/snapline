/**
 * WebMCP: hand the plan-building tools to the browser's agent layer (navigator.modelContext),
 * and expose the same tools to scripts as window.snapline.tools.
 */
import { AGENT_HINT, callTool, describeTools, TOOLS } from './tools'

interface ModelContextTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown>
}
interface ModelContext {
  provideContext?: (ctx: { tools: ModelContextTool[] }) => void | Promise<void>
  registerTool?: (tool: ModelContextTool) => void | Promise<void>
}

const asContent = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] })

export function registerAgentTools(): { webmcp: boolean } {
  const tools: ModelContextTool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    execute: async (input) => {
      const r = await callTool(t.name, input)
      if (!r.ok) throw new Error(r.error)
      return asContent(r.result)
    },
  }))
  const scripting = { list: describeTools, call: callTool, hint: AGENT_HINT }
  ;(window as unknown as { snapline: { tools?: typeof scripting } }).snapline.tools = scripting
  const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  if (!mc) return { webmcp: false }
  try {
    if (typeof mc.provideContext === 'function') void mc.provideContext({ tools })
    else if (typeof mc.registerTool === 'function') for (const t of tools) void mc.registerTool(t)
    else return { webmcp: false }
    return { webmcp: true }
  } catch {
    return { webmcp: false }
  }
}
