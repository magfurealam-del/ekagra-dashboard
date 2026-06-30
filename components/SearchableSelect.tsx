'use client'
import { useMemo, useState } from 'react'

type Option = { label: string; value: string }

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  allowFreeText = false,
}: {
  options: Option[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  allowFreeText?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!query) return options
    const q = query.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  return (
    <div className="relative">
      <input
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        placeholder={placeholder}
        value={open ? query : selectedLabel || ''}
        onChange={(e) => {
          setQuery(e.target.value)
          if (allowFreeText) onChange(e.target.value)
        }}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg text-sm">
          {filtered.map((o) => (
            <li
              key={o.value}
              className="px-3 py-2 hover:bg-teal-50 cursor-pointer"
              onMouseDown={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
