/**
 * Figma API TypeScript Types
 * 
 * @see https://www.figma.com/developers/api
 */

// ============================================================================
// Basic Types
// ============================================================================

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaTransform {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface FigmaRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaBinding {
  type: string;
  value: string;
}

// ============================================================================
// Paint Types
// ============================================================================

export type FigmaPaintType = 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE' | 'EMOJI';

export interface FigmaPaint {
  type: FigmaPaintType;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientHandlePositions?: FigmaTransform[];
  gradientStops?: Array<{
    position: number;
    color: FigmaColor;
  }>;
  imageHash?: string;
  scaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH';
}

// ============================================================================
// Style Types
// ============================================================================

export interface FigmaStyle {
  key: string;
  name: string;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  description?: string;
  remote?: boolean;
}

// ============================================================================
// Node Types
// ============================================================================

export type FigmaNodeType = 
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'VECTOR'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'LINE'
  | 'ELLIPSE'
  | 'STAR'
  | 'POLYGON'
  | 'TEXT'
  | 'SLICE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'SECTION'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'STAMP'
  | 'TABLE'
  | 'TABLE_ROW'
  | 'TABLE_CELL';

export interface FigmaNode {
  id: string;
  name: string;
  type: FigmaNodeType;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeMiterLimit?: number;
  strokeAlign?: 'CENTER' | 'INSIDE' | 'OUTSIDE';
  strokeCap?: 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL';
  strokeJoin?: 'MITER' | 'BEVEL' | 'ROUND';
  dashPattern?: number[];
  fillingGeometry?: string;
  exportedKeyframes?: string;
  constraints?: {
    vertical: 'TOP' | 'BOTTOM' | 'CENTER' | 'STRETCH' | 'SCALE';
    horizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'STRETCH' | 'SCALE';
  };
  absoluteBoundingBox?: FigmaRectangle;
  size?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  relativeTransform?: FigmaTransform;
  background?: FigmaPaint[];
  backgroundColor?: FigmaColor;
  prototype?: {
    destinationKey?: string;
    navigation?: {
      type: 'NAVIGATE' | 'SWAP' | 'CURRENT' | 'BACK' | 'OVERLAY';
      transition?: {
        type: 'INSTANT' | 'DISSOLVE' | 'SLIDE_IN' | 'SLIDE_OUT' | 'PUSH' | 'MOVE_IN' | 'MOVE_OUT' | 'FADE' | 'SMART_ANIMATE' | 'SCROLL_ANIMATE';
        duration?: number;
        easing?: {
          type: 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_AND_OUT' | 'LINEAR';
        };
      };
    };
  };
  flowStartingPoints?: Array<{
    nodeId: string;
    name: string;
  }>;
  componentId?: string;
  componentSetId?: string;
  styles?: Record<string, string>;
  layoutGrids?: Array<{
    id: string;
    visible?: boolean;
    type: 'GRID' | 'COLUMNS' | 'ROWS';
    pattern?: {
      width?: number;
      height?: number;
      gutter?: number;
      alignment?: string;
      count?: number;
      sectionSize?: number;
    };
    color?: FigmaColor;
  }>;
  gridStyleId?: string;
  clipsContent?: boolean;
  backgroundFilters?: any[];
  effects?: Array<{
    type: 'INNER_SHADOW' | 'DROP_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
    visible?: boolean;
    radius?: number;
    color?: FigmaColor;
    blendMode?: string;
    offset?: { x: number; y: number };
    spread?: number;
  }>;
  exportSettings?: Array<{
    suffix?: string;
    format: 'JPG' | 'PNG' | 'SVG' | 'PDF';
    constraint?: {
      type: 'SCALE' | 'WIDTH' | 'HEIGHT';
      value: number;
    };
  }>;
}

// Frame-specific properties
export interface FigmaFrameNode extends FigmaNode {
  type: 'FRAME' | 'GROUP' | 'SECTION';
  background?: FigmaPaint[];
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutGrids?: any[];
  clipsContent?: boolean;
  guides?: any[];
  children?: FigmaNode[];
}

// Text-specific properties
export interface FigmaTextNode extends FigmaNode {
  type: 'TEXT';
  characters: string;
  style: {
    fontFamily?: string;
    fontPostScriptName?: string;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
    textAlignVertical?: 'TOP' | 'BOTTOM' | 'CENTER';
    letterSpacing?: number;
    lineHeight?: {
      unit: 'PIXELS' | 'PERCENT' | 'INTRINSIC_%';
      value?: number;
    };
    paragraphIndent?: number;
    paragraphSpacing?: number;
    listSpacing?: number;
    textDecoration?: string;
    textCase?: string;
    fontStyle?: string;
  };
  textData?: {
    ranges: Array<{
      start: number;
      end: number;
      format: {
        fontFamily?: string;
        fontWeight?: number;
        fontSize?: number;
        // ... other format properties
      };
    }>;
  };
  children?: FigmaNode[];
}

// Rectangle-specific properties
export interface FigmaRectangleNode extends FigmaNode {
  type: 'RECTANGLE';
  cornerRadius?: number | number[]; // Can be single value or [topLeft, topRight, bottomRight, bottomLeft]
  cornerSmoothing?: number;
  rectangleCornerRadii?: [number, number, number, number];
  children?: FigmaNode[];
}

// Component properties
export interface FigmaComponentNode extends FigmaNode {
  type: 'COMPONENT';
  componentId: string;
  children?: FigmaNode[];
}

export interface FigmaComponentSetNode extends FigmaNode {
  type: 'COMPONENT_SET';
  componentSetId: string;
  children?: FigmaNode[];
}

export interface FigmaInstanceNode extends FigmaNode {
  type: 'INSTANCE';
  componentId: string;
  children?: FigmaNode[];
}

// ============================================================================
// File Response Types
// ============================================================================

export interface FigmaFileResponse {
  status: number;
  error?: string[];
  meta?: {
    remote?: boolean;
    name: string;
    key: string;
    lastModified: string;
    thumbnailUrl: string | null;
    editorType: 'figma' | 'figjam';
    version?: string;
    linkAccess: 'inherit' | 'anyone_with_link' | 'organization_users' | 'team_users';
    contentGeneratedByAi?: boolean;
  };
  document: FigmaFrameNode;
}

export interface FigmaFilesResponse {
  status: number;
  error?: string[];
  meta: {
    files: Array<{
      key: string;
      name: string;
      thumbnailUrl: string | null;
      lastModified: string;
      accessedAt?: string;
    }>;
  };
}

export interface FigmaComponentsResponse {
  status: number;
  error?: string[];
  meta: {
    components: Array<{
      key: string;
      name: string;
      description?: string;
      componentSetId?: string;
      nodeId?: string;
      createdAt?: string;
      updatedAt?: string;
      remote?: boolean;
    }>;
  };
}

export interface FigmaComponentSetResponse {
  status: number;
  error?: string[];
  meta: {
    componentSets: Array<{
      key: string;
      name: string;
      description?: string;
      nodeId?: string;
      createdAt?: string;
      updatedAt?: string;
      remote?: boolean;
    }>;
  };
}

export interface FigmaStylesResponse {
  status: number;
  error?: string[];
  meta: {
    styles: Record<string, FigmaStyle>;
  };
}

// ============================================================================
// Image Export Types
// ============================================================================

export interface FigmaImageRequest {
  ids: string; // Comma-separated node IDs
  scale?: number;
  format?: 'png' | 'jpg' | 'svg' | 'pdf';
  svg_outline_text?: boolean;
  svg_include_id?: boolean;
  constraint?: {
    type: 'SCALE' | 'WIDTH' | 'HEIGHT';
    value: number;
  };
  only_visible?: boolean;
  use_absolute_bounds?: boolean;
}

export interface FigmaImageResponse {
  status: number;
  error?: string[];
  images: Record<string, string>; // nodeId -> imageUrl
}

export interface FigmaImageFillRequest {
  ids: string; // Comma-separated node IDs
  use_absolute_bounds?: boolean;
  only_visible?: boolean;
}

export interface FigmaImageFillResponse {
  status: number;
  error?: string[];
  image_fills: Record<string, string>; // nodeId -> imageHash
}

// ============================================================================
// Comment Types
// ============================================================================

export interface FigmaComment {
  id: string;
  file_key: string;
  parent_id: string | null;
  user: {
    handle: string;
    img_url: string | null;
    id: string;
  };
  created_at: string;
  message: string | null;
  resolved: boolean;
  reactions: Array<{
    reaction: string;
    user: {
      handle: string;
      img_url: string | null;
      id: string;
    };
    created_at: string;
  }>;
}

export interface FigmaCommentsResponse {
  status: number;
  error?: string[];
  comments: FigmaComment[];
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface FigmaWebhook {
  id: string;
  team_id: string;
  endpoint: string;
  passcode: string;
  event_type: string;
  status: string;
  created_at: string;
  filters?: {
    file_key?: string;
  };
}

export interface FigmaWebhooksResponse {
  status: number;
  error?: string[];
  webhooks: FigmaWebhook[];
}

// ============================================================================
// Type Guards
// ============================================================================

export function isFrameNode(node: FigmaNode): node is FigmaFrameNode {
  return node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION';
}

export function isTextNode(node: FigmaNode): node is FigmaTextNode {
  return node.type === 'TEXT';
}

export function isRectangleNode(node: FigmaNode): node is FigmaRectangleNode {
  return node.type === 'RECTANGLE';
}

export function isComponentNode(node: FigmaNode): node is FigmaComponentNode {
  return node.type === 'COMPONENT';
}

export function isComponentSetNode(node: FigmaNode): node is FigmaComponentSetNode {
  return node.type === 'COMPONENT_SET';
}

export function isInstanceNode(node: FigmaNode): node is FigmaInstanceNode {
  return node.type === 'INSTANCE';
}

export function hasChildren(node: FigmaNode): node is FigmaFrameNode {
  return 'children' in node && Array.isArray(node.children);
}
