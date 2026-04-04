/**
 * Enhanced Panels Module
 *
 * Production-ready panel components with:
 * - Responsive drag-to-resize with snap-to-border
 * - Real API integrations (not mocks)
 * - Persistent state in localStorage
 * - Keyboard shortcuts
 * - Accessibility features
 * - Error boundaries
 *
 * @module @/components/panels
 */

// Core resizable panel infrastructure
export {
  ResizablePanelGroup,
  PanelPresets,
  type ResizablePanelGroupProps,
  type PanelSize,
  type PanelBounds,
  type SnapZone,
} from "./resizable-panel-group";

// Enhanced panel implementations
export {
  EnhancedWorkspacePanel,
} from "./enhanced-workspace-panel";

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * @example
 * // Basic usage with ResizablePanelGroup
 * import { ResizablePanelGroup } from "@/components/panels";
 *
 * function MyComponent() {
 *   return (
 *     <ResizablePanelGroup
 *       orientation="vertical"
 *       defaultSize={300}
 *       minSize={200}
 *       maxSize={600}
 *       snapPoints={[250, 400, 500]}
 *       storageKey="my-panel-size"
 *       onSizeChange={(size) => console.log("Panel resized:", size)}
 *     >
 *       <PanelContent />
 *     </ResizablePanelGroup>
 *   );
 * }
 */

/**
 * @example
 * // Using EnhancedTopPanel
 * import { EnhancedTopPanel } from "@/components/panels";
 *
 * function App() {
 *   return (
 *     <>
 *       <EnhancedTopPanel />
 *       <MainContent />
 *     </>
 *   );
 * }
 */

/**
 * @example
 * // Using EnhancedWorkspacePanel
 * import { EnhancedWorkspacePanel } from "@/components/panels";
 *
 * function App() {
 *   return (
 *     <>
 *       <EnhancedWorkspacePanel
 *         availableProviders={providers}
 *         currentProvider={currentProvider}
 *         currentModel={currentModel}
 *         onProviderChange={handleProviderChange}
 *         onSendMessage={handleSendMessage}
 *         onStopGeneration={handleStop}
 *         isProcessing={isGenerating}
 *       />
 *       <MainContent />
 *     </>
 *   );
 * }
 */

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Preset configurations for common panel layouts:
 *
 * - `PanelPresets.bottomPanel`: For bottom interaction panels
 *   - orientation: vertical
 *   - minSize: 200
 *   - maxSize: 600
 *   - defaultSize: 320
 *   - snapPoints: [250, 400, 500]
 *
 * - `PanelPresets.rightPanel`: For right-side workspace panels
 *   - orientation: horizontal
 *   - minSize: 250
 *   - maxSize: 800
 *   - defaultSize: 400
 *   - snapPoints: [300, 450, 600]
 *
 * - `PanelPresets.topPanel`: For top panels
 *   - orientation: vertical
 *   - minSize: 300
 *   - maxSize: 700
 *   - defaultSize: 450
 *   - snapPoints: [400, 550]
 *
 * @example
 * // Using presets
 * <ResizablePanelGroup {...PanelPresets.bottomPanel} />
 */

// ============================================================================
// Features
// ============================================================================

/**
 * Key Features:
 *
 * 1. **Responsive Resizing**
 *    - Smooth drag-to-resize with requestAnimationFrame
 *    - Touch, mouse, and keyboard support
 *    - Throttled updates for performance (~60fps)
 *
 * 2. **Snap-to-Border**
 *    - Configurable snap points
 *    - Visual indicators when dragging near snap zones
 *    - Auto-snap to min/max bounds
 *
 * 3. **Persistent State**
 *    - Panel sizes saved to localStorage
 *    - Automatic restore on page load
 *    - Throttled saves to prevent excessive writes
 *
 * 4. **Keyboard Shortcuts**
 *    - Arrow keys: Fine-tune size (10px, 50px with Shift)
 *    - M: Toggle maximize/restore
 *    - Escape: Close panel (when focused)
 *
 * 5. **Accessibility**
 *    - ARIA attributes for screen readers
 *    - Keyboard navigation
 *    - Focus management
 *
 * 6. **Edge Case Handling**
 *    - Viewport resize adaptation
 *    - Min/max bound enforcement
 *    - Touch device support
 *    - Mobile keyboard handling
 */

// ============================================================================
// API Reference
// ============================================================================

/**
 * ResizablePanelGroup Props:
 *
 * @interface ResizablePanelGroupProps
 * @property {"horizontal" | "vertical"} orientation - Panel orientation
 * @property {number} defaultSize - Initial size in pixels
 * @property {number} minSize - Minimum size in pixels
 * @property {number} maxSize - Maximum size in pixels
 * @property {number[]} snapPoints - Array of snap point positions
 * @property {number} snapTolerance - Distance in pixels for snap activation
 * @property {string} storageKey - localStorage key for persistence
 * @property {(size: number) => void} onSizeChange - Size change callback
 * @property {string} className - Additional CSS classes
 * @property {string} panelClassName - Panel content classes
 * @property {string} handleClassName - Resize handle classes
 * @property {boolean} showSnapIndicators - Show snap zone indicators
 * @property {boolean} enableKeyboardShortcuts - Enable keyboard controls
 */

/**
 * EnhancedWorkspacePanel Props:
 *
 * @interface EnhancedWorkspacePanelProps
 * @property {LLMProvider[]} availableProviders - Available providers
 * @property {string} currentProvider - Current provider
 * @property {string} currentModel - Current model
 * @property {(provider: string, model: string) => void} onProviderChange - Provider change handler
 * @property {(content: string, threadId: string) => Promise<void>} onSendMessage - Send message handler
 * @property {() => void} onStopGeneration - Stop generation handler
 * @property {boolean} isProcessing - Processing state
 */
