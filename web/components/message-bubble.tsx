
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[180px] rounded-lg border border-white/15 bg-gray-900/95 backdrop-blur-sm py-1 shadow-2xl"
            style={{
              left: Math.min(contextMenu.x, typeof window !== 'undefined' ? window.innerWidth - 200 : contextMenu.x),
              top: Math.min(contextMenu.y, typeof window !== 'undefined' ? window.innerHeight - 120 : contextMenu.y),
            }}
            // stopPropagation prevents the pointerup outside-click handler from
            // dismissing the menu when clicking an item inside it.
            onClick={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            // preventDefault on mousedown stops the browser from collapsing the
            // text selection before the menu item's onClick fires.
            onMouseDown={(e) => e.preventDefault()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            role="menu"
            aria-label="Message actions"
          >
            <button
              type="button"
              role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 flex items-center gap-2"
              onClick={async () => {
                setContextMenu(null)
                await handleCopy()
              }}
            >
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4 text-white/70" />}
              {copied ? 'Copied' : 'Copy message'}
            </button>
            {contextMenuSelectionRef.current && (
              <button
                type="button"
                role="menuitem"
                className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 flex items-center gap-2"
                onClick={() => {
                  const sel = contextMenuSelectionRef.current
                  if (sel) {
                    navigator.clipboard?.writeText(sel).catch(() => {})
                  }
                  setContextMenu(null)
                }}
              >
                <Copy className="h-4 w-4 text-white/70" />
                Copy selection
              </button>
            )}
          </div>
        )}
