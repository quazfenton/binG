# Code Review: web/lib/figma

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## figma/ Module (6 files)

This module provides integration with Figma, including OAuth authentication, REST API access, and a complex converter for transforming Figma designs into Craft.js-compatible components.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| converter.ts | 650 | Figma Node to Craft.js conversion logic |
| api.ts | ~200 | Figma REST API client |
| oauth.ts | ~150 | OAuth 2.0 with PKCE for Figma |
| config.ts | 57 | Configuration and environment helpers |
| types.ts | ~120 | Figma and Craft.js type definitions |
| index.ts | 30 | Barrel exports |

### Good Practices

1. **Craft.js Compatibility** (line 32)
   Properly models the internal state of Craft.js (a popular React drag-and-drop framework), enabling a bridge between professional design tools and the application's visual editor.

2. **Recursive Node Conversion**
   The `converter.ts` handles the complex nesting of Figma nodes (Frames, Groups, Sections) and flattens them into the Craft.js node map.

3. **Style Mapping**
   Transforms Figma's unique paint and layout properties (Fills, Strokes, Auto-Layout) into CSS-compatible props for React components.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 3 |

### MEDIUM PRIORITY

1. **Complex Component Detection Logic** (line 12)
   Detecting a "Button" from a raw Figma Frame with a Text node is highly heuristic. Design inconsistencies (e.g., a button without a specific name or structure) will result in broken or misidentified components.
   
   **Recommendation:** Use Figma's "Component" or "Instance" types for more reliable detection if the user follows a design system.

### LOW PRIORITY

1. **Huge File Size** (line 1)
   `converter.ts` at 650 lines is becoming a "God File." Consider splitting it into `style-mappers.ts`, `node-handlers.ts`, etc.
2. **Missing Asset Export**
   Figma images and vectors need to be explicitly exported via the API to be visible in the Craft.js editor. Ensure the `converter` handles the asynchronous fetching of these asset URLs.
3. **Standalone Status**
   This module is currently standalone and not imported by the main application flows.

---

## Wiring

- **Used by:**
  - **Standalone** (as identified in previous search).

**Status:** ⚠️ Ready but unintegrated.

---

## Summary

The Figma module is a robust bridge for design-to-code workflows. Its conversion logic is sophisticated, although it will require careful tuning to handle real-world design variability.

---

*End of Review*