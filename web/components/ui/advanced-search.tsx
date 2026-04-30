"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Search, X, Filter, ChevronDown, Calendar, Tag, SortAsc, SortDesc } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command"

interface SearchFilter {
  id: string
  label: string
  type: 'select' | 'multiselect' | 'date-range' | 'tags'
  options?: string[]
  value?: unknown
  onChange?: (value: unknown) => void
}

interface AdvancedSearchProps {
  filters: SearchFilter[]
  onSearch: (query: string, filters: Record<string, unknown>) => void
  placeholder?: string
  debounceMs?: number
  className?: string
}

export const AdvancedSearch: React.FC<AdvancedSearchProps> = ({ filters, onSearch, placeholder = "Search...", debounceMs = 300, className }) => {
  const [query, setQuery] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<Record<string, unknown>>({})
  const [showFilters, setShowFilters] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => onSearch(query, filterValues), debounceMs)
    return () => clearTimeout(timer)
  }, [query, filterValues, debounceMs, onSearch])

  const activeFilterCount = Object.values(filterValues).filter(v => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : true)).length

  const updateFilter = (id: string, value: unknown) => setFilterValues(prev => ({ ...prev, [id]: value }))

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder} className="pl-9 pr-9" />
          {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>}
        </div>
        <Popover open={showFilters} onOpenChange={setShowFilters}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn(activeFilterCount > 0 && "border-primary")}>
              <Filter className="w-4 h-4 mr-1" />Filters{activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <div className="space-y-4">
              {filters.map(filter => (
                <div key={filter.id}>
                  <label className="text-sm font-medium mb-1 block">{filter.label}</label>
                  {filter.type === 'select' && (
                    <Command><CommandInput onValueChange={v => updateFilter(filter.id, v)} /><CommandEmpty>No results</CommandEmpty><CommandGroup>{filter.options?.map(o => <CommandItem key={o} onSelect={() => updateFilter(filter.id, o)}>{o}</CommandItem>)}</CommandGroup></Command>
                  )}
                  {filter.type === 'multiselect' && (
                    <div className="flex flex-wrap gap-1">{filter.options?.map(o => (
                      <button key={o} onClick={() => { const current = (filterValues[filter.id] as string[]) || []; updateFilter(filter.id, current.includes(o) ? current.filter(v => v !== o) : [...current, o]) }}
                        className={cn("px-2 py-1 text-xs rounded border", (filterValues[filter.id] as string[])?.includes(o) ? "bg-primary text-primary-foreground border-primary" : "border-secondary")}>{o}</button>
                    ))}</div>
                  )}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

interface FilterPillProps { label: string; value: string; onRemove: () => void }

export const FilterPill: React.FC<FilterPillProps> = ({ label, value, onRemove }) => (
  <Badge variant="secondary" className="flex items-center gap-1">
    <span className="text-xs opacity-70">{label}:</span>
    <span>{value}</span>
    <button onClick={onRemove} className="ml-1 hover:text-foreground"><X className="w-3 h-3" /></button>
  </Badge>
)

interface FilterControlProps { filters: SearchFilter[]; values: Record<string, unknown>; onChange: (id: string, value: unknown) => void }

export const FilterControl: React.FC<FilterControlProps> = ({ filters, values, onChange }) => (
  <div className="flex flex-wrap gap-2">
    {filters.map(filter => {
      if (!filter.value && !values[filter.id]) return null
      return <FilterPill key={filter.id} label={filter.label} value={String(values[filter.id])} onRemove={() => onChange(filter.id, undefined)} />
    })}
  </div>
)