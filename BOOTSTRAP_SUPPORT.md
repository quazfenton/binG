# Visual Editor - Bootstrap CSS Support

## Overview
The Visual Editor now supports **Bootstrap 5** in addition to Tailwind CSS. Switch between frameworks with one click and use familiar Bootstrap classes in your visual designs.

---

## ✅ Features Added

### 1. Framework Toggle

**Location:** Style tab → Top section

**Options:**
- **Tailwind CSS** (blue button) - Utility-first CSS framework
- **Bootstrap** (purple button) - Most popular CSS framework

**Behavior:**
- Click to switch frameworks
- Classes persist when switching (you can mix if needed)
- Different class pickers for each framework

---

### 2. Bootstrap Class Categories (100+ Classes)

| Category | Classes |
|----------|---------|
| **Display** | d-none, d-block, d-flex, d-grid, d-inline, d-inline-block |
| **Flex** | flex-row, flex-column, flex-wrap, flex-nowrap |
| **Justify Content** | justify-content-start, justify-content-center, justify-content-between |
| **Align Items** | align-items-start, align-items-center, align-items-stretch |
| **Spacing** | m-0 to m-5, mt-*, mb-*, mx-auto, my-auto |
| **Padding** | p-0 to p-5, pt-*, pb-*, px-*, py-* |
| **Sizing** | w-25, w-50, w-75, w-100, w-auto, h-*, mw-100, mh-100 |
| **Typography** | h1-h6, display-1 to display-6, lead, fw-*, fst-* |
| **Text Colors** | text-primary, text-success, text-danger, text-warning, text-info |
| **Background Colors** | bg-primary, bg-success, bg-danger, bg-warning, bg-info |
| **Borders** | border, border-0, border-*, border-*-color |
| **Border Radius** | rounded, rounded-0, rounded-circle, rounded-pill |
| **Shadows** | shadow-none, shadow-sm, shadow, shadow-lg |
| **Positioning** | position-static, position-relative, position-absolute, position-fixed |

---

### 3. Bootstrap Presets (20 Templates)

| Preset | Classes |
|--------|---------|
| Flex Center | `d-flex justify-content-center align-items-center` |
| Flex Between | `d-flex justify-content-between align-items-center` |
| Flex Column | `d-flex flex-column gap-3` |
| Card | `card p-4 shadow-sm` |
| Button Primary | `btn btn-primary` |
| Button Secondary | `btn btn-secondary` |
| Button Outline | `btn btn-outline-primary` |
| Badge | `badge bg-primary` |
| Badge Pill | `badge rounded-pill bg-primary` |
| Alert | `alert alert-primary` |
| Heading 1 | `display-4 fw-bold` |
| Heading 2 | `display-6` |
| Lead Text | `lead` |
| Container | `container` |
| Container Fluid | `container-fluid` |
| Row | `row g-3` |
| Col | `col` |
| Col Auto | `col-auto` |
| Full Width | `w-100 h-100` |
| Centered Content | `d-flex justify-content-center align-items-center min-vh-100` |

---

## 🎨 UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│ CSS Framework                                                  │
├────────────────────────────────────────────────────────────────┤
│ [  Tailwind CSS  ] [    Bootstrap    ]                        │
└────────────────────────────────────────────────────────────────┘

When Bootstrap Selected:
┌────────────────────────────────────────────────────────────────┐
│ Bootstrap Classes                           [📋] [📥]          │
├────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ d-flex justify-content-center align-items-center          │ │
│ └────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│ Display                                                        │
│ [d-none] [d-block] [d-flex] [d-grid] [d-inline] [d-inline-..]│
├────────────────────────────────────────────────────────────────┤
│ Flex                                                           │
│ [flex-row] [flex-column] [flex-wrap] [flex-nowrap]           │
├────────────────────────────────────────────────────────────────┤
│ ... (15+ categories)                                          │
├────────────────────────────────────────────────────────────────┤
│ Bootstrap Presets                                              │
│ [Flex Center] [Card] [Button Primary] [Badge] [Alert] ...    │
└────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Comparison: Tailwind vs Bootstrap

| Task | Tailwind | Bootstrap |
|------|----------|-----------|
| **Flex container** | `flex` | `d-flex` |
| **Center content** | `justify-center items-center` | `justify-content-center align-items-center` |
| **Padding 16px** | `p-4` | `p-3` |
| **Margin auto** | `mx-auto` | `mx-auto` |
| **Primary button** | `bg-blue-600 text-white` | `btn btn-primary` |
| **Card** | `p-6 bg-white rounded-lg shadow-md` | `card p-4 shadow-sm` |
| **Hidden on mobile** | `hidden sm:block` | `d-none d-sm-block` |
| **Grid 2 columns** | `grid grid-cols-2` | `row g-3` + `col-6` |

---

## 📝 Usage Examples

### Example 1: Bootstrap Card

```
1. Select Bootstrap framework
2. Click preset "Card"
   Result: card p-4 shadow-sm

3. Add spacing:
   - Click "m-4"
   Result: card p-4 shadow-sm m-4

4. Add border radius:
   - Click "rounded"
   Result: card p-4 shadow-sm m-4 rounded
```

### Example 2: Bootstrap Button

```
1. Select Bootstrap framework
2. Click preset "Button Primary"
   Result: btn btn-primary

3. Add size:
   - Click "btn-lg"
   Result: btn btn-primary btn-lg
```

### Example 3: Responsive Layout

```
1. Base (mobile):
   - Click "d-flex"
   - Click "flex-column"
   - Click "gap-3"

2. md: breakpoint:
   - Click "d-md-flex"
   - Click "flex-md-row"
   Result: d-flex flex-column gap-3 d-md-flex flex-md-row
```

### Example 4: Bootstrap Alert

```
1. Select Bootstrap framework
2. Click preset "Alert"
   Result: alert alert-primary

3. Add dismissible style:
   - Manually add: `alert-dismissible fade show`
   Result: alert alert-primary alert-dismissible fade show
```

---

## 🔧 Technical Implementation

### BootstrapCategory Component

```typescript
interface BootstrapCategoryProps {
  label: string;
  classes: string[];
  current: string;
  onChange: (key: string, value: string) => void;
  search: string;
  exclusive?: boolean;
}

function BootstrapCategory({ 
  label, 
  classes, 
  current, 
  onChange, 
  search, 
  exclusive = false 
}: BootstrapCategoryProps) {
  const filtered = classes.filter(c => !search || c.includes(search.toLowerCase()));
  
  return (
    <div className="space-y-1">
      <p className="text-[9px] text-[#484f58]">{label}</p>
      <div className="flex flex-wrap gap-1">
        {filtered.map((cls) => (
          <button
            onClick={() => {
              if (exclusive) {
                // Remove conflicting classes
              } else {
                // Toggle individual class
              }
            }}
            className={isActive ? "active" : "inactive"}
          >
            {cls}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Framework State

```typescript
const [cssFramework, setCssFramework] = useState<"tailwind" | "bootstrap">("tailwind");

// Conditional rendering
{cssFramework === "bootstrap" && (
  <BootstrapClassPicker />
)}
```

---

## 🧪 Testing Checklist

### Framework Toggle
- [ ] Click "Bootstrap" → Bootstrap classes shown
- [ ] Click "Tailwind" → Tailwind classes shown
- [ ] Classes persist when switching

### Bootstrap Classes
- [ ] Click display class → Applied
- [ ] Click flex class → Applied
- [ ] Click spacing class → Applied
- [ ] Click color class → Applied
- [ ] Exclusive groups work (only one at a time)

### Bootstrap Presets
- [ ] Click preset → Full class string applied
- [ ] Toast notification shows
- [ ] All 20 presets work

### Copy/Paste
- [ ] Copy Bootstrap classes → Works
- [ ] Paste Bootstrap classes → Works

### Search
- [ ] Type "flex" → Flex classes shown
- [ ] Type "btn" → Button classes shown
- [ ] Clear search → All classes shown

---

## ⚠️ Known Limitations

1. **Bootstrap Version:** Currently supports Bootstrap 5.x classes
2. **JavaScript Components:** Bootstrap JS components (dropdowns, modals) not included
3. **Icons:** Bootstrap Icons not integrated
4. **Custom Build:** Custom Bootstrap builds (Sass variables) not loaded
5. **RTL:** RTL variants not included

---

## 🚀 Future Enhancements

1. **Bulma Support** - Add Bulma framework toggle
2. **Foundation Support** - Add ZURB Foundation classes
3. **Component Props** - Visual editor for Bootstrap component props
4. **Grid Builder** - Visual Bootstrap grid/layout builder
5. **Theme Colors** - Custom Bootstrap theme color picker
6. **Utility API** - Bootstrap utility API class generator

---

## 📊 Class Count by Category

| Category | Count |
|----------|-------|
| Display | 8 |
| Flex | 7 |
| Justify Content | 6 |
| Align Items | 5 |
| Spacing | 22 |
| Padding | 18 |
| Gap | 6 |
| Sizing | 12 |
| Typography | 24 |
| Text Colors | 13 |
| Background Colors | 12 |
| Borders | 15 |
| Border Radius | 11 |
| Shadows | 4 |
| Positioning | 5 |
| **Presets** | **20** |
| **Total** | **188+** |

---

**Status:** ✅ Fully implemented with 188+ Bootstrap classes
**Framework:** Bootstrap 5.x
**Date:** March 5, 2026
