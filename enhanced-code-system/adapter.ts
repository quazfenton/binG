import { getProvidersWithPuter } from '../lib/api/llm-providers'
import { normalizeStream, collectNonStream } from '../lib/streaming'
import { streamPartsToEdits, applyEditsToProject } from '../lib/code-parser'
import { llmService } from '../lib/api/llm-providers' // Import the main LLM service

export async function runModelAndApply(
  project: any,
  modelId: string,
  payload: any,
  opts: { stream?: boolean; defaultKey?: string; puterBase?: string } = {}
) {
  const { getPuterAdapterFor, isExternalModel } = await getProvidersWithPuter(opts.defaultKey, opts.puterBase)
  let adapter: any = null

  if (isExternalModel(modelId)) {
    adapter = getPuterAdapterFor(modelId, opts.defaultKey)
  } else {
    // Plug into existing local provider invocation path
    adapter = await llmService.getAdapterFor(modelId, opts.defaultKey)
  }

  if (opts.stream && adapter.stream) {
    const parts = normalizeStream(adapter.stream(payload))
    for await (const update of streamPartsToEdits(parts, project)) {
      project = update.project
      // Emit updates to UI: you should hook into your event or state update system
      // Example: window.dispatchEvent(new CustomEvent('project:update', { detail: project }))
    }
    return project
  } else {
    const resp = await adapter.responses(payload)
    const text = await collectNonStream(resp)
    const { parseTextToEdits } = await import('../lib/code-parser')
    const edits = parseTextToEdits(text)
    project = applyEditsToProject(project, edits)
    // Emit final project update
    return project
  }
}