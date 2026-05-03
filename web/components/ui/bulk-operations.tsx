"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Trash2, Edit3, Download, CheckSquare, Square, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface BulkItem {
  id: string
  name: string
  selected?: boolean
  [key: string]: unknown
}

interface BulkOperationConfig {
  onDelete?: (ids: string[]) => void
  onRename?: (id: string, newName: string) => void
  onExport?: (ids: string[]) => void
  onMove?: (ids: string[], target: string) => void
}

export function useBulkSelection<T extends BulkItem>() {
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const toggleSelection = React.useCallback((id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])
  const selectAll = React.useCallback((items: T[]) => setSelectedIds(new Set(items.map(i => i.id))), [])
  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), [])
  return { selectedIds, toggleSelection, selectAll, clearSelection, count: selectedIds.size }
}

interface BulkOperationsBarProps { selectedCount: number; config: BulkOperationConfig; onClear: () => void; className?: string }

export function BulkOperationsBar({ selectedCount, selectedIds, config, onClear, className }: BulkOperationsBarProps & { selectedIds: Set<string> }) {
  if (selectedCount === 0) return null
  return (
    <div className={cn("flex items-center gap-2 p-3 bg-secondary rounded-lg", className)}>
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="flex-1" />
      {config.onDelete && <Button size="sm" variant="destructive" onClick={() => config.onDelete?.(Array.from(selectedIds))}><Trash2 className="w-4 h-4 mr-1" />Delete</Button>}
      {config.onRename && <Button size="sm" variant="outline" onClick={() => { const id = Array.from(selectedIds)[0]; if (id) config.onRename?.(id, '') }}><Edit3 className="w-4 h-4 mr-1" />Rename</Button>}
      {config.onExport && <Button size="sm" variant="outline" onClick={() => config.onExport?.(Array.from(selectedIds))}><Download className="w-4 h-4 mr-1" />Export</Button>}
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  )
}

interface BulkItemListProps<T extends BulkItem> { items: T[]; selectedIds: Set<string>; onToggle: (id: string) => void; renderItem: (item: T, isSelected: boolean) => React.ReactNode; className?: string }

export function BulkItemList<T extends BulkItem>({ items, selectedIds, onToggle, renderItem, className }: BulkItemListProps<T>) {
  return (
    <div className={cn("space-y-1", className)}>
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2" onClick={() => onToggle(item.id)}>
          {selectedIds.has(item.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
          {renderItem(item, selectedIds.has(item.id))}
        </div>
      ))}
    </div>
  )
}

interface BatchImageGenerateDialogProps { open: boolean; onClose: () => void; onGenerate: (prompts: string[]) => void }

export const BatchImageGenerateDialog: React.FC<BatchImageGenerateDialogProps> = ({ open, onClose, onGenerate }) => {
  const [prompts, setPrompts] = React.useState<string[]>(['', '', ''])
  const addPrompt = () => setPrompts(p => [...p, ''])
  const removePrompt = (index: number) => setPrompts(p => p.filter((_, i) => i !== index))
  const updatePrompt = (index: number, value: string) => setPrompts(p => p.map((v, i) => i === index ? value : v))
  const handleGenerate = () => { const validPrompts = prompts.filter(Boolean); if (validPrompts.length) { onGenerate(validPrompts); onClose() } }
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Batch Image Generation</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto py-2">
          {prompts.map((prompt, i) => (
            <div key={i} className="flex gap-2">
              <Input value={prompt} onChange={e => updatePrompt(i, e.target.value)} placeholder={`Prompt ${i + 1}...`} className="flex-1" />
              {prompts.length > 1 && <Button size="sm" variant="ghost" onClick={() => removePrompt(i)}>×</Button>}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addPrompt}>+ Add Prompt</Button>
        </div>
        <DialogFooter><Button onClick={handleGenerate} disabled={!prompts.some(Boolean)}><Loader2 className="w-4 h-4 mr-2" />Generate {prompts.filter(Boolean).length} Images</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface BulkRenameDialogProps { open: boolean; onClose: () => void; onRename: (newName: string) => void; currentName?: string }

export const BulkRenameDialog: React.FC<BulkRenameDialogProps> = ({ open, onClose, onRename, currentName }) => {
  const [name, setName] = React.useState(currentName || '')
  React.useEffect(() => { setName(currentName || '') }, [currentName])
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent><DialogHeader><DialogTitle>Rename Item</DialogTitle></DialogHeader>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Enter new name" />
        <DialogFooter><Button onClick={() => { if (name) { onRename(name); onClose() } }}>Rename</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}