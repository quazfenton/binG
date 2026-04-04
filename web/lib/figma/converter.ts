/**
 * Figma to Craft.js Converter
 * 
 * Converts Figma node structures to Craft.js compatible nodes
 * for import into the visual editor.
 * 
 * Figma Node Types → Craft.js Components:
 * - FRAME/GROUP/SECTION → Container
 * - TEXT → Text
 * - RECTANGLE → Container (with styling)
 * - IMAGE → Image
 * - BUTTON (frame with text) → Button
 */

import type {
  FigmaNode,
  FigmaFrameNode,
  FigmaTextNode,
  FigmaRectangleNode,
  FigmaPaint,
  FigmaColor,
  FigmaRectangle,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Craft.js node structure
 */
export interface CraftNode {
  id: string;
  type: string;
  isCanvas: boolean;
  props: Record<string, any>;
  parent?: string;
  children: string[];
  linkedNodes?: Record<string, string>;
  name?: string;
  displayName?: string;
  custom?: Record<string, any>;
  hidden?: boolean;
  isDeleted?: boolean;
  _hydrationTimestamp?: number;
}

/**
 * Craft.js serialized node map
 */
export interface CraftNodesMap {
  [key: string]: CraftNode;
}

/**
 * Conversion result
 */
export interface ConversionResult {
  nodes: CraftNodesMap;
  rootId: string;
  warnings: string[];
  metadata: {
    source: 'figma';
    fileKey?: string;
    fileName?: string;
    convertedAt: number;
    nodeCount: number;
  };
}

// ============================================================================
// Style Conversion Utilities
// ============================================================================

/**
 * Convert Figma color to CSS color string
 */
function figmaColorToCss(color: FigmaColor | undefined, opacity?: number): string | undefined {
  if (!color) return undefined;
  
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = opacity !== undefined ? opacity : color.a;
  
  if (a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Convert Figma paint to CSS background
 */
function figmaPaintToCss(paint: FigmaPaint): string | undefined {
  if (!paint.visible) return undefined;
  
  switch (paint.type) {
    case 'SOLID':
      return paint.color ? figmaColorToCss(paint.color, paint.opacity) : undefined;
    
    case 'GRADIENT_LINEAR':
      if (paint.gradientStops && paint.gradientStops.length >= 2) {
        const angle = '45deg'; // Default angle
        const stops = paint.gradientStops
          .map(stop => `${figmaColorToCss(stop.color)} ${stop.position * 100}%`)
          .join(', ');
        return `linear-gradient(${angle}, ${stops})`;
      }
      return undefined;
    
    case 'IMAGE':
      // Image fills require separate API call to get URL
      return undefined;
    
    default:
      return undefined;
  }
}

/**
 * Convert Figma auto-layout to Tailwind flex classes
 */
function figmaLayoutToTailwind(node: FigmaFrameNode): string[] {
  const classes: string[] = [];
  
  if (!node.layoutMode || node.layoutMode === 'NONE') {
    return classes;
  }
  
  // Flex direction
  if (node.layoutMode === 'HORIZONTAL') {
    classes.push('flex', 'flex-row');
  } else if (node.layoutMode === 'VERTICAL') {
    classes.push('flex', 'flex-col');
  }
  
  // Primary axis alignment
  if (node.primaryAxisAlignItems === 'CENTER') {
    classes.push(node.layoutMode === 'HORIZONTAL' ? 'justify-center' : 'justify-center');
  } else if (node.primaryAxisAlignItems === 'MAX') {
    classes.push(node.layoutMode === 'HORIZONTAL' ? 'justify-end' : 'justify-end');
  } else if (node.primaryAxisAlignItems === 'SPACE_BETWEEN') {
    classes.push('justify-between');
  } else {
    classes.push('justify-start');
  }
  
  // Counter axis alignment
  if (node.counterAxisAlignItems === 'CENTER') {
    classes.push('items-center');
  } else if (node.counterAxisAlignItems === 'MAX') {
    classes.push('items-end');
  } else if (node.counterAxisAlignItems === 'BASELINE') {
    classes.push('items-baseline');
  } else {
    classes.push('items-start');
  }
  
  // Gap
  if (node.itemSpacing && node.itemSpacing > 0) {
    classes.push(`gap-${Math.round(node.itemSpacing / 4)}`); // Approximate pixel to Tailwind ratio
  }
  
  // Padding
  if (node.paddingTop && node.paddingTop > 0) {
    classes.push(`pt-${Math.round(node.paddingTop / 4)}`);
  }
  if (node.paddingBottom && node.paddingBottom > 0) {
    classes.push(`pb-${Math.round(node.paddingBottom / 4)}`);
  }
  if (node.paddingLeft && node.paddingLeft > 0) {
    classes.push(`pl-${Math.round(node.paddingLeft / 4)}`);
  }
  if (node.paddingRight && node.paddingRight > 0) {
    classes.push(`pr-${Math.round(node.paddingRight / 4)}`);
  }
  
  // Wrap
  if (node.primaryAxisSizingMode === 'AUTO' && node.counterAxisSizingMode === 'AUTO') {
    classes.push('flex-wrap');
  }
  
  return classes;
}

/**
 * Convert Figma size to inline styles
 */
function figmaSizeToStyle(node: FigmaNode): React.CSSProperties {
  const style: React.CSSProperties = {};
  
  if (node.absoluteBoundingBox) {
    style.width = `${node.absoluteBoundingBox.width}px`;
    style.height = `${node.absoluteBoundingBox.height}px`;
  } else if (node.size) {
    style.width = `${node.size.width}px`;
    style.height = `${node.size.height}px`;
  }
  
  return style;
}

/**
 * Convert Figma corner radius to Tailwind classes
 */
function figmaCornerRadiusToClasses(radius: number | number[] | undefined): string[] {
  if (!radius || radius === 0) return [];
  
  const values = Array.isArray(radius) ? radius : [radius];
  const classes: string[] = [];
  
  // Map common radius values to Tailwind classes
  const radiusMap: Record<number, string> = {
    2: 'rounded-sm',
    4: 'rounded',
    6: 'rounded-md',
    8: 'rounded-lg',
    12: 'rounded-xl',
    16: 'rounded-2xl',
    24: 'rounded-3xl',
    9999: 'rounded-full',
  };
  
  if (values.length === 1) {
    classes.push(radiusMap[values[0]] || `rounded-[${values[0]}px]`);
  } else if (values.length === 4) {
    // [topLeft, topRight, bottomRight, bottomLeft]
    const [tl, tr, br, bl] = values;
    if (tl === tr && tr === br && br === bl) {
      classes.push(radiusMap[tl] || `rounded-[${tl}px]`);
    } else {
      classes.push(
        `rounded-tl-[${tl}px]`,
        `rounded-tr-[${tr}px]`,
        `rounded-br-[${br}px]`,
        `rounded-bl-[${bl}px]`
      );
    }
  }
  
  return classes;
}

/**
 * Convert Figma text style to CSS
 */
function figmaTextStyleToStyle(node: FigmaTextNode): React.CSSProperties {
  const style: React.CSSProperties = {};
  
  const textStyle = node.style;
  
  if (textStyle.fontFamily) {
    style.fontFamily = textStyle.fontFamily;
  }
  
  if (textStyle.fontSize) {
    style.fontSize = `${textStyle.fontSize}px`;
  }
  
  if (textStyle.fontWeight) {
    style.fontWeight = textStyle.fontWeight.toString();
  }
  
  if (textStyle.textAlignHorizontal) {
    switch (textStyle.textAlignHorizontal) {
      case 'LEFT':
        style.textAlign = 'left';
        break;
      case 'CENTER':
        style.textAlign = 'center';
        break;
      case 'RIGHT':
        style.textAlign = 'right';
        break;
      case 'JUSTIFIED':
        style.textAlign = 'justify';
        break;
    }
  }
  
  if (textStyle.lineHeight) {
    if (textStyle.lineHeight.unit === 'PIXELS') {
      style.lineHeight = `${textStyle.lineHeight.value}px`;
    } else if (textStyle.lineHeight.unit === 'PERCENT') {
      style.lineHeight = textStyle.lineHeight.value ? (textStyle.lineHeight.value / 100).toString() : undefined;
    }
  }
  
  if (textStyle.letterSpacing) {
    style.letterSpacing = `${textStyle.letterSpacing}px`;
  }
  
  if (textStyle.textDecoration) {
    style.textDecoration = textStyle.textDecoration.toLowerCase();
  }
  
  return style;
}

// ============================================================================
// Node Conversion
// ============================================================================

/**
 * Generate unique node ID
 */
function generateNodeId(figmaNodeId: string): string {
  return `node_${figmaNodeId.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * Convert Figma frame to Craft.js Container node
 */
function convertFrameNode(node: FigmaFrameNode, parentId: string | undefined, warnings: string[]): CraftNode {
  const id = generateNodeId(node.id);
  
  // Convert layout to Tailwind classes
  const layoutClasses = figmaLayoutToTailwind(node);
  
  // Convert corner radius
  const cornerRadius = 'cornerRadius' in node ? node.cornerRadius : undefined;
  const cornerClasses = figmaCornerRadiusToClasses(cornerRadius as any);
  
  // Build className
  const classNameParts = [...layoutClasses, ...cornerClasses];
  if (node.fills && node.fills.length > 0) {
    const bgPaint = node.fills[0];
    const bgColor = figmaColorToCss(bgPaint.color, bgPaint.opacity);
    if (bgColor) {
      // We'll use inline style for background color
    }
  }
  
  // Build props
  const props: Record<string, any> = {
    className: classNameParts.join(' ') || undefined,
    style: figmaSizeToStyle(node),
  };
  
  // Add background color if present
  if (node.fills && node.fills.length > 0) {
    const bgPaint = node.fills[0];
    const bgColor = figmaColorToCss(bgPaint.color, bgPaint.opacity);
    if (bgColor) {
      props.style = { ...props.style, backgroundColor: bgColor };
    }
  }
  
  // Add border if present
  if (node.strokes && node.strokes.length > 0) {
    const stroke = node.strokes[0];
    const strokeColor = figmaColorToCss(stroke.color, stroke.opacity);
    if (strokeColor) {
      props.style = {
        ...props.style,
        borderColor: strokeColor,
        borderWidth: `${node.strokeWeight || 1}px`,
      };
    }
  }
  
  // Add effects (shadows)
  if (node.effects && node.effects.length > 0) {
    const dropShadow = node.effects.find(e => e.type === 'DROP_SHADOW');
    if (dropShadow && dropShadow.color) {
      const shadowColor = figmaColorToCss(dropShadow.color);
      const offsetX = dropShadow.offset?.x || 0;
      const offsetY = dropShadow.offset?.y || 0;
      const blur = dropShadow.radius || 0;
      const spread = dropShadow.spread || 0;
      
      props.style = {
        ...props.style,
        boxShadow: `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${shadowColor}`,
      };
    }
  }
  
  return {
    id,
    type: 'Container',
    isCanvas: true,
    props,
    parent: parentId,
    children: [],
    name: node.name,
    displayName: node.name,
  };
}

/**
 * Convert Figma text to Craft.js Text node
 */
function convertTextNode(node: FigmaTextNode, parentId: string | undefined): CraftNode {
  const id = generateNodeId(node.id);
  
  const props: Record<string, any> = {
    text: node.characters,
    style: {
      ...figmaSizeToStyle(node),
      ...figmaTextStyleToStyle(node),
    },
  };
  
  // Add text color if present
  if (node.fills && node.fills.length > 0) {
    const fill = node.fills[0];
    const color = figmaColorToCss(fill.color, fill.opacity);
    if (color) {
      props.style.color = color;
    }
  }
  
  return {
    id,
    type: 'Text',
    isCanvas: false,
    props,
    parent: parentId,
    children: [],
    name: node.name,
    displayName: node.name,
  };
}

/**
 * Convert Figma rectangle to Craft.js Container node
 */
function convertRectangleNode(node: FigmaRectangleNode, parentId: string | undefined, warnings: string[]): CraftNode {
  const id = generateNodeId(node.id);
  
  const cornerRadius = 'cornerRadius' in node ? node.cornerRadius : undefined;
  const cornerClasses = figmaCornerRadiusToClasses(cornerRadius as any);
  
  const props: Record<string, any> = {
    className: cornerClasses.join(' ') || undefined,
    style: figmaSizeToStyle(node),
  };
  
  // Add fill color
  if (node.fills && node.fills.length > 0) {
    const fill = node.fills[0];
    const color = figmaColorToCss(fill.color, fill.opacity);
    if (color) {
      props.style = { ...props.style, backgroundColor: color };
    }
  }
  
  // Add border
  if (node.strokes && node.strokes.length > 0) {
    const stroke = node.strokes[0];
    const strokeColor = figmaColorToCss(stroke.color, stroke.opacity);
    if (strokeColor) {
      props.style = {
        ...props.style,
        borderColor: strokeColor,
        borderWidth: `${node.strokeWeight || 1}px`,
      };
    }
  }
  
  return {
    id,
    type: 'Container',
    isCanvas: false,
    props,
    parent: parentId,
    children: [],
    name: node.name,
    displayName: node.name,
  };
}

/**
 * Convert unknown Figma node to generic Container
 */
function convertGenericNode(node: FigmaNode, parentId: string | undefined, warnings: string[]): CraftNode {
  const id = generateNodeId(node.id);
  
  warnings.push(`Unknown node type "${node.type}" converted to generic Container`);
  
  return {
    id,
    type: 'Container',
    isCanvas: false,
    props: {
      style: figmaSizeToStyle(node),
    },
    parent: parentId,
    children: [],
    name: node.name,
    displayName: node.name,
  };
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Recursively convert Figma node tree to Craft.js nodes
 */
function convertNodeTree(
  node: FigmaNode,
  parentId: string | undefined,
  warnings: string[]
): CraftNodesMap {
  const nodes: CraftNodesMap = {};
  
  // Convert current node
  let craftNode: CraftNode;
  
  if (node.type === 'TEXT') {
    craftNode = convertTextNode(node as FigmaTextNode, parentId);
  } else if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION') {
    craftNode = convertFrameNode(node as FigmaFrameNode, parentId, warnings);
  } else if (node.type === 'RECTANGLE') {
    craftNode = convertRectangleNode(node as FigmaRectangleNode, parentId, warnings);
  } else {
    craftNode = convertGenericNode(node, parentId, warnings);
  }
  
  nodes[craftNode.id] = craftNode;
  
  // Convert children
  if ('children' in node && Array.isArray(node.children)) {
    const childIds: string[] = [];
    
    for (const child of node.children) {
      const childNodes = convertNodeTree(child, craftNode.id, warnings);
      Object.assign(nodes, childNodes);
      
      // Get the root child ID
      const childRootId = generateNodeId(child.id);
      childIds.push(childRootId);
    }
    
    craftNode.children = childIds;
  }
  
  return nodes;
}

/**
 * Convert Figma node to Craft.js serialized format
 * 
 * @param figmaNode - Root Figma node to convert
 * @param options - Conversion options
 * @returns Craft.js serialized node map
 */
export function convertFigmaToCraft(
  figmaNode: FigmaNode,
  options?: {
    fileKey?: string;
    fileName?: string;
  }
): ConversionResult {
  const warnings: string[] = [];
  const nodes = convertNodeTree(figmaNode, undefined, warnings);
  
  // Find root node ID
  const rootId = generateNodeId(figmaNode.id);
  
  return {
    nodes,
    rootId,
    warnings,
    metadata: {
      source: 'figma',
      fileKey: options?.fileKey,
      fileName: options?.fileName,
      convertedAt: Date.now(),
      nodeCount: Object.keys(nodes).length,
    },
  };
}

/**
 * Convert multiple Figma nodes to Craft.js format
 */
export function convertFigmaNodesToCraft(
  nodes: FigmaNode[],
  options?: {
    fileKey?: string;
    fileName?: string;
  }
): ConversionResult {
  const warnings: string[] = [];
  const allNodes: CraftNodesMap = {};
  
  // Create a wrapper frame to hold all imported nodes
  const wrapperId = `wrapper_${Date.now()}`;
  const wrapperNode: CraftNode = {
    id: wrapperId,
    type: 'Container',
    isCanvas: true,
    props: {
      className: 'flex flex-col gap-4 p-4',
    },
    parent: undefined,
    children: [],
    name: 'Figma Import',
    displayName: 'Figma Import',
  };
  
  allNodes[wrapperId] = wrapperNode;
  
  // Convert each node
  for (const node of nodes) {
    const childNodes = convertNodeTree(node, wrapperId, warnings);
    Object.assign(allNodes, childNodes);
    
    const childRootId = generateNodeId(node.id);
    wrapperNode.children.push(childRootId);
  }
  
  return {
    nodes: allNodes,
    rootId: wrapperId,
    warnings,
    metadata: {
      source: 'figma',
      fileKey: options?.fileKey,
      fileName: options?.fileName,
      convertedAt: Date.now(),
      nodeCount: Object.keys(allNodes).length,
    },
  };
}

/**
 * Parse Craft.js JSON and load into visual editor
 */
export function loadCraftJson(jsonString: string): ConversionResult | null {
  try {
    const parsed = JSON.parse(jsonString);
    return parsed as ConversionResult;
  } catch (error) {
    console.error('[Figma Converter] Failed to parse Craft JSON:', error);
    return null;
  }
}

/**
 * Serialize Craft.js nodes to JSON string
 */
export function serializeCraftJson(result: ConversionResult): string {
  return JSON.stringify(result, null, 2);
}
