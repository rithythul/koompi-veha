import { useCallback, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '../../lib/utils'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  className?: string
}

export function DropZone({ onFiles, accept, multiple = true, className }: DropZoneProps) {
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragover(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) onFiles(multiple ? files : [files[0]])
    },
    [onFiles, multiple],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) onFiles(files)
      e.target.value = ''
    },
    [onFiles],
  )

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
        dragover
          ? 'border-accent bg-accent/5'
          : 'border-border-default hover:border-border-hover',
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragover(true)
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="w-8 h-8 text-text-muted mx-auto mb-3" />
      <p className="text-sm text-text-secondary">
        Drag & drop files here, or <span className="text-accent">browse</span>
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
    </div>
  )
}
