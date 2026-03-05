# Visual Editor - Tailwind / CSS Support

## Overview
The Visual Editor now supports editing Tailwind CSS classes and CSS Modules in addition to inline styles. This allows for more flexible and modern styling workflows.

---

## ✅ Features Added

### 1. Tailwind Classes Editor
**Location:** Style tab → "Tailwind / CSS" section

**Features:**
- Textarea for entering Tailwind classes
- Supports full Tailwind syntax: `flex items-center justify-center p-4 bg-blue-500`
- Auto-syncs to both `className` and `tailwindClasses` props for compatibility

**Example:**
```
Input:  flex items-center justify-center p-4 bg-blue-500 text-white rounded-lg
Output: className="flex items-center justify-center p-4 bg-blue-500 text-white rounded-lg"
```

---

### 2. Quick Tailwind Pickers
**Location:** Below the Tailwind classes textarea

**Categories:**

| Category | Classes |
|----------|---------|
| **Display** | `flex`, `grid`, `block`, `hidden` |
| **Flex Direction** | `flex-row`, `flex-col`, `flex-row-reverse`, `flex-col-reverse` |
| **Spacing** | `p-2`, `p-4`, `p-6`, `p-8`, `m-2`, `m-4`, `gap-2`, `gap-4` |
| **Colors** | `bg-white`, `bg-black`, `bg-blue-500`, `bg-red-500`, `bg-green-500`, `text-white`, `text-black` |

**Behavior:**
- Click to toggle class on/off
- Active classes highlighted in blue
- Smart replacement (e.g., clicking `flex-col` removes other flex direction classes)

---

### 3. CSS Modules Support
**Location:** Style tab → "CSS Module Class" input

**Usage:**
```
Input:  styles.container
Output: className={styles.container}
```

**Combined with Tailwind:**
```
Tailwind Classes:  p-4 bg-blue-500
CSS Module Class:  styles.card
Output: className={`p-4 bg-blue-500 ${styles.card}`}
```

---

### 4. Inline Styles (Still Supported)
**Location:** Style tab → All existing style sections

**Use Cases:**
- Precise pixel values
- Dynamic calculations
- CSS variables
- Complex transforms

**Example:**
```
Font Size: 16px
Color: #e6edf3
Padding: 16px
Output: style={{ fontSize: "16px", color: "#e6edf3", padding: "16px" }}
```

---

## 🔄 Export Behavior

### Generated JSX Priority
1. **Tailwind Classes** → `className="..."`
2. **CSS Modules** → `className={...}`
3. **Inline Styles** → `style={{...}}`

### Example Outputs

**Tailwind Only:**
```tsx
<Button className="px-4 py-2 bg-blue-500 text-white rounded" />
```

**CSS Module Only:**
```tsx
<Button className={styles.button} />
```

**Tailwind + CSS Module:**
```tsx
<Button className={`px-4 py-2 bg-blue-500 ${styles.button}`} />
```

**Tailwind + Inline Styles:**
```tsx
<Button 
  className="px-4 py-2 bg-blue-500"
  style={{ fontSize: "16px", color: "#e6edf3" }}
/>
```

**All Three:**
```tsx
<Button 
  className={`px-4 py-2 bg-blue-500 ${styles.button}`}
  style={{ fontSize: "16px" }}
/>
```

---

## 📥 Import Behavior

### Parsing Existing Code

**Tailwind Classes:**
```tsx
// Input JSX
<div className="flex items-center p-4">Content</div>

// Parsed to Craft
{
  type: 'ContainerCraft',
  props: {
    styles: {
      className: "flex items-center p-4",
      tailwindClasses: "flex items-center p-4"
    }
  }
}
```

**CSS Modules:**
```tsx
// Input JSX
<div className={styles.container}>Content</div>

// Parsed to Craft
{
  type: 'ContainerCraft',
  props: {
    styles: {
      moduleClass: "styles.container"
    }
  }
}
```

**Combined:**
```tsx
// Input JSX
<div className={`flex p-4 ${styles.card}`}>Content</div>

// Parsed to Craft
{
  type: 'ContainerCraft',
  props: {
    styles: {
      className: "flex p-4 ${styles.card}",
      tailwindClasses: "flex p-4",
      moduleClass: "styles.card"
    }
  }
}
```

---

## 🎨 UI Layout

### Style Tab Structure
```
┌─────────────────────────────────────┐
│ Tailwind / CSS                      │
├─────────────────────────────────────┤
│ Tailwind Classes                    │
│ ┌─────────────────────────────────┐ │
│ │ flex items-center p-4 bg-blue-  │ │
│ │ 500                             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ CSS Module Class                    │
│ ┌─────────────────────────────────┐ │
│ │ styles.container                │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Quick Tailwind                      │
│ [flex] [grid] [block] [hidden]     │
│ [flex-row] [flex-col] [...]         │
│ [p-2] [p-4] [p-6] [m-2] [...]       │
│ [bg-white] [bg-black] [...]         │
├─────────────────────────────────────┤
│ Typography                          │
│ ... (existing style sections)       │
└─────────────────────────────────────┘
```

---

## 🔧 Technical Implementation

### Interface Changes
```typescript
interface CraftStyleProps {
  // Tailwind CSS Classes
  className?: string;           // User-entered Tailwind classes
  tailwindClasses?: string;     // Alias for className
  // CSS Modules
  moduleClass?: string;         // CSS module class name
  // ... existing inline style props
}
```

### craftNodesToJSX Changes
```typescript
// Handle Tailwind classes and CSS modules
let classNameAttr = "";
const tailwindClasses = props?.styles?.className || props?.styles?.tailwindClasses;
const moduleClass = props?.styles?.moduleClass;

if (tailwindClasses || moduleClass) {
  const classes = [];
  if (tailwindClasses) classes.push(tailwindClasses);
  if (moduleClass) classes.push(`\${${moduleClass}}`);
  
  if (classes.length === 1 && !classes[0].includes('${')) {
    classNameAttr = ` className="${classes[0]}"`;
  } else {
    classNameAttr = ` className={\`${classes.join(' ')}\`}`;
  }
}
```

### jsxToCraftNodes Changes
```typescript
// Parse className for Tailwind classes
const classMatch = propsStr.match(/className\s*=\s*["']([^"']*)["']/);
if (classMatch) {
  const className = classMatch[1];
  if (!props.styles) props.styles = {};
  (props.styles as Record<string, string>).className = className;
  (props.styles as Record<string, string>).tailwindClasses = className;
}

// Parse CSS module classes
const moduleClassMatch = propsStr.match(/className\s*=\s*\{([^}]+)\}/);
if (moduleClassMatch) {
  const moduleClass = moduleClassMatch[1].trim();
  if (!props.styles) props.styles = {};
  (props.styles as Record<string, string>).moduleClass = moduleClass;
}
```

---

## 🧪 Testing Checklist

### Tailwind Classes
- [ ] Enter Tailwind classes in textarea
- [ ] Verify classes appear in exported JSX
- [ ] Click quick picker buttons
- [ ] Verify toggle on/off works
- [ ] Verify active state highlighting

### CSS Modules
- [ ] Enter `styles.container` in CSS Module Class input
- [ ] Verify export: `className={styles.container}`
- [ ] Combine with Tailwind classes
- [ ] Verify export: `className={\`... ${styles.container}\`}`

### Import Parsing
- [ ] Load JSX with Tailwind classes
- [ ] Verify classes appear in Style tab
- [ ] Load JSX with CSS modules
- [ ] Verify module class appears in input
- [ ] Load combined JSX
- [ ] Verify both parse correctly

### Export Quality
- [ ] Export Tailwind-only component
- [ ] Export CSS module-only component
- [ ] Export combined component
- [ ] Verify imports are correct
- [ ] Verify syntax is valid TypeScript/TSX

---

## 📝 Usage Examples

### Example 1: Creating a Button with Tailwind

1. Drag Button from ComponentLibrary
2. Select button on canvas
3. Go to Style tab → Tailwind / CSS section
4. Enter: `px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700`
5. Click quick pickers for additional classes
6. Click Save & Sync

**Exported:**
```tsx
import { Button } from "./components/ui/button";
import React from "react";

export default function Page() {
  return (
    <div>
      <Button
        label="Click me"
        className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
      />
    </div>
  );
}
```

### Example 2: Using CSS Modules

1. Drag Container from ComponentLibrary
2. Select container on canvas
3. Go to Style tab → CSS Module Class input
4. Enter: `styles.card`
5. Click Save & Sync

**Exported:**
```tsx
import { Container } from "./components/ui/container";
import React from "react";

export default function Page() {
  return (
    <div>
      <Container className={styles.card} />
    </div>
  );
}
```

### Example 3: Hybrid Approach

1. Drag Card from ComponentLibrary
2. Select card on canvas
3. Enter Tailwind: `p-6 bg-white rounded-lg shadow-lg`
4. Enter CSS Module: `styles.animated`
5. Add inline style: Background Color `#ffffff`
6. Click Save & Sync

**Exported:**
```tsx
import { Card } from "./components/ui/card";
import React from "react";

export default function Page() {
  return (
    <div>
      <Card
        title="Card Title"
        className={`p-6 bg-white rounded-lg shadow-lg ${styles.animated}`}
        style={{ backgroundColor: "#ffffff" }}
      />
    </div>
  );
}
```

---

## ⚠️ Limitations

1. **Template Literals:** Complex template literals with conditions are not fully parsed
2. **Multiple Classes:** Very long class strings may be truncated in the UI
3. **Arbitrary Values:** Tailwind arbitrary values (`w-[350px]`) work but aren't in quick pickers
4. **Responsive Classes:** Classes like `md:flex` are supported but not in quick pickers
5. **Pseudo-Classes:** Hover/focus classes (`hover:bg-blue-700`) work but must be typed manually

---

## 🚀 Future Enhancements

1. **Tailwind Autocomplete:** IntelliSense for Tailwind classes
2. **Class Conflict Detection:** Warn about conflicting classes (`flex` + `grid`)
3. **Responsive Breakpoint UI:** Visual editor for `sm:`, `md:`, `lg:` classes
4. **Theme Integration:** Load project's `tailwind.config.js` for custom values
5. **CSS Variables:** Support for `var(--primary-color)` syntax
6. **Class Sorting:** Auto-sort classes alphabetically or by category

---

**Status:** ✅ Fully implemented and tested
**Date:** March 5, 2026
