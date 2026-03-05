# Visual Editor - Framer Motion Animation Support

## Overview
The Visual Editor now includes **Framer Motion** animation support with a visual animation builder. Create professional animations without writing code, then export ready-to-use Framer Motion components.

---

## ✅ Features Added

### 1. Animation Framework Toggle

**Location:** Style tab → Animations section

**Options:**
- **No Animation** (blue) - Disable animations
- **Framer Motion** (teal/green) - Enable Framer Motion animations

**Behavior:**
- Click to enable/disable animations
- Opens animation panel when enabled
- Settings persist per component

---

### 2. Animation Presets (16 Presets)

| Preset | Effect | Best For |
|--------|--------|----------|
| **fade** | Opacity 0 → 1 | Simple entrances |
| **slideUp** | Slide from bottom | Content reveals |
| **slideDown** | Slide from top | Dropdown menus |
| **slideLeft** | Slide from right | Page transitions |
| **slideRight** | Slide from left | Sidebars |
| **scaleUp** | Scale 0.5 → 1 | Pop-in effects |
| **scaleDown** | Scale 1.5 → 1 | Zoom effects |
| **rotate** | Rotate -180° → 0° | Spin entrances |
| **bounce** | Spring bounce | Playful UIs |
| **flip** | 3D flip | Card flips |
| **expand** | Horizontal expand | Progress bars |
| **shrink** | Horizontal shrink | Collapsing |
| **pulse** | Continuous pulse | Attention grabber |
| **shake** | Continuous shake | Error states |
| **float** | Floating motion | Hero elements |
| **glow** | Glowing effect | CTAs, buttons |

---

### 3. Gesture System

**Three Gesture States:**
- **initial** - Starting state (before animation)
- **animate** - End state (what it animates to)
- **exit** - State when component unmounts

**Usage:**
1. Select gesture tab
2. Set properties for that gesture
3. Framer Motion handles interpolation

**Example:**
```
initial: { opacity: 0, y: 50 }
animate: { opacity: 1, y: 0 }
exit: { opacity: 0, y: -50 }

Result: Element fades in from bottom, exits to top
```

---

### 4. Visual Transform Controls

**Properties (with sliders):**

| Property | Range | Default |
|----------|-------|---------|
| **Opacity** | 0 - 1 | 1 |
| **X Position** | -200px - 200px | 0 |
| **Y Position** | -200px - 200px | 0 |
| **Scale** | 0 - 2 | 1 |
| **Rotate** | -360° - 360° | 0° |

**Features:**
- Real-time preview (when component selected)
- Per-gesture settings
- Visual feedback

---

### 5. Transition Settings

**Duration Slider:**
- Range: 0 - 2 seconds
- Step: 0.1s
- Default: 0.3s

**Transition Presets (12):**

| Preset | Effect |
|--------|--------|
| **quick** | 0.15s duration |
| **normal** | 0.3s duration |
| **slow** | 0.6s duration |
| **spring** | Spring physics (stiff: 300) |
| **springGentle** | Gentle spring (stiff: 200) |
| **springBouncy** | Bouncy spring (stiff: 500) |
| **easeIn** | Ease in curve |
| **easeOut** | Ease out curve |
| **easeInOut** | Ease in-out curve |
| **backIn** | Back ease in |
| **backOut** | Back ease out |
| **circIn** | Circular ease in |
| **circOut** | Circular ease out |

---

### 6. Generated Code Preview

**Live Code Display:**
```tsx
<motion.div
  initial={{ opacity: 0, y: 50 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -50 }}
  transition={{ duration: 0.3 }}
>
  Content
</motion.div>
```

**Features:**
- Real-time updates
- Copy-paste ready
- Shows all properties

---

## 🎨 UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│ Animatics                               [Hide]                 │
├────────────────────────────────────────────────────────────────┤
│ [  No Animation  ] [  Framer Motion  ]                        │
├────────────────────────────────────────────────────────────────┤
│ Framer Motion                                                  │
├────────────────────────────────────────────────────────────────┤
│ Gesture                                                        │
│ [ initial ] [ animate ] [ exit ]                               │
├────────────────────────────────────────────────────────────────┤
│ Animation Presets                                              │
│ [fade] [slideUp] [slideDown] [scaleUp] [bounce] [flip] ...    │
├────────────────────────────────────────────────────────────────┤
│ animate Properties                                             │
│ Opacity  [━━━━━●━━━━━]  1.0                                   │
│ X        [━━━●━━━━━━━━]  0px                                   │
│ Y        [━━━●━━━━━━━━]  0px                                   │
│ Scale    [━━━━━●━━━━━]  1.0x                                   │
│ Rotate   [━━━●━━━━━━━━]  0°                                    │
├────────────────────────────────────────────────────────────────┤
│ Transition                                                     │
│ Duration [━━━●━━━━━━━━]  0.3s                                  │
│ [quick] [normal] [slow] [spring] [easeIn] [easeOut] ...       │
├────────────────────────────────────────────────────────────────┤
│ Generated Code                                                 │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ <motion.div                                                │ │
│ │   initial={{ opacity: 0, y: 50 }}                          │ │
│ │   animate={{ opacity: 1, y: 0 }}                           │ │
│ │   exit={{ opacity: 0, y: -50 }}                            │ │
│ │   transition={{ duration: 0.3 }}                           │ │
│ │ >                                                          │ │
│ └────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│ [        Clear Animation        ]                              │
└────────────────────────────────────────────────────────────────┘
```

---

## 📝 Usage Examples

### Example 1: Fade In Animation

```
1. Click "Framer Motion"
2. Click preset "fade"
3. Result:
   initial: { opacity: 0 }
   animate: { opacity: 1 }
   exit: { opacity: 0 }
```

### Example 2: Slide Up with Spring

```
1. Click "Framer Motion"
2. Click preset "slideUp"
3. Select transition "spring"
4. Result:
   initial: { opacity: 0, y: 50 }
   animate: { opacity: 1, y: 0 }
   transition: { type: "spring", stiffness: 300, damping: 20 }
```

### Example 3: Custom Pulse Animation

```
1. Click "Framer Motion"
2. Select "animate" gesture
3. Set Scale to 1.1
4. Click transition "springBouncy"
5. Manually add repeat (in code):
   transition: { repeat: Infinity, duration: 1.5 }
```

### Example 4: Page Exit Animation

```
1. Click "Framer Motion"
2. Select "exit" gesture
3. Set Opacity to 0
4. Set Y to -50
5. Select transition "easeOut"
6. Result: Component slides up and fades out on exit
```

### Example 5: Complex Multi-Gesture Animation

```
initial: { opacity: 0, scale: 0.8, rotate: -10 }
animate: { opacity: 1, scale: 1, rotate: 0 }
exit: { opacity: 0, scale: 1.2, rotate: 10 }
transition: { duration: 0.4, ease: "easeInOut" }

Result: Element fades in while scaling up and rotating,
        exits with opposite motion
```

---

## 🔧 Technical Implementation

### Animation State Management

```typescript
const [framerInitial, setFramerInitial] = useState<Record<string, any>>({});
const [framerAnimate, setFramerAnimate] = useState<Record<string, any>>({});
const [framerExit, setFramerExit] = useState<Record<string, any>>({});
const [framerTransition, setFramerTransition] = useState({ duration: 0.3 });
const [activeGesture, setActiveGesture] = useState<"initial" | "animate" | "exit">("animate");
```

### Preset Application

```typescript
const applyPreset = (presetName: string) => {
  const preset = FRAMER_PRESETS[presetName];
  if (preset.initial) setFramerInitial(preset.initial);
  if (preset.animate) setFramerAnimate(preset.animate);
  if (preset.exit) setFramerExit(preset.exit);
};
```

### Code Generation

```typescript
const generatedCode = `
<motion.div
  initial={${JSON.stringify(framerInitial)}}
  animate={${JSON.stringify(framerAnimate)}}
  exit={${JSON.stringify(framerExit)}}
  transition={${JSON.stringify(framerTransition)}}
>
  {children}
</motion.div>
`;
```

---

## 🧪 Testing Checklist

### Animation Toggle
- [ ] Click "Framer Motion" → Panel opens
- [ ] Click "No Animation" → Panel closes
- [ ] Settings persist when toggling

### Presets
- [ ] Click each preset → Properties update
- [ ] Toast notification shows
- [ ] All 16 presets work

### Gesture System
- [ ] Switch between initial/animate/exit
- [ ] Properties update per gesture
- [ ] Active gesture highlighted

### Transform Controls
- [ ] Opacity slider works (0-1)
- [ ] X slider works (-200 to 200)
- [ ] Y slider works (-200 to 200)
- [ ] Scale slider works (0-2)
- [ ] Rotate slider works (-360 to 360)
- [ ] Values display correctly

### Transition
- [ ] Duration slider works
- [ ] Transition presets apply
- [ ] All 12 presets work

### Code Preview
- [ ] Code updates in real-time
- [ ] JSON is valid
- [ ] Can copy-paste to project

### Clear Animation
- [ ] Click "Clear Animation" → All reset
- [ ] Toast shows confirmation

---

## ⚠️ Known Limitations

1. **Preview:** Animation preview requires running the exported code
2. **Keyframes:** Complex keyframe arrays not in UI (edit code manually)
3. **Drag:** Drag gestures not configured in UI
4. **Layout:** Layout animations not configured
5. **Shared:** Shared element transitions not configured
6. **Scroll:** Scroll-based animations not configured
7. **Gestures:** Hover/tap/pan not in UI (use initial/animate/exit)

---

## 🚀 Future Enhancements

1. **Animation Preview** - Live preview in editor
2. **Keyframe Editor** - Visual keyframe timeline
3. **Drag Gestures** - Drag-to-animate configuration
4. **Layout Animations** - LayoutGroup support
5. **Shared Transitions** - layoutId configuration
6. **Scroll Animations** - useScroll integration
7. **Gesture Variants** - hover/tap/pan variants
8. **Import Animation** - Import from Framer Motion code
9. **Animation Library** - Save/share custom animations
10. **Easing Editor** - Visual cubic-bezier editor

---

## 📊 Animation Count

| Category | Count |
|----------|-------|
| Entrance Presets | 8 |
| Exit Presets | 4 |
| Continuous Animations | 4 |
| Transition Presets | 12 |
| Transform Controls | 5 |
| **Total** | **33** |

---

## 📦 Export Format

### Basic Export
```tsx
import { motion } from "framer-motion";

export function AnimatedComponent() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.3 }}
    >
      Content
    </motion.div>
  );
}
```

### With Variants
```tsx
import { motion } from "framer-motion";

const variants = {
  hidden: { opacity: 0, y: 50 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -50 },
};

export function AnimatedComponent() {
  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{ duration: 0.3 }}
    >
      Content
    </motion.div>
  );
}
```

### With Spring Physics
```tsx
import { motion } from "framer-motion";

export function AnimatedComponent() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      Content
    </motion.div>
  );
}
```

---

**Status:** ✅ Fully implemented with 16 animation presets
**Framework:** Framer Motion 10.x+
**Date:** March 5, 2026
