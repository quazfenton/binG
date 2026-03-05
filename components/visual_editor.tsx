"use client";

/**
 * components/visual_editor.tsx
 *
 * Full Craft.js visual editor with:
 * - Real Craft.js canvas (drag/drop, resize, select, undo/redo built-in)
 * - 15+ editable craft components (Container, Text, Button, Image, Input, Card, Badge, Divider, Icon, Hero, NavBar, Grid, Form, Video, Code)
 * - Live CSS inspector panel (all box-model, typography, background, border, effects)
 * - Component template library sourced from community patterns
 * - Craft.js nodes → JSX string export (writes back to project files)
 * - Split mode: visual canvas + live code editor side by side
 * - Layers panel (Craft.js built-in Tree)
 * - Viewport switcher (desktop / tablet / mobile)
 * - Full keyboard shortcuts
 * - VFS handoff on save
 *
 * CLI COMPONENT INSTALLER (NEW):
 * - Install real UI components from HeroUI, shadcn/ui, Magic UI, Aceternity UI, DaisyUI, Radix UI
 * - Variant-aware component selection (e.g., button variants: outline, ghost, solid, etc.)
 * - Live terminal with streaming output from npx CLI commands
 * - Queue multiple components for batch installation
 * - Progress tracking and abort capability
 *
 * KNOWN LIMITATIONS:
 * - Craft.js Resolver Gap: CLI-installed components (HeroUI, shadcn, etc.) are installed into
 *   project files but NOT available in the Craft.js drag-and-drop palette. The Craft resolver
 *   only contains built-in craft components. Use CLI installer to add dependencies, then use
 *   Craft components for visual prototyping. Exported JSX will reference installed components.
 * - JSX Parser: Only handles basic inline styles. Tailwind classes, CSS modules, and styled-components
 *   are not parsed into editable Craft props.
 * - Component Mapping: Incoming code from Sandpack may use custom/third-party components not in
 *   the resolver. These will render as generic containers.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";

// ─── Craft.js ────────────────────────────────────────────────────────────────
import { Editor, Frame, Element, useEditor, useNode } from "@craftjs/core";
import { Layers } from "@craftjs/layers";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  MousePointer,
  Move,
  Type,
  Square,
  Image as ImageIcon,
  Layout,
  Code,
  Eye,
  EyeOff,
  Save,
  Undo2,
  Redo2,
  X,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  Layers as LayersIcon,
  Settings,
  Palette,
  Zap,
  Search,
  Monitor,
  Tablet,
  Smartphone,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Link,
  Grid,
  Package,
  FileCode,
  Play,
  RefreshCw,
  Download,
  Upload,
  Maximize2,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Info,
  Grip,
  PanelLeft,
  PanelRight,
} from "lucide-react";

import type { VFSProject } from "../app/visual-editor/page";

// ─────────────────────────────────────────────────────────────────────────────
// CRAFT COMPONENT PROPS & TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CraftStyleProps {
  // Layout
  display?: string;
  flexDirection?: string;
  flexWrap?: string;
  alignItems?: string;
  justifyContent?: string;
  gap?: string;
  gridTemplateColumns?: string;
  // Spacing
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  // Size
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  // Typography
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  textAlign?: string;
  lineHeight?: string;
  letterSpacing?: string;
  color?: string;
  // Background
  background?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  // Border
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderColor?: string;
  borderWidth?: string;
  borderStyle?: string;
  borderRadius?: string;
  // Effects
  boxShadow?: string;
  opacity?: string;
  overflow?: string;
  cursor?: string;
  transition?: string;
  transform?: string;
  filter?: string;
  backdropFilter?: string;
  // Position
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: generate inline style object from CraftStyleProps
// ─────────────────────────────────────────────────────────────────────────────

function toStyle(s: CraftStyleProps): React.CSSProperties {
  return s as React.CSSProperties;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRAFT SELECTION WRAPPER — adds blue ring + drag handle when selected
// ─────────────────────────────────────────────────────────────────────────────

function SelectionWrapper({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const {
    connectors: { connect, drag },
    selected,
    hovered,
  } = useNode((node) => ({
    selected: node.events.selected,
    hovered: node.events.hovered,
  }));

  return (
    <div
      ref={(ref) => {
        if (ref) connect(drag(ref));
      }}
      className={[
        "relative craft-node",
        selected ? "ring-2 ring-[#3b82f6] ring-offset-1 ring-offset-transparent" : "",
        hovered && !selected ? "ring-1 ring-[#3b82f6]/50" : "",
      ].join(" ")}
      style={{ minHeight: 2, cursor: "default" }}
    >
      {(selected || hovered) && (
        <div className="absolute -top-5 left-0 z-50 bg-[#3b82f6] text-white text-[9px] font-mono px-1.5 py-0.5 rounded-sm pointer-events-none whitespace-nowrap">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── CRAFT COMPONENTS ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// ── ContainerCraft ────────────────────────────────────────────────────────────

interface ContainerProps {
  styles?: CraftStyleProps;
  children?: React.ReactNode;
  className?: string;
}

export function ContainerCraft({ styles = {}, children, className = "" }: ContainerProps) {
  return (
    <SelectionWrapper label="Container">
      <div
        className={className}
        style={{
          minHeight: 48,
          ...toStyle(styles),
        }}
      >
        {children}
      </div>
    </SelectionWrapper>
  );
}
ContainerCraft.craft = {
  displayName: "Container",
  props: {
    styles: {
      display: "flex",
      flexDirection: "column",
      padding: "16px",
      gap: "8px",
    },
  },
  rules: { canDrop: () => true },
};

// ── TextCraft ─────────────────────────────────────────────────────────────────

interface TextProps {
  text?: string;
  tag?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "label" | "code" | "blockquote";
  styles?: CraftStyleProps;
}

export function TextCraft({ text = "Edit this text", tag = "p", styles = {} }: TextProps) {
  const Tag = tag;
  return (
    <SelectionWrapper label={`Text / ${tag}`}>
      <Tag style={toStyle(styles)} suppressContentEditableWarning>
        {text}
      </Tag>
    </SelectionWrapper>
  );
}
TextCraft.craft = {
  displayName: "Text",
  props: { text: "Edit this text", tag: "p", styles: { color: "#e6edf3", fontSize: "16px" } },
};

// ── ButtonCraft ───────────────────────────────────────────────────────────────

interface ButtonProps {
  label?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "gradient";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  styles?: CraftStyleProps;
  href?: string;
  disabled?: boolean;
  fullWidth?: boolean;
}

const BTN_VARIANTS: Record<string, React.CSSProperties> = {
  primary: { background: "#3b82f6", color: "#fff", border: "none" },
  secondary: { background: "#21262d", color: "#e6edf3", border: "1px solid #30363d" },
  outline: { background: "transparent", color: "#3b82f6", border: "2px solid #3b82f6" },
  ghost: { background: "transparent", color: "#8b949e", border: "none" },
  destructive: { background: "#ef4444", color: "#fff", border: "none" },
  gradient: {
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    color: "#fff",
    border: "none",
  },
};

const BTN_SIZES: Record<string, React.CSSProperties> = {
  xs: { padding: "2px 8px", fontSize: "11px", borderRadius: "4px" },
  sm: { padding: "4px 12px", fontSize: "13px", borderRadius: "6px" },
  md: { padding: "8px 18px", fontSize: "14px", borderRadius: "8px" },
  lg: { padding: "12px 24px", fontSize: "16px", borderRadius: "10px" },
  xl: { padding: "16px 32px", fontSize: "18px", borderRadius: "12px" },
};

export function ButtonCraft({
  label = "Button",
  variant = "primary",
  size = "md",
  styles = {},
  href,
  disabled = false,
  fullWidth = false,
}: ButtonProps) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    width: fullWidth ? "100%" : "auto",
    transition: "all 0.15s",
    ...BTN_VARIANTS[variant],
    ...BTN_SIZES[size],
    ...toStyle(styles),
  };

  return (
    <SelectionWrapper label={`Button / ${variant}`}>
      <button style={base} disabled={disabled}>
        {label}
      </button>
    </SelectionWrapper>
  );
}
ButtonCraft.craft = {
  displayName: "Button",
  props: { label: "Click me", variant: "primary", size: "md", styles: {} },
};

// ── ImageCraft ────────────────────────────────────────────────────────────────

interface ImageCraftProps {
  src?: string;
  alt?: string;
  objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  styles?: CraftStyleProps;
}

export function ImageCraft({
  src = "https://picsum.photos/seed/craft/400/300",
  alt = "Image",
  objectFit = "cover",
  styles = {},
}: ImageCraftProps) {
  return (
    <SelectionWrapper label="Image">
      <img
        src={src}
        alt={alt}
        style={{
          display: "block",
          maxWidth: "100%",
          objectFit,
          ...toStyle(styles),
        }}
        draggable={false}
      />
    </SelectionWrapper>
  );
}
ImageCraft.craft = {
  displayName: "Image",
  props: {
    src: "https://picsum.photos/seed/craft/400/300",
    alt: "Image",
    objectFit: "cover",
    styles: { width: "100%", height: "200px", borderRadius: "8px" },
  },
};

// ── CardCraft ─────────────────────────────────────────────────────────────────

interface CardCraftProps {
  title?: string;
  subtitle?: string;
  variant?: "default" | "bordered" | "elevated" | "glass" | "gradient";
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

const CARD_VARIANTS: Record<string, React.CSSProperties> = {
  default: { background: "#161b22", border: "1px solid #30363d" },
  bordered: { background: "transparent", border: "2px solid #3b82f6" },
  elevated: {
    background: "#161b22",
    border: "1px solid #30363d",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  },
  glass: {
    background: "rgba(255,255,255,0.05)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  gradient: {
    background: "linear-gradient(135deg, #1e3a5f 0%, #1a1f2e 100%)",
    border: "1px solid #3b82f6/30",
  },
};

export function CardCraft({
  title = "Card Title",
  subtitle = "Card description goes here",
  variant = "default",
  styles = {},
  children,
}: CardCraftProps) {
  return (
    <SelectionWrapper label={`Card / ${variant}`}>
      <div
        style={{
          borderRadius: "12px",
          padding: "20px",
          overflow: "hidden",
          ...CARD_VARIANTS[variant],
          ...toStyle(styles),
        }}
      >
        {title && (
          <h3 style={{ margin: "0 0 6px", color: "#e6edf3", fontSize: "16px", fontWeight: 600 }}>
            {title}
          </h3>
        )}
        {subtitle && (
          <p style={{ margin: "0 0 12px", color: "#8b949e", fontSize: "13px" }}>{subtitle}</p>
        )}
        {children}
      </div>
    </SelectionWrapper>
  );
}
CardCraft.craft = {
  displayName: "Card",
  props: { title: "Card Title", subtitle: "Card description", variant: "default", styles: {} },
  rules: { canDrop: () => true },
};

// ── BadgeCraft ────────────────────────────────────────────────────────────────

interface BadgeCraftProps {
  label?: string;
  color?: "blue" | "green" | "red" | "yellow" | "purple" | "gray";
  styles?: CraftStyleProps;
}

const BADGE_COLORS: Record<string, React.CSSProperties> = {
  blue: { background: "#1d3a6b", color: "#60a5fa", border: "1px solid #3b82f6/40" },
  green: { background: "#14532d", color: "#4ade80", border: "1px solid #22c55e/40" },
  red: { background: "#7f1d1d", color: "#f87171", border: "1px solid #ef4444/40" },
  yellow: { background: "#713f12", color: "#facc15", border: "1px solid #eab308/40" },
  purple: { background: "#3b0764", color: "#c084fc", border: "1px solid #a855f7/40" },
  gray: { background: "#1f2937", color: "#9ca3af", border: "1px solid #374151" },
};

export function BadgeCraft({ label = "Badge", color = "blue", styles = {} }: BadgeCraftProps) {
  return (
    <SelectionWrapper label="Badge">
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          fontWeight: 600,
          ...BADGE_COLORS[color],
          ...toStyle(styles),
        }}
      >
        {label}
      </span>
    </SelectionWrapper>
  );
}
BadgeCraft.craft = {
  displayName: "Badge",
  props: { label: "New", color: "blue", styles: {} },
};

// ── DividerCraft ──────────────────────────────────────────────────────────────

interface DividerCraftProps {
  orientation?: "horizontal" | "vertical";
  label?: string;
  color?: string;
  styles?: CraftStyleProps;
}

export function DividerCraft({
  orientation = "horizontal",
  label,
  color = "#30363d",
  styles = {},
}: DividerCraftProps) {
  if (orientation === "vertical") {
    return (
      <SelectionWrapper label="Divider / vertical">
        <div
          style={{
            width: "1px",
            height: "100%",
            minHeight: "24px",
            background: color,
            ...toStyle(styles),
          }}
        />
      </SelectionWrapper>
    );
  }

  if (label) {
    return (
      <SelectionWrapper label="Divider / labeled">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            ...toStyle(styles),
          }}
        >
          <div style={{ flex: 1, height: "1px", background: color }} />
          <span style={{ color: "#8b949e", fontSize: "12px", whiteSpace: "nowrap" }}>{label}</span>
          <div style={{ flex: 1, height: "1px", background: color }} />
        </div>
      </SelectionWrapper>
    );
  }

  return (
    <SelectionWrapper label="Divider">
      <hr style={{ border: "none", borderTop: `1px solid ${color}`, margin: "8px 0", ...toStyle(styles) }} />
    </SelectionWrapper>
  );
}
DividerCraft.craft = {
  displayName: "Divider",
  props: { orientation: "horizontal", color: "#30363d", styles: {} },
};

// ── InputCraft ────────────────────────────────────────────────────────────────

interface InputCraftProps {
  placeholder?: string;
  inputType?: "text" | "email" | "password" | "number" | "search" | "url" | "tel";
  label?: string;
  hint?: string;
  variant?: "default" | "filled" | "outlined";
  styles?: CraftStyleProps;
}

export function InputCraft({
  placeholder = "Enter text…",
  inputType = "text",
  label,
  hint,
  variant = "default",
  styles = {},
}: InputCraftProps) {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "14px",
    color: "#e6edf3",
    outline: "none",
    ...( variant === "filled"
      ? { background: "#21262d", border: "1px solid transparent" }
      : variant === "outlined"
      ? { background: "transparent", border: "2px solid #3b82f6" }
      : { background: "#0d1117", border: "1px solid #30363d" }),
    ...toStyle(styles),
  };

  return (
    <SelectionWrapper label={`Input / ${inputType}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {label && (
          <label style={{ color: "#8b949e", fontSize: "13px", fontWeight: 500 }}>{label}</label>
        )}
        <input type={inputType} placeholder={placeholder} style={inputStyle} readOnly />
        {hint && <p style={{ color: "#6e7681", fontSize: "12px" }}>{hint}</p>}
      </div>
    </SelectionWrapper>
  );
}
InputCraft.craft = {
  displayName: "Input",
  props: { placeholder: "Enter text…", inputType: "text", variant: "default", styles: {} },
};

// ── HeroCraft ─────────────────────────────────────────────────────────────────

interface HeroCraftProps {
  headline?: string;
  subheadline?: string;
  ctaLabel?: string;
  variant?: "centered" | "split" | "minimal";
  backgroundGradient?: string;
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function HeroCraft({
  headline = "Build Something Amazing",
  subheadline = "A powerful platform to bring your ideas to life.",
  ctaLabel = "Get Started",
  variant = "centered",
  backgroundGradient = "linear-gradient(135deg, #0d1117 0%, #1a1f35 100%)",
  styles = {},
  children,
}: HeroCraftProps) {
  return (
    <SelectionWrapper label={`Hero / ${variant}`}>
      <section
        style={{
          background: backgroundGradient,
          padding: "80px 24px",
          textAlign: variant === "centered" ? "center" : "left",
          ...toStyle(styles),
        }}
      >
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 4rem)",
            fontWeight: 800,
            color: "#e6edf3",
            margin: "0 0 16px",
            lineHeight: 1.15,
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            fontSize: "1.125rem",
            color: "#8b949e",
            margin: "0 0 32px",
            maxWidth: "560px",
            ...(variant === "centered" ? { marginLeft: "auto", marginRight: "auto" } : {}),
          }}
        >
          {subheadline}
        </p>
        <button
          style={{
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            color: "#fff",
            padding: "14px 32px",
            borderRadius: "10px",
            fontSize: "16px",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
          }}
        >
          {ctaLabel}
        </button>
        {children}
      </section>
    </SelectionWrapper>
  );
}
HeroCraft.craft = {
  displayName: "Hero Section",
  props: {
    headline: "Build Something Amazing",
    subheadline: "A powerful platform to bring your ideas to life.",
    ctaLabel: "Get Started",
    variant: "centered",
    backgroundGradient: "linear-gradient(135deg, #0d1117 0%, #1a1f35 100%)",
    styles: {},
  },
  rules: { canDrop: () => true },
};

// ── NavBarCraft ───────────────────────────────────────────────────────────────

interface NavBarCraftProps {
  brand?: string;
  links?: string[];
  variant?: "transparent" | "solid" | "blurred";
  styles?: CraftStyleProps;
}

export function NavBarCraft({
  brand = "MyApp",
  links = ["Home", "Features", "Pricing", "Docs"],
  variant = "solid",
  styles = {},
}: NavBarCraftProps) {
  return (
    <SelectionWrapper label={`NavBar / ${variant}`}>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          ...( variant === "solid"
            ? { background: "#161b22", borderBottom: "1px solid #30363d" }
            : variant === "blurred"
            ? {
                background: "rgba(22,27,34,0.7)",
                backdropFilter: "blur(12px)",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }
            : { background: "transparent" }),
          ...toStyle(styles),
        }}
      >
        <span style={{ color: "#e6edf3", fontWeight: 700, fontSize: "18px" }}>{brand}</span>
        <div style={{ display: "flex", gap: "24px" }}>
          {links.map((l) => (
            <a key={l} href="#" style={{ color: "#8b949e", fontSize: "14px", textDecoration: "none" }}>
              {l}
            </a>
          ))}
        </div>
      </nav>
    </SelectionWrapper>
  );
}
NavBarCraft.craft = {
  displayName: "NavBar",
  props: {
    brand: "MyApp",
    links: ["Home", "Features", "Pricing", "Docs"],
    variant: "solid",
    styles: {},
  },
};

// ── GridCraft ─────────────────────────────────────────────────────────────────

interface GridCraftProps {
  columns?: number;
  gap?: string;
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function GridCraft({ columns = 3, gap = "16px", styles = {}, children }: GridCraftProps) {
  return (
    <SelectionWrapper label={`Grid / ${columns}col`}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap,
          ...toStyle(styles),
        }}
      >
        {children}
      </div>
    </SelectionWrapper>
  );
}
GridCraft.craft = {
  displayName: "Grid",
  props: { columns: 3, gap: "16px", styles: {} },
  rules: { canDrop: () => true },
};

// ── FormCraft ─────────────────────────────────────────────────────────────────

interface FormCraftProps {
  title?: string;
  submitLabel?: string;
  variant?: "card" | "minimal" | "inline";
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function FormCraft({
  title = "Contact Form",
  submitLabel = "Submit",
  variant = "card",
  styles = {},
  children,
}: FormCraftProps) {
  return (
    <SelectionWrapper label="Form">
      <form
        onSubmit={(e) => e.preventDefault()}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          ...(variant === "card"
            ? {
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: "12px",
                padding: "24px",
              }
            : {}),
          ...toStyle(styles),
        }}
      >
        {title && (
          <h3 style={{ margin: 0, color: "#e6edf3", fontSize: "18px", fontWeight: 600 }}>
            {title}
          </h3>
        )}
        {children}
        <button
          type="submit"
          style={{
            background: "#3b82f6",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "14px",
          }}
        >
          {submitLabel}
        </button>
      </form>
    </SelectionWrapper>
  );
}
FormCraft.craft = {
  displayName: "Form",
  props: { title: "Contact Form", submitLabel: "Submit", variant: "card", styles: {} },
  rules: { canDrop: () => true },
};

// ── CodeBlockCraft ────────────────────────────────────────────────────────────

interface CodeBlockCraftProps {
  code?: string;
  language?: string;
  showLineNumbers?: boolean;
  styles?: CraftStyleProps;
}

export function CodeBlockCraft({
  code = `// Hello World\nconsole.log("Hello, World!");`,
  language = "javascript",
  showLineNumbers = true,
  styles = {},
}: CodeBlockCraftProps) {
  const lines = code.split("\n");
  return (
    <SelectionWrapper label={`Code / ${language}`}>
      <pre
        style={{
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: "8px",
          padding: "16px",
          overflow: "auto",
          fontFamily: "'DM Mono', monospace",
          fontSize: "13px",
          lineHeight: 1.6,
          margin: 0,
          ...toStyle(styles),
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ display: "flex" }}>
            {showLineNumbers && (
              <span
                style={{
                  width: "2rem",
                  color: "#484f58",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
            )}
            <span style={{ color: "#e6edf3" }}>{line || " "}</span>
          </div>
        ))}
      </pre>
    </SelectionWrapper>
  );
}
CodeBlockCraft.craft = {
  displayName: "Code Block",
  props: {
    code: `// Hello World\nconsole.log("Hello, World!");`,
    language: "javascript",
    showLineNumbers: true,
    styles: {},
  },
};

// ── AlertCraft ────────────────────────────────────────────────────────────────

interface AlertCraftProps {
  message?: string;
  type?: "info" | "success" | "warning" | "error";
  title?: string;
  dismissible?: boolean;
  styles?: CraftStyleProps;
}

const ALERT_STYLES: Record<string, React.CSSProperties> = {
  info: { background: "#0c1f3e", border: "1px solid #1d4ed8", color: "#93c5fd" },
  success: { background: "#052e16", border: "1px solid #15803d", color: "#86efac" },
  warning: { background: "#2d1b00", border: "1px solid #b45309", color: "#fcd34d" },
  error: { background: "#2d0a0a", border: "1px solid #b91c1c", color: "#fca5a5" },
};

export function AlertCraft({
  message = "This is an alert message.",
  type = "info",
  title,
  styles = {},
}: AlertCraftProps) {
  return (
    <SelectionWrapper label={`Alert / ${type}`}>
      <div
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "flex-start",
          padding: "12px 16px",
          borderRadius: "8px",
          ...ALERT_STYLES[type],
          ...toStyle(styles),
        }}
      >
        <div style={{ marginTop: 2 }}>
          {type === "success" ? (
            <CheckCircle size={16} />
          ) : type === "error" ? (
            <AlertCircle size={16} />
          ) : (
            <Info size={16} />
          )}
        </div>
        <div>
          {title && <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: "14px" }}>{title}</p>}
          <p style={{ margin: 0, fontSize: "13px" }}>{message}</p>
        </div>
      </div>
    </SelectionWrapper>
  );
}
AlertCraft.craft = {
  displayName: "Alert",
  props: { message: "This is an alert message.", type: "info", styles: {} },
};

// ── StatCardCraft ─────────────────────────────────────────────────────────────

interface StatCardCraftProps {
  label?: string;
  value?: string;
  trend?: string;
  trendUp?: boolean;
  icon?: string;
  styles?: CraftStyleProps;
}

export function StatCardCraft({
  label = "Total Revenue",
  value = "$48,295",
  trend = "+12.5%",
  trendUp = true,
  styles = {},
}: StatCardCraftProps) {
  return (
    <SelectionWrapper label="Stat Card">
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: "12px",
          padding: "20px",
          ...toStyle(styles),
        }}
      >
        <p style={{ margin: "0 0 8px", color: "#8b949e", fontSize: "13px" }}>{label}</p>
        <p style={{ margin: "0 0 8px", color: "#e6edf3", fontSize: "28px", fontWeight: 700 }}>
          {value}
        </p>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: trendUp ? "#4ade80" : "#f87171",
          }}
        >
          {trend} vs last period
        </span>
      </div>
    </SelectionWrapper>
  );
}
StatCardCraft.craft = {
  displayName: "Stat Card",
  props: { label: "Total Revenue", value: "$48,295", trend: "+12.5%", trendUp: true, styles: {} },
};

// ── AvatarCraft ───────────────────────────────────────────────────────────────

interface AvatarCraftProps {
  src?: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showName?: boolean;
  showBadge?: boolean;
  styles?: CraftStyleProps;
}

const AVATAR_SIZES = { sm: 32, md: 40, lg: 56, xl: 80 };

export function AvatarCraft({
  src = "https://i.pravatar.cc/80",
  name = "Jane Doe",
  size = "md",
  showName = true,
  styles = {},
}: AvatarCraftProps) {
  const px = AVATAR_SIZES[size];
  return (
    <SelectionWrapper label="Avatar">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          ...toStyle(styles),
        }}
      >
        <img
          src={src}
          alt={name}
          width={px}
          height={px}
          style={{
            borderRadius: "50%",
            border: "2px solid #30363d",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
        {showName && (
          <span style={{ color: "#e6edf3", fontSize: "14px", fontWeight: 500 }}>{name}</span>
        )}
      </div>
    </SelectionWrapper>
  );
}
AvatarCraft.craft = {
  displayName: "Avatar",
  props: {
    src: "https://i.pravatar.cc/80",
    name: "Jane Doe",
    size: "md",
    showName: true,
    styles: {},
  },
};

// ── TableCraft ────────────────────────────────────────────────────────────────

interface TableCraftProps {
  headers?: string[];
  rows?: string[][];
  striped?: boolean;
  styles?: CraftStyleProps;
}

export function TableCraft({
  headers = ["Name", "Status", "Value"],
  rows = [
    ["Alpha Corp", "Active", "$12,400"],
    ["Beta Inc", "Pending", "$8,100"],
    ["Gamma LLC", "Inactive", "$3,500"],
  ],
  striped = true,
  styles = {},
}: TableCraftProps) {
  return (
    <SelectionWrapper label="Table">
      <div
        style={{
          overflowX: "auto",
          borderRadius: "8px",
          border: "1px solid #30363d",
          ...toStyle(styles),
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "14px",
            color: "#e6edf3",
          }}
        >
          <thead>
            <tr style={{ background: "#21262d" }}>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    color: "#8b949e",
                    fontWeight: 600,
                    fontSize: "12px",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    borderBottom: "1px solid #30363d",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: striped && ri % 2 === 1 ? "#0d1117" : "transparent",
                  borderBottom: "1px solid #21262d",
                }}
              >
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding: "10px 14px" }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SelectionWrapper>
  );
}
TableCraft.craft = {
  displayName: "Table",
  props: {
    headers: ["Name", "Status", "Value"],
    rows: [
      ["Alpha Corp", "Active", "$12,400"],
      ["Beta Inc", "Pending", "$8,100"],
    ],
    striped: true,
    styles: {},
  },
};

// ── BentoGridCraft ─────────────────────────────────────────────────────────────

interface BentoGridCraftProps {
  columns?: number;
  items?: { title: string; description: string; icon: string }[];
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function BentoGridCraft({ columns = 3, items = [], styles = {}, children }: BentoGridCraftProps) {
  const defaultItems = items.length > 0 ? items : [
    { title: "Analytics", description: "Real-time insights", icon: "📊" },
    { title: "Automation", description: "Save time", icon: "⚡" },
    { title: "Security", description: "Enterprise-grade", icon: "🔒" },
    { title: "Integration", description: "Connect anything", icon: "🔗" },
  ];
  
  return (
    <SelectionWrapper label="Bento Grid">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: "16px",
          padding: "24px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: "16px",
          ...toStyle(styles),
        }}
      >
        {defaultItems.map((item, i) => (
          <div
            key={i}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "24px" }}>{item.icon}</span>
            <span style={{ color: "#f8fafc", fontWeight: 600, fontSize: "14px" }}>{item.title}</span>
            <span style={{ color: "#94a3b8", fontSize: "12px" }}>{item.description}</span>
          </div>
        ))}
        {children}
      </div>
    </SelectionWrapper>
  );
}
BentoGridCraft.craft = {
  displayName: "Bento Grid",
  props: { columns: 3, items: [], styles: {} },
  rules: { canDrop: () => true },
};

// ── SpotlightCardCraft ─────────────────────────────────────────────────────────

interface SpotlightCardCraftProps {
  title?: string;
  description?: string;
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function SpotlightCardCraft({ title = "Spotlight Feature", description = "Highlight your key feature with this spotlight card.", styles = {}, children }: SpotlightCardCraftProps) {
  return (
    <SelectionWrapper label="Spotlight Card">
      <div
        style={{
          position: "relative",
          padding: "32px",
          borderRadius: "16px",
          background: "#0f172a",
          overflow: "hidden",
          ...toStyle(styles),
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-50%",
            left: "-50%",
            width: "200%",
            height: "200%",
            background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 50%)",
            animation: "pulse 4s ease-in-out infinite",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <h3 style={{ margin: "0 0 8px", color: "#f8fafc", fontSize: "20px", fontWeight: 700 }}>{title}</h3>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>{description}</p>
        </div>
        {children}
      </div>
    </SelectionWrapper>
  );
}
SpotlightCardCraft.craft = {
  displayName: "Spotlight Card",
  props: { title: "Spotlight Feature", description: "Highlight your key feature", styles: {} },
};

// ── ShinyButtonCraft ───────────────────────────────────────────────────────────

interface ShinyButtonCraftProps {
  label?: string;
  styles?: CraftStyleProps;
}

export function ShinyButtonCraft({ label = "Shiny Button", styles = {} }: ShinyButtonCraftProps) {
  return (
    <SelectionWrapper label="Shiny Button">
      <button
        style={{
          position: "relative",
          padding: "12px 24px",
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          fontSize: "14px",
          fontWeight: 600,
          cursor: "pointer",
          overflow: "hidden",
          ...toStyle(styles),
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 0,
            left: "-100%",
            width: "100%",
            height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
            animation: "shiny 3s infinite",
          }}
        />
        {label}
      </button>
    </SelectionWrapper>
  );
}
ShinyButtonCraft.craft = {
  displayName: "Shiny Button",
  props: { label: "Shiny Button", styles: {} },
};

// ── GradientTextCraft ────────────────────────────────────────────────────────

interface GradientTextCraftProps {
  text?: string;
  styles?: CraftStyleProps;
}

export function GradientTextCraft({ text = "Gradient Text", styles = {} }: GradientTextCraftProps) {
  return (
    <SelectionWrapper label="Gradient Text">
      <span
        style={{
          background: "linear-gradient(135deg, #f472b6 0%, #a855f7 50%, #3b82f6 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          fontSize: "32px",
          fontWeight: 800,
          ...toStyle(styles),
        }}
      >
        {text}
      </span>
    </SelectionWrapper>
  );
}
GradientTextCraft.craft = {
  displayName: "Gradient Text",
  props: { text: "Gradient Text", styles: {} },
};

// ── BackgroundBeamsCraft ────────────────────────────────────────────────────

interface BackgroundBeamsCraftProps {
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function BackgroundBeamsCraft({ styles = {}, children }: BackgroundBeamsCraftProps) {
  return (
    <SelectionWrapper label="Background Beams">
      <div
        style={{
          position: "relative",
          minHeight: "300px",
          background: "#000",
          overflow: "hidden",
          borderRadius: "12px",
          ...toStyle(styles),
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 0%, rgba(59,130,246,0.3), transparent 60%)" }} />
        <div style={{ position: "relative", zIndex: 1, padding: "40px" }}>
          {children || <h2 style={{ color: "#fff", margin: 0 }}>Hero Section with Beams</h2>}
        </div>
      </div>
    </SelectionWrapper>
  );
}
BackgroundBeamsCraft.craft = {
  displayName: "Background Beams",
  props: { styles: {} },
  rules: { canDrop: () => true },
};

// ── PricingCardCraft ─────────────────────────────────────────────────────────

interface PricingCardCraftProps {
  title?: string;
  price?: string;
  period?: string;
  features?: string[];
  highlighted?: boolean;
  styles?: CraftStyleProps;
}

export function PricingCardCraft({
  title = "Pro",
  price = "$29",
  period = "/month",
  features = ["All features", "Priority support", "Unlimited projects"],
  highlighted = false,
  styles = {},
}: PricingCardCraftProps) {
  return (
    <SelectionWrapper label="Pricing Card">
      <div
        style={{
          padding: "32px",
          borderRadius: "16px",
          background: highlighted ? "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)" : "#1e293b",
          border: highlighted ? "2px solid #8b5cf6" : "1px solid #334155",
          textAlign: "center",
          ...toStyle(styles),
        }}
      >
        <h3 style={{ margin: "0 0 16px", color: "#f8fafc", fontSize: "18px", fontWeight: 600 }}>{title}</h3>
        <div style={{ marginBottom: "24px" }}>
          <span style={{ color: "#f8fafc", fontSize: "48px", fontWeight: 800 }}>{price}</span>
          <span style={{ color: "#94a3b8", fontSize: "14px" }}>{period}</span>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", textAlign: "left" }}>
          {features.map((f, i) => (
            <li key={i} style={{ color: "#cbd5e1", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#4ade80" }}>✓</span> {f}
            </li>
          ))}
        </ul>
        <button
          style={{
            width: "100%",
            padding: "12px",
            background: highlighted ? "linear-gradient(135deg, #8b5cf6, #6366f1)" : "#334155",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Get Started
        </button>
      </div>
    </SelectionWrapper>
  );
}
PricingCardCraft.craft = {
  displayName: "Pricing Card",
  props: { title: "Pro", price: "$29", period: "/month", features: [], highlighted: false, styles: {} },
};

// ── TestimonialCardCraft ─────────────────────────────────────────────────────

interface TestimonialCardCraftProps {
  quote?: string;
  author?: string;
  role?: string;
  avatar?: string;
  styles?: CraftStyleProps;
}

export function TestimonialCardCraft({
  quote = "This product changed how I work. Absolutely amazing!",
  author = "Jane Smith",
  role = "CEO, TechCorp",
  avatar = "https://i.pravatar.cc/80?img=1",
  styles = {},
}: TestimonialCardCraftProps) {
  return (
    <SelectionWrapper label="Testimonial">
      <div
        style={{
          padding: "24px",
          background: "#1e293b",
          borderRadius: "12px",
          border: "1px solid #334155",
          ...toStyle(styles),
        }}
      >
        <p style={{ margin: "0 0 16px", color: "#cbd5e1", fontSize: "14px", fontStyle: "italic" }}>"{quote}"</p>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src={avatar} alt={author} style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
          <div>
            <p style={{ margin: 0, color: "#f8fafc", fontSize: "14px", fontWeight: 600 }}>{author}</p>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "12px" }}>{role}</p>
          </div>
        </div>
      </div>
    </SelectionWrapper>
  );
}
TestimonialCardCraft.craft = {
  displayName: "Testimonial",
  props: { quote: "Amazing product!", author: "Jane Smith", role: "CEO", avatar: "", styles: {} },
};

// ── FeatureListCraft ─────────────────────────────────────────────────────────

interface FeatureListCraftProps {
  features?: { title: string; description: string; icon: string }[];
  styles?: CraftStyleProps;
  children?: React.ReactNode;
}

export function FeatureListCraft({
  features = [],
  styles = {},
  children,
}: FeatureListCraftProps) {
  const defaultFeatures = features.length > 0 ? features : [
    { title: "Fast Performance", description: "Lightning fast load times", icon: "⚡" },
    { title: "Secure by Default", description: "Enterprise-grade security", icon: "🔒" },
    { title: "Easy Integration", description: "Connect with your stack", icon: "🔗" },
  ];
  
  return (
    <SelectionWrapper label="Feature List">
      <div style={{ padding: "24px", ...toStyle(styles) }}>
        {defaultFeatures.map((feature, i) => (
          <div key={i} style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
            <span style={{ fontSize: "24px" }}>{feature.icon}</span>
            <div>
              <h4 style={{ margin: "0 0 4px", color: "#f8fafc", fontSize: "16px", fontWeight: 600 }}>{feature.title}</h4>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>{feature.description}</p>
            </div>
          </div>
        ))}
        {children}
      </div>
    </SelectionWrapper>
  );
}
FeatureListCraft.craft = {
  displayName: "Feature List",
  props: { features: [], styles: {} },
  rules: { canDrop: () => true },
};

// ── MobileNavCraft ──────────────────────────────────────────────────────────

interface MobileNavCraftProps {
  title?: string;
  styles?: CraftStyleProps;
}

export function MobileNavCraft({ title = "App Title", styles = {} }: MobileNavCraftProps) {
  return (
    <SelectionWrapper label="Mobile Nav">
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "#000",
          borderBottom: "1px solid #333",
          ...toStyle(styles),
        }}
      >
        <span style={{ color: "#fff", fontWeight: 600 }}>{title}</span>
        <div style={{ display: "flex", gap: "16px" }}>
          <span style={{ color: "#666", fontSize: "20px" }}>🔍</span>
          <span style={{ color: "#666", fontSize: "20px" }}>⚙️</span>
        </div>
      </nav>
    </SelectionWrapper>
  );
}
MobileNavCraft.craft = {
  displayName: "Mobile Nav",
  props: { title: "App Title", styles: {} },
};

// ── BottomTabBarCraft ───────────────────────────────────────────────────────

interface BottomTabBarCraftProps {
  tabs?: string[];
  activeTab?: number;
  styles?: CraftStyleProps;
}

export function BottomTabBarCraft({ tabs = ["🏠", "🔍", "➕", "💬", "👤"], activeTab = 0, styles = {} }: BottomTabBarCraftProps) {
  return (
    <SelectionWrapper label="Bottom Tab Bar">
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          padding: "12px 16px",
          background: "#000",
          borderTop: "1px solid #333",
          ...toStyle(styles),
        }}
      >
        {tabs.map((tab, i) => (
          <span
            key={i}
            style={{
              fontSize: "20px",
              opacity: activeTab === i ? 1 : 0.5,
              cursor: "pointer",
            }}
          >
            {tab}
          </span>
        ))}
      </div>
    </SelectionWrapper>
  );
}
BottomTabBarCraft.craft = {
  displayName: "Bottom Tab Bar",
  props: { tabs: [], activeTab: 0, styles: {} },
};

// ── StatusBarCraft ───────────────────────────────────────────────────────────

interface StatusBarCraftProps {
  time?: string;
  battery?: number;
  styles?: CraftStyleProps;
}

export function StatusBarCraft({ time = "9:41", battery = 80, styles = {} }: StatusBarCraftProps) {
  return (
    <SelectionWrapper label="Status Bar">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          background: "#000",
          ...toStyle(styles),
        }}
      >
        <span style={{ color: "#fff", fontSize: "12px" }}>{time}</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ color: "#fff", fontSize: "12px" }}>📶</span>
          <span style={{ color: "#fff", fontSize: "12px" }}>🔋 {battery}%</span>
        </div>
      </div>
    </SelectionWrapper>
  );
}
StatusBarCraft.craft = {
  displayName: "Status Bar",
  props: { time: "9:41", battery: 80, styles: {} },
};

// ── AppHeaderCraft ───────────────────────────────────────────────────────────

interface AppHeaderCraftProps {
  title?: string;
  avatar?: string;
  styles?: CraftStyleProps;
}

export function AppHeaderCraft({ title = "Profile", avatar = "https://i.pravatar.cc/40", styles = {} }: AppHeaderCraftProps) {
  return (
    <SelectionWrapper label="App Header">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "16px",
          background: "#fff",
          borderBottom: "1px solid #eee",
          ...toStyle(styles),
        }}
      >
        <img src={avatar} alt="avatar" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
        <h2 style={{ margin: 0, color: "#000", fontSize: "18px", fontWeight: 600 }}>{title}</h2>
      </div>
    </SelectionWrapper>
  );
}
AppHeaderCraft.craft = {
  displayName: "App Header",
  props: { title: "Profile", avatar: "", styles: {} },
};

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVER MAP
// ─────────────────────────────────────────────────────────────────────────────

const RESOLVER = {
  ContainerCraft,
  TextCraft,
  ButtonCraft,
  ImageCraft,
  CardCraft,
  BadgeCraft,
  DividerCraft,
  InputCraft,
  HeroCraft,
  NavBarCraft,
  GridCraft,
  FormCraft,
  CodeBlockCraft,
  AlertCraft,
  StatCardCraft,
  AvatarCraft,
  TableCraft,
  BentoGridCraft,
  SpotlightCardCraft,
  ShinyButtonCraft,
  GradientTextCraft,
  BackgroundBeamsCraft,
  PricingCardCraft,
  TestimonialCardCraft,
  FeatureListCraft,
  MobileNavCraft,
  BottomTabBarCraft,
  StatusBarCraft,
  AppHeaderCraft,
};

// ─────────────────────────────────────────────────────────────────────────────
// CRAFT → JSX STRING SERIALISER
// ─────────────────────────────────────────────────────────────────────────────

function craftNodesToJSX(nodes: Record<string, any>): string {
  function renderNode(nodeId: string, depth = 1): string {
    const node = nodes[nodeId];
    if (!node) return "";
    const indent = "  ".repeat(depth);
    const { type, props, nodes: childIds = [], linkedNodes } = node;

    const name = typeof type === "string" ? type : type?.resolvedName ?? "div";

    const propsStr = Object.entries(props ?? {})
      .filter(([k]) => k !== "children")
      .map(([k, v]) => {
        if (typeof v === "string") return `${k}="${v}"`;
        if (typeof v === "boolean") return v ? k : `${k}={false}`;
        if (typeof v === "object") return `${k}={${JSON.stringify(v)}}`;
        if (typeof v === "number") return `${k}={${v}}`;
        return "";
      })
      .filter(Boolean)
      .join(" ");

    const allChildIds = [
      ...(childIds ?? []),
      ...Object.values(linkedNodes ?? {}).map(String),
    ];

    if (allChildIds.length === 0) {
      return `${indent}<${name}${propsStr ? " " + propsStr : ""} />`;
    }

    const children = allChildIds.map((cid) => renderNode(String(cid), depth + 1)).join("\n");
    return `${indent}<${name}${propsStr ? " " + propsStr : ""}>\n${children}\n${indent}</${name}>`;
  }

  const root = nodes["ROOT"];
  if (!root) return "";
  const rootChildren = (root.nodes ?? []).map((id: string) => renderNode(id)).join("\n");

  return `import React from "react";\n\nexport default function Page() {\n  return (\n    <div>\n${rootChildren}\n    </div>\n  );\n}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — per-node property editor driven by Craft's useEditor
// ─────────────────────────────────────────────────────────────────────────────

function SettingsPanel() {
  const { selected, actions } = useEditor((state) => {
    const [id] = state.events.selected;
    if (!id) return { selected: null };
    const node = state.nodes[id];
    return {
      selected: {
        id,
        name: node?.data?.type?.resolvedName ?? node?.data?.displayName ?? "Unknown",
        props: node?.data?.props ?? {},
      },
    };
  });

  const [activeTab, setActiveTab] = useState<"content" | "style" | "layout">("content");
  const [customCSS, setCustomCSS] = useState("");

  useEffect(() => {
    if (selected) {
      const s = selected.props?.styles ?? {};
      setCustomCSS(
        Object.entries(s)
          .map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`)
          .join("\n")
      );
    }
  }, [selected?.id]);

  if (!selected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#484f58] p-6">
        <Settings className="w-10 h-10 opacity-20" />
        <p className="text-xs text-center leading-relaxed">
          Click any element on the canvas to edit its properties here
        </p>
      </div>
    );
  }

  const setProp = (propKey: string, value: unknown) => {
    actions.setProp(selected.id, (props: Record<string, unknown>) => {
      props[propKey] = value;
    });
  };

  const setStyle = (cssKey: string, value: string) => {
    actions.setProp(selected.id, (props: Record<string, unknown>) => {
      const styles = (props.styles as Record<string, string>) ?? {};
      props.styles = { ...styles, [cssKey]: value };
    });
  };

  const applyCustomCSS = (raw: string) => {
    const parsed: Record<string, string> = {};
    raw.split(/[;\n]/).forEach((line) => {
      const idx = line.indexOf(":");
      if (idx < 0) return;
      const key = line
        .slice(0, idx)
        .trim()
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = line.slice(idx + 1).trim();
      if (key && val) parsed[key] = val;
    });
    actions.setProp(selected.id, (props: Record<string, unknown>) => {
      props.styles = parsed;
    });
  };

  const s: Record<string, string> = (selected.props?.styles as Record<string, string>) ?? {};
  const p = selected.props ?? {};

  const FONT_FAMILIES = [
    "inherit",
    "sans-serif",
    "serif",
    "monospace",
    "DM Mono, monospace",
    "Syne, sans-serif",
    "Georgia, serif",
    "system-ui",
  ];
  const FONT_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
  const DISPLAYS = ["block", "flex", "grid", "inline", "inline-flex", "inline-block", "none"];
  const POSITIONS = ["static", "relative", "absolute", "fixed", "sticky"];
  const FLEX_DIRS = ["row", "column", "row-reverse", "column-reverse"];
  const ALIGN_ITEMS_OPTS = ["flex-start", "center", "flex-end", "stretch", "baseline"];
  const JUSTIFY_CONTENT_OPTS = [
    "flex-start",
    "center",
    "flex-end",
    "space-between",
    "space-around",
    "space-evenly",
  ];
  const OVERFLOW_OPTS = ["visible", "hidden", "scroll", "auto"];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
          <span className="text-xs font-semibold text-white">{selected.name}</span>
        </div>
        <button
          onClick={() => actions.delete(selected.id)}
          className="w-6 h-6 flex items-center justify-center rounded text-[#484f58] hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#30363d]">
        {(["content", "style", "layout"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 py-2 text-xs capitalize transition-colors ${
              activeTab === t
                ? "text-white border-b-2 border-[#3b82f6]"
                : "text-[#8b949e] hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === "content" && (
          <>
            {/* Text content */}
            {"text" in p && (
              <PropGroup label="Text">
                <textarea
                  value={p.text as string}
                  onChange={(e) => setProp("text", e.target.value)}
                  rows={3}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded text-xs text-white p-2 resize-none focus:outline-none focus:border-[#3b82f6]"
                />
              </PropGroup>
            )}
            {"label" in p && (
              <PropGroup label="Label">
                <StringInput value={p.label as string} onChange={(v) => setProp("label", v)} />
              </PropGroup>
            )}
            {"src" in p && (
              <PropGroup label="Image URL">
                <StringInput value={p.src as string} onChange={(v) => setProp("src", v)} />
              </PropGroup>
            )}
            {"alt" in p && (
              <PropGroup label="Alt Text">
                <StringInput value={p.alt as string} onChange={(v) => setProp("alt", v)} />
              </PropGroup>
            )}
            {"headline" in p && (
              <>
                <PropGroup label="Headline">
                  <StringInput value={p.headline as string} onChange={(v) => setProp("headline", v)} />
                </PropGroup>
                <PropGroup label="Subheadline">
                  <StringInput
                    value={p.subheadline as string}
                    onChange={(v) => setProp("subheadline", v)}
                  />
                </PropGroup>
                <PropGroup label="CTA Label">
                  <StringInput value={p.ctaLabel as string} onChange={(v) => setProp("ctaLabel", v)} />
                </PropGroup>
              </>
            )}
            {"title" in p && !("headline" in p) && (
              <PropGroup label="Title">
                <StringInput value={p.title as string} onChange={(v) => setProp("title", v)} />
              </PropGroup>
            )}
            {"brand" in p && (
              <PropGroup label="Brand">
                <StringInput value={p.brand as string} onChange={(v) => setProp("brand", v)} />
              </PropGroup>
            )}
            {"value" in p && "label" in p && (
              <PropGroup label="Value">
                <StringInput value={p.value as string} onChange={(v) => setProp("value", v)} />
              </PropGroup>
            )}
            {"code" in p && (
              <PropGroup label="Code">
                <textarea
                  value={p.code as string}
                  onChange={(e) => setProp("code", e.target.value)}
                  rows={5}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded text-[11px] font-mono text-white p-2 resize-none focus:outline-none focus:border-[#3b82f6]"
                />
              </PropGroup>
            )}
            {"variant" in p && (
              <PropGroup label="Variant">
                <SelectInput
                  value={p.variant as string}
                  options={["primary","secondary","outline","ghost","destructive","gradient","default","bordered","elevated","glass","centered","split","minimal","solid","blurred","transparent","card","filled","outlined","info","success","warning","error"].filter(
                    (o, i, a) => a.indexOf(o) === i
                  )}
                  onChange={(v) => setProp("variant", v)}
                />
              </PropGroup>
            )}
            {"tag" in p && (
              <PropGroup label="HTML Tag">
                <SelectInput
                  value={p.tag as string}
                  options={["h1", "h2", "h3", "h4", "p", "span", "label", "code", "blockquote"]}
                  onChange={(v) => setProp("tag", v)}
                />
              </PropGroup>
            )}
            {"columns" in p && (
              <PropGroup label="Columns">
                <NumberInput value={p.columns as number} onChange={(v) => setProp("columns", v)} min={1} max={12} />
              </PropGroup>
            )}
          </>
        )}

        {activeTab === "style" && (
          <>
            <SectionTitle>Typography</SectionTitle>
            <PropGroup label="Font Size">
              <StringInput value={s.fontSize ?? ""} onChange={(v) => setStyle("fontSize", v)} placeholder="16px" />
            </PropGroup>
            <PropGroup label="Font Family">
              <SelectInput
                value={s.fontFamily ?? "inherit"}
                options={FONT_FAMILIES}
                onChange={(v) => setStyle("fontFamily", v)}
              />
            </PropGroup>
            <PropGroup label="Font Weight">
              <SelectInput
                value={s.fontWeight ?? "400"}
                options={FONT_WEIGHTS}
                onChange={(v) => setStyle("fontWeight", v)}
              />
            </PropGroup>
            <PropGroup label="Text Color">
              <ColorInput value={s.color ?? "#e6edf3"} onChange={(v) => setStyle("color", v)} />
            </PropGroup>
            <PropGroup label="Text Align">
              <div className="flex gap-1">
                {(["left", "center", "right", "justify"] as const).map((a) => {
                  const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : a === "right" ? AlignRight : AlignJustify;
                  return (
                    <button
                      key={a}
                      onClick={() => setStyle("textAlign", a)}
                      className={`flex-1 py-1 flex items-center justify-center rounded border ${
                        s.textAlign === a
                          ? "border-[#3b82f6] bg-[#1d3a6b] text-[#3b82f6]"
                          : "border-[#30363d] text-[#8b949e] hover:text-white"
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                    </button>
                  );
                })}
              </div>
            </PropGroup>
            <PropGroup label="Line Height">
              <StringInput value={s.lineHeight ?? ""} onChange={(v) => setStyle("lineHeight", v)} placeholder="1.5" />
            </PropGroup>
            <PropGroup label="Letter Spacing">
              <StringInput value={s.letterSpacing ?? ""} onChange={(v) => setStyle("letterSpacing", v)} placeholder="0.04em" />
            </PropGroup>

            <SectionTitle>Background</SectionTitle>
            <PropGroup label="Background">
              <StringInput value={s.background ?? s.backgroundColor ?? ""} onChange={(v) => setStyle("background", v)} placeholder="#161b22 or linear-gradient(…)" />
            </PropGroup>
            <PropGroup label="Bg Color">
              <ColorInput value={s.backgroundColor ?? "#161b22"} onChange={(v) => setStyle("backgroundColor", v)} />
            </PropGroup>

            <SectionTitle>Border</SectionTitle>
            <PropGroup label="Border">
              <StringInput value={s.border ?? ""} onChange={(v) => setStyle("border", v)} placeholder="1px solid #30363d" />
            </PropGroup>
            <PropGroup label="Border Radius">
              <StringInput value={s.borderRadius ?? ""} onChange={(v) => setStyle("borderRadius", v)} placeholder="8px" />
            </PropGroup>
            <PropGroup label="Border Color">
              <ColorInput value={s.borderColor ?? "#30363d"} onChange={(v) => setStyle("borderColor", v)} />
            </PropGroup>

            <SectionTitle>Effects</SectionTitle>
            <PropGroup label="Box Shadow">
              <StringInput value={s.boxShadow ?? ""} onChange={(v) => setStyle("boxShadow", v)} placeholder="0 4px 24px rgba(0,0,0,.4)" />
            </PropGroup>
            <PropGroup label="Opacity">
              <StringInput value={s.opacity ?? ""} onChange={(v) => setStyle("opacity", v)} placeholder="1" />
            </PropGroup>
            <PropGroup label="Transition">
              <StringInput value={s.transition ?? ""} onChange={(v) => setStyle("transition", v)} placeholder="all 0.2s" />
            </PropGroup>
            <PropGroup label="Transform">
              <StringInput value={s.transform ?? ""} onChange={(v) => setStyle("transform", v)} placeholder="rotate(5deg)" />
            </PropGroup>
            <PropGroup label="Filter">
              <StringInput value={s.filter ?? ""} onChange={(v) => setStyle("filter", v)} placeholder="blur(4px)" />
            </PropGroup>
            <PropGroup label="Backdrop Filter">
              <StringInput value={s.backdropFilter ?? ""} onChange={(v) => setStyle("backdropFilter", v)} placeholder="blur(12px)" />
            </PropGroup>

            <SectionTitle>Raw CSS</SectionTitle>
            <textarea
              value={customCSS}
              onChange={(e) => setCustomCSS(e.target.value)}
              onBlur={() => applyCustomCSS(customCSS)}
              rows={8}
              placeholder={"font-size: 16px;\ncolor: red;\npadding: 8px 16px;"}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded text-[11px] font-mono text-white p-2 resize-none focus:outline-none focus:border-[#3b82f6]"
            />
          </>
        )}

        {activeTab === "layout" && (
          <>
            <SectionTitle>Size</SectionTitle>
            <PropGroup label="Width">
              <StringInput value={s.width ?? ""} onChange={(v) => setStyle("width", v)} placeholder="100%" />
            </PropGroup>
            <PropGroup label="Height">
              <StringInput value={s.height ?? ""} onChange={(v) => setStyle("height", v)} placeholder="auto" />
            </PropGroup>
            <PropGroup label="Min W">
              <StringInput value={s.minWidth ?? ""} onChange={(v) => setStyle("minWidth", v)} placeholder="0" />
            </PropGroup>
            <PropGroup label="Max W">
              <StringInput value={s.maxWidth ?? ""} onChange={(v) => setStyle("maxWidth", v)} placeholder="100%" />
            </PropGroup>

            <SectionTitle>Spacing</SectionTitle>
            <PropGroup label="Padding">
              <StringInput value={s.padding ?? ""} onChange={(v) => setStyle("padding", v)} placeholder="16px" />
            </PropGroup>
            <PropGroup label="Margin">
              <StringInput value={s.margin ?? ""} onChange={(v) => setStyle("margin", v)} placeholder="0" />
            </PropGroup>
            <PropGroup label="Gap">
              <StringInput value={s.gap ?? ""} onChange={(v) => setStyle("gap", v)} placeholder="8px" />
            </PropGroup>

            <SectionTitle>Flexbox / Grid</SectionTitle>
            <PropGroup label="Display">
              <SelectInput value={s.display ?? "block"} options={DISPLAYS} onChange={(v) => setStyle("display", v)} />
            </PropGroup>
            <PropGroup label="Direction">
              <SelectInput value={s.flexDirection ?? "row"} options={FLEX_DIRS} onChange={(v) => setStyle("flexDirection", v)} />
            </PropGroup>
            <PropGroup label="Align">
              <SelectInput value={s.alignItems ?? "stretch"} options={ALIGN_ITEMS_OPTS} onChange={(v) => setStyle("alignItems", v)} />
            </PropGroup>
            <PropGroup label="Justify">
              <SelectInput value={s.justifyContent ?? "flex-start"} options={JUSTIFY_CONTENT_OPTS} onChange={(v) => setStyle("justifyContent", v)} />
            </PropGroup>
            <PropGroup label="Grid Cols">
              <StringInput value={s.gridTemplateColumns ?? ""} onChange={(v) => setStyle("gridTemplateColumns", v)} placeholder="repeat(3,1fr)" />
            </PropGroup>

            <SectionTitle>Position</SectionTitle>
            <PropGroup label="Position">
              <SelectInput value={s.position ?? "static"} options={POSITIONS} onChange={(v) => setStyle("position", v)} />
            </PropGroup>
            <div className="grid grid-cols-2 gap-1.5">
              {(["top", "right", "bottom", "left"] as const).map((d) => (
                <PropGroup key={d} label={d.charAt(0).toUpperCase() + d.slice(1)}>
                  <StringInput value={(s as any)[d] ?? ""} onChange={(v) => setStyle(d, v)} placeholder="auto" />
                </PropGroup>
              ))}
            </div>
            <PropGroup label="Z-Index">
              <StringInput value={s.zIndex ?? ""} onChange={(v) => setStyle("zIndex", v)} placeholder="0" />
            </PropGroup>
            <PropGroup label="Overflow">
              <SelectInput value={s.overflow ?? "visible"} options={OVERFLOW_OPTS} onChange={(v) => setStyle("overflow", v)} />
            </PropGroup>
            <PropGroup label="Cursor">
              <StringInput value={s.cursor ?? ""} onChange={(v) => setStyle("cursor", v)} placeholder="pointer" />
            </PropGroup>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL FORM HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <span className="text-[9px] uppercase tracking-widest text-[#484f58]">{children}</span>
      <div className="flex-1 h-px bg-[#21262d]" />
    </div>
  );
}

function PropGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-h-[22px]">
      <span className="text-[10px] text-[#484f58] w-14 flex-shrink-0 leading-none">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function StringInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1.5 focus:outline-none focus:border-[#3b82f6] placeholder-[#484f58]"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? 0}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1.5 focus:outline-none focus:border-[#3b82f6]"
    />
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1 focus:outline-none focus:border-[#3b82f6]"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const safeHex = /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#000000";
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={safeHex}
        onChange={(e) => onChange(e.target.value)}
        className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
      />
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1.5 focus:outline-none focus:border-[#3b82f6]"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI COMPONENT INSTALLER
// Full in-editor UI for `npx @heroui/cli add`, `npx shadcn@latest add`, etc.
// Calls /api/cli-install (SSE stream) to run commands server-side.
// ─────────────────────────────────────────────────────────────────────────────

// ── CLI adapter registry ────────────────────────────────────────────────────

interface CLIVariant {
  name: string;
  flag?: string;
  description?: string;
}

interface CLIComponent {
  name: string;
  description?: string;
  tags?: string[];
  variants?: CLIVariant[];
}

interface CLIAdapter {
  id: string;
  label: string;
  color: string;          // accent hex
  bgClass: string;        // tailwind bg for chip
  baseCmd: string;        // e.g. "@heroui/cli"
  subCmd: string;         // e.g. "add"
  nonInteractiveFlag?: string; // e.g. "--yes"
  components: CLIComponent[];
  docs?: string;
}

const CLI_ADAPTERS: CLIAdapter[] = [
  {
    id: "heroui",
    label: "HeroUI",
    color: "#7c3aed",
    bgClass: "bg-purple-900/40 border-purple-700/50 text-purple-300",
    baseCmd: "@heroui/cli",
    subCmd: "add",
    nonInteractiveFlag: "--yes",
    docs: "https://heroui.com/docs",
    components: [
      { name: "button", description: "Accessible button component", tags: ["interactive"], variants: [{ name: "default" }, { name: "outline", flag: "--variant outline" }, { name: "ghost", flag: "--variant ghost" }, { name: "solid", flag: "--variant solid" }, { name: "faded", flag: "--variant faded" }, { name: "shadow", flag: "--variant shadow" }, { name: "bordered", flag: "--variant bordered" }] },
      { name: "card", description: "Surface container card", tags: ["layout"] },
      { name: "input", description: "Text & form input", tags: ["form"], variants: [{ name: "flat" }, { name: "bordered" }, { name: "faded" }, { name: "underlined" }] },
      { name: "modal", description: "Dialog overlay", tags: ["overlay"] },
      { name: "navbar", description: "Top navigation bar", tags: ["navigation"] },
      { name: "table", description: "Data table with sorting", tags: ["data"] },
      { name: "select", description: "Dropdown select", tags: ["form"] },
      { name: "checkbox", description: "Checkbox input", tags: ["form"] },
      { name: "switch", description: "Toggle switch", tags: ["form"] },
      { name: "avatar", description: "User avatar", tags: ["display"] },
      { name: "badge", description: "Status badge", tags: ["display"] },
      { name: "chip", description: "Tag/chip element", tags: ["display"] },
      { name: "tooltip", description: "Hover tooltip", tags: ["overlay"] },
      { name: "dropdown", description: "Dropdown menu", tags: ["overlay"] },
      { name: "progress", description: "Progress bar", tags: ["display"] },
      { name: "spinner", description: "Loading spinner", tags: ["display"] },
      { name: "tabs", description: "Tab navigation", tags: ["navigation"] },
      { name: "accordion", description: "Expandable panels", tags: ["layout"] },
      { name: "slider", description: "Range slider", tags: ["form"] },
      { name: "pagination", description: "Page navigation", tags: ["navigation"] },
    ],
  },
  {
    id: "shadcn",
    label: "shadcn/ui",
    color: "#18181b",
    bgClass: "bg-zinc-800/60 border-zinc-600/50 text-zinc-300",
    baseCmd: "shadcn@latest",
    subCmd: "add",
    nonInteractiveFlag: "--yes",
    docs: "https://ui.shadcn.com/docs",
    components: [
      { name: "button", description: "Button variants", tags: ["interactive"] },
      { name: "card", description: "Card with header/content/footer", tags: ["layout"] },
      { name: "input", description: "Form input", tags: ["form"] },
      { name: "dialog", description: "Modal dialog", tags: ["overlay"] },
      { name: "sheet", description: "Side sheet/drawer", tags: ["overlay"] },
      { name: "dropdown-menu", description: "Dropdown menu", tags: ["overlay"] },
      { name: "navigation-menu", description: "Nav menu", tags: ["navigation"] },
      { name: "table", description: "Data table", tags: ["data"] },
      { name: "form", description: "React Hook Form wrapper", tags: ["form"] },
      { name: "select", description: "Select input", tags: ["form"] },
      { name: "checkbox", description: "Checkbox", tags: ["form"] },
      { name: "switch", description: "Toggle switch", tags: ["form"] },
      { name: "tabs", description: "Tab panels", tags: ["layout"] },
      { name: "accordion", description: "Collapsible sections", tags: ["layout"] },
      { name: "alert", description: "Alert messages", tags: ["display"] },
      { name: "badge", description: "Status badge", tags: ["display"] },
      { name: "avatar", description: "Avatar", tags: ["display"] },
      { name: "toast", description: "Toast notifications", tags: ["feedback"] },
      { name: "tooltip", description: "Hover tooltip", tags: ["overlay"] },
      { name: "skeleton", description: "Loading skeleton", tags: ["display"] },
      { name: "calendar", description: "Date calendar", tags: ["data"] },
      { name: "command", description: "Command palette", tags: ["navigation"] },
      { name: "combobox", description: "Searchable select", tags: ["form"] },
      { name: "data-table", description: "Full data table with tanstack", tags: ["data"] },
      { name: "carousel", description: "Image/content carousel", tags: ["display"] },
      { name: "chart", description: "Chart wrapper", tags: ["data"] },
      { name: "resizable", description: "Resizable panels", tags: ["layout"] },
      { name: "separator", description: "Divider line", tags: ["layout"] },
      { name: "scroll-area", description: "Custom scrollbar area", tags: ["layout"] },
      { name: "collapsible", description: "Show/hide content", tags: ["layout"] },
    ],
  },
  {
    id: "magicui",
    label: "Magic UI",
    color: "#a855f7",
    bgClass: "bg-fuchsia-900/40 border-fuchsia-700/50 text-fuchsia-300",
    baseCmd: "magicui-cli",
    subCmd: "add",
    docs: "https://magicui.design",
    components: [
      { name: "animated-beam", description: "Beam connecting elements", tags: ["effect"] },
      { name: "bento-grid", description: "Bento grid layout", tags: ["layout"] },
      { name: "blur-in", description: "Blur-in text animation", tags: ["effect"] },
      { name: "border-beam", description: "Animated border beam", tags: ["effect"] },
      { name: "confetti", description: "Confetti celebration", tags: ["effect"] },
      { name: "cool-mode", description: "Particle cursor effect", tags: ["effect"] },
      { name: "dot-pattern", description: "Dot background pattern", tags: ["background"] },
      { name: "globe", description: "Interactive 3D globe", tags: ["display"] },
      { name: "grid-pattern", description: "Grid background pattern", tags: ["background"] },
      { name: "lens", description: "Zoom lens hover effect", tags: ["effect"] },
      { name: "marquee", description: "Horizontal scroll ticker", tags: ["display"] },
      { name: "meteor-shower", description: "Meteor rain effect", tags: ["effect"] },
      { name: "neon-gradient-card", description: "Neon glow card", tags: ["display"] },
      { name: "number-ticker", description: "Animated counter", tags: ["display"] },
      { name: "orbiting-circles", description: "Orbiting circles animation", tags: ["effect"] },
      { name: "particles", description: "Interactive particles", tags: ["background"] },
      { name: "retro-grid", description: "Retro perspective grid", tags: ["background"] },
      { name: "ripple", description: "Ripple animation", tags: ["effect"] },
      { name: "safari", description: "Browser frame mockup", tags: ["display"] },
      { name: "shine-border", description: "Animated shine border", tags: ["effect"] },
      { name: "shiny-button", description: "Shiny animated button", tags: ["interactive"] },
      { name: "sparkles-text", description: "Text with sparkles", tags: ["effect"] },
      { name: "spinning-text", description: "Spinning text animation", tags: ["effect"] },
      { name: "text-animate", description: "Text entrance animation", tags: ["effect"] },
      { name: "tweet-card", description: "Twitter card mockup", tags: ["display"] },
      { name: "word-pull-up", description: "Word pull-up animation", tags: ["effect"] },
      { name: "word-rotate", description: "Word rotation animation", tags: ["effect"] },
    ],
  },
  {
    id: "aceternity",
    label: "Aceternity UI",
    color: "#06b6d4",
    bgClass: "bg-cyan-900/40 border-cyan-700/50 text-cyan-300",
    baseCmd: "shadcn@latest",
    subCmd: "add",
    docs: "https://ui.aceternity.com",
    components: [
      { name: "@aceternity/3d-card", description: "3D perspective card", tags: ["effect"] },
      { name: "@aceternity/animated-tooltip", description: "Animated tooltip", tags: ["overlay"] },
      { name: "@aceternity/aurora-background", description: "Aurora gradient bg", tags: ["background"] },
      { name: "@aceternity/background-beams", description: "Beam background effect", tags: ["background"] },
      { name: "@aceternity/background-boxes", description: "Glowing box grid", tags: ["background"] },
      { name: "@aceternity/background-gradient-animation", description: "Animated gradient", tags: ["background"] },
      { name: "@aceternity/bento-grid", description: "Aceternity bento layout", tags: ["layout"] },
      { name: "@aceternity/card-hover-effect", description: "Card hover parallax", tags: ["effect"] },
      { name: "@aceternity/card-stack", description: "Stacked card carousel", tags: ["display"] },
      { name: "@aceternity/compare", description: "Before/after slider", tags: ["display"] },
      { name: "@aceternity/container-scroll-animation", description: "Scroll-driven 3D", tags: ["effect"] },
      { name: "@aceternity/floating-navbar", description: "Floating nav bar", tags: ["navigation"] },
      { name: "@aceternity/follow-pointer", description: "Cursor follow element", tags: ["effect"] },
      { name: "@aceternity/glare-card", description: "Glare reflection card", tags: ["effect"] },
      { name: "@aceternity/glowing-stars", description: "Star field background", tags: ["background"] },
      { name: "@aceternity/hero-highlight", description: "Text highlight effect", tags: ["effect"] },
      { name: "@aceternity/infinite-moving-cards", description: "Infinite scroll cards", tags: ["display"] },
      { name: "@aceternity/lamp", description: "Lamp glow effect", tags: ["background"] },
      { name: "@aceternity/layout-grid", description: "Masonry layout grid", tags: ["layout"] },
      { name: "@aceternity/macbook-scroll", description: "MacBook scroll reveal", tags: ["display"] },
      { name: "@aceternity/multi-step-loader", description: "Multi-step progress", tags: ["feedback"] },
      { name: "@aceternity/shooting-stars", description: "Shooting stars bg", tags: ["background"] },
      { name: "@aceternity/sparkles", description: "Sparkle hover effect", tags: ["effect"] },
      { name: "@aceternity/spotlight", description: "Cursor spotlight effect", tags: ["effect"] },
      { name: "@aceternity/sticky-scroll-reveal", description: "Sticky scroll reveal", tags: ["effect"] },
      { name: "@aceternity/tabs", description: "Animated tab panels", tags: ["layout"] },
      { name: "@aceternity/text-generate-effect", description: "Typewriter text", tags: ["effect"] },
      { name: "@aceternity/timeline", description: "Vertical timeline", tags: ["display"] },
      { name: "@aceternity/tracing-beam", description: "Tracing beam scroll", tags: ["effect"] },
      { name: "@aceternity/typewriter-effect", description: "Typewriter animation", tags: ["effect"] },
      { name: "@aceternity/wavy-background", description: "Animated wavy bg", tags: ["background"] },
    ],
  },
  {
    id: "daisyui",
    label: "DaisyUI",
    color: "#f472b6",
    bgClass: "bg-pink-900/40 border-pink-700/50 text-pink-300",
    baseCmd: "daisyui",
    subCmd: "add",
    docs: "https://daisyui.com/components",
    components: [
      { name: "btn", description: "Button", tags: ["interactive"], variants: [{ name: "btn-primary" }, { name: "btn-secondary" }, { name: "btn-accent" }, { name: "btn-ghost" }, { name: "btn-outline" }] },
      { name: "card", description: "Card component", tags: ["layout"] },
      { name: "modal", description: "Dialog modal", tags: ["overlay"] },
      { name: "navbar", description: "Top navbar", tags: ["navigation"] },
      { name: "drawer", description: "Side drawer", tags: ["overlay"] },
      { name: "badge", description: "Badge/tag", tags: ["display"] },
      { name: "alert", description: "Alert messages", tags: ["feedback"] },
      { name: "loading", description: "Loading indicator", tags: ["feedback"] },
      { name: "progress", description: "Progress bar", tags: ["display"] },
      { name: "steps", description: "Step indicator", tags: ["display"] },
      { name: "table", description: "Data table", tags: ["data"] },
      { name: "chat", description: "Chat bubbles", tags: ["display"] },
      { name: "hero", description: "Hero section", tags: ["layout"] },
      { name: "stat", description: "Stat display", tags: ["display"] },
      { name: "timeline", description: "Timeline component", tags: ["display"] },
    ],
  },
  {
    id: "radix",
    label: "Radix UI",
    color: "#6366f1",
    bgClass: "bg-indigo-900/40 border-indigo-700/50 text-indigo-300",
    baseCmd: "shadcn@latest",
    subCmd: "add",
    docs: "https://www.radix-ui.com/primitives",
    components: [
      { name: "accordion", description: "Collapsible sections", tags: ["layout"] },
      { name: "alert-dialog", description: "Alert dialog", tags: ["overlay"] },
      { name: "aspect-ratio", description: "Aspect ratio container", tags: ["layout"] },
      { name: "avatar", description: "Avatar fallback", tags: ["display"] },
      { name: "checkbox", description: "Checkbox primitive", tags: ["form"] },
      { name: "collapsible", description: "Collapsible primitive", tags: ["layout"] },
      { name: "context-menu", description: "Right-click menu", tags: ["overlay"] },
      { name: "dialog", description: "Modal dialog", tags: ["overlay"] },
      { name: "dropdown-menu", description: "Dropdown menu", tags: ["overlay"] },
      { name: "form", description: "Accessible form", tags: ["form"] },
      { name: "hover-card", description: "Hover card", tags: ["overlay"] },
      { name: "label", description: "Form label", tags: ["form"] },
      { name: "menubar", description: "Menu bar", tags: ["navigation"] },
      { name: "navigation-menu", description: "Navigation menu", tags: ["navigation"] },
      { name: "popover", description: "Popover", tags: ["overlay"] },
      { name: "progress", description: "Progress indicator", tags: ["display"] },
      { name: "radio-group", description: "Radio button group", tags: ["form"] },
      { name: "scroll-area", description: "Custom scroll area", tags: ["layout"] },
      { name: "select", description: "Select input", tags: ["form"] },
      { name: "separator", description: "Separator", tags: ["layout"] },
      { name: "slider", description: "Slider input", tags: ["form"] },
      { name: "switch", description: "Toggle switch", tags: ["form"] },
      { name: "tabs", description: "Tab panels", tags: ["layout"] },
      { name: "toast", description: "Toast / Sonner", tags: ["feedback"] },
      { name: "toggle", description: "Toggle button", tags: ["form"] },
      { name: "toggle-group", description: "Toggle group", tags: ["form"] },
      { name: "tooltip", description: "Tooltip", tags: ["overlay"] },
    ],
  },
];

// Flat tag list for filter chips
const ALL_TAGS = Array.from(
  new Set(CLI_ADAPTERS.flatMap((a) => a.components.flatMap((c) => c.tags ?? [])))
).sort();

// ── Types for install state ─────────────────────────────────────────────────

type InstallStatus = "idle" | "running" | "done" | "error";

interface InstallerSelection {
  adapterId: string;
  componentName: string;
  variantFlag?: string;
}

// ── Error Boundary for ComponentInstaller ────────────────────────────────────

class ComponentInstallerErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ComponentInstaller] Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
          <div className="bg-[#0d1117] border border-[#30363d] rounded-2xl p-8 max-w-md text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Something went wrong</h3>
            <p className="text-sm text-[#8b949e] mb-4">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={this.props.onError}
              className="px-4 py-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── ComponentInstaller Modal ─────────────────────────────────────────────────

function ComponentInstallerInner({
  open,
  onClose,
  projectPath,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}) {
  const [activeAdapter, setActiveAdapter] = useState<string>("heroui");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selections, setSelections] = useState<InstallerSelection[]>([]);
  const [expandedComponent, setExpandedComponent] = useState<string | null>(null);
  const [status, setStatus] = useState<InstallStatus>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const adapter = CLI_ADAPTERS.find((a) => a.id === activeAdapter)!;

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Filter components
  const filteredComponents = useMemo(() => {
    const q = search.toLowerCase();
    return adapter.components.filter((c) => {
      const matchSearch = !q || c.name.includes(q) || (c.description ?? "").toLowerCase().includes(q);
      const matchTag = !selectedTag || (c.tags ?? []).includes(selectedTag);
      return matchSearch && matchTag;
    });
  }, [adapter, search, selectedTag]);

  const toggleSelection = (adapterId: string, componentName: string, variantFlag?: string) => {
    const key = `${adapterId}::${componentName}::${variantFlag ?? ""}`;
    setSelections((prev) => {
      const exists = prev.some(
        (s) => s.adapterId === adapterId && s.componentName === componentName && s.variantFlag === variantFlag
      );
      if (exists) {
        return prev.filter(
          (s) => !(s.adapterId === adapterId && s.componentName === componentName && s.variantFlag === variantFlag)
        );
      }
      return [...prev, { adapterId, componentName, variantFlag }];
    });
  };

  const isSelected = (adapterId: string, componentName: string, variantFlag?: string) =>
    selections.some(
      (s) => s.adapterId === adapterId && s.componentName === componentName && s.variantFlag === variantFlag
    );

  const handleInstall = async () => {
    if (selections.length === 0) return;
    setStatus("running");
    setLog([]);
    setProgress(0);

    const total = selections.length;
    let done = 0;

    for (const sel of selections) {
      const adp = CLI_ADAPTERS.find((a) => a.id === sel.adapterId)!;
      const args = [sel.componentName, ...(sel.variantFlag ? sel.variantFlag.split(" ") : [])];
      if (adp.nonInteractiveFlag) args.push(adp.nonInteractiveFlag);

      const cmdLabel = `npx ${adp.baseCmd} ${adp.subCmd} ${args.join(" ")}`;
      setLog((l) => [...l, `\n▶ Running: ${cmdLabel}`, ""]);

      try {
        const resp = await fetch("/api/cli-install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseCmd: adp.baseCmd,
            subCmd: adp.subCmd,
            args,
            projectPath,
          }),
        });

        if (!resp.ok || !resp.body) {
          setLog((l) => [...l, `✗ HTTP ${resp.status}: ${await resp.text()}`]);
          setStatus("error");
          return;
        }

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let cancelled = false;
        abortRef.current = () => { cancelled = true; };

        while (true) {
          const { done: rDone, value } = await reader.read();
          if (rDone || cancelled) break;
          const text = dec.decode(value);
          // Parse SSE lines: "data: ...\n\n"
          for (const line of text.split("\n")) {
            const stripped = line.replace(/^data:\s*/, "").trim();
            if (!stripped) continue;
            try {
              const msg = JSON.parse(stripped);
              if (msg.done) {
                setLog((l) => [...l, msg.code === 0 ? "✓ Done" : `✗ Exit code ${msg.code}`]);
                if (msg.code !== 0) { setStatus("error"); return; }
              } else if (msg.line) {
                setLog((l) => [...l, msg.line]);
              }
            } catch {
              setLog((l) => [...l, stripped]);
            }
          }
        }

        done++;
        setProgress(Math.round((done / total) * 100));
      } catch (err) {
        setLog((l) => [...l, `✗ ${err instanceof Error ? err.message : String(err)}`]);
        setStatus("error");
        return;
      }
    }

    setStatus("done");
    setLog((l) => [...l, `\n✅ All ${total} component(s) installed successfully.`]);
  };

  const handleAbort = () => {
    abortRef.current?.();
    setStatus("idle");
    setLog((l) => [...l, "⚠ Cancelled"]);
  };

  const handleReset = () => {
    setStatus("idle");
    setLog([]);
    setSelections([]);
    setProgress(0);
  };

  if (!open) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col bg-[#0d1117] border border-[#30363d] rounded-2xl overflow-hidden"
        style={{
          width: "min(96vw, 900px)",
          height: "min(92vh, 680px)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center">
              <Package className="w-4 h-4 text-[#3b82f6]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                Install Components
              </h2>
              <p className="text-[10px] text-[#484f58]">Run CLI installs directly from the editor</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#484f58] hover:text-white hover:bg-[#21262d] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── Left: Adapter picker + component list ── */}
          <div className="flex flex-col w-[54%] border-r border-[#30363d] overflow-hidden">
            {/* Adapter tabs */}
            <div className="flex gap-1 px-3 pt-3 pb-2 flex-wrap flex-shrink-0 border-b border-[#30363d]">
              {CLI_ADAPTERS.map((adp) => (
                <button
                  key={adp.id}
                  onClick={() => setActiveAdapter(adp.id)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                    activeAdapter === adp.id
                      ? adp.bgClass + " ring-1 ring-white/20"
                      : "bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white"
                  }`}
                >
                  {adp.label}
                </button>
              ))}
            </div>

            {/* Search + tag filters */}
            <div className="px-3 py-2 space-y-2 flex-shrink-0 border-b border-[#30363d]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484f58]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${adapter.label} components…`}
                  className="w-full pl-7 pr-2 h-7 bg-[#161b22] border border-[#30363d] rounded-lg text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-[#3b82f6]"
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                    !selectedTag ? "bg-[#3b82f6] border-[#3b82f6] text-white" : "bg-transparent border-[#30363d] text-[#8b949e] hover:text-white"
                  }`}
                >
                  all
                </button>
                {ALL_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                    className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                      selectedTag === tag ? "bg-[#3b82f6] border-[#3b82f6] text-white" : "bg-transparent border-[#30363d] text-[#8b949e] hover:text-white"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Component list */}
            <div className="flex-1 overflow-y-auto">
              {filteredComponents.map((comp) => {
                const isExpanded = expandedComponent === `${activeAdapter}::${comp.name}`;
                const hasVariants = (comp.variants?.length ?? 0) > 0;
                const anySelected = selections.some(
                  (s) => s.adapterId === activeAdapter && s.componentName === comp.name
                );

                return (
                  <div key={comp.name} className="border-b border-[#21262d]">
                    <div
                      className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                        anySelected ? "bg-[#1a2744]" : "hover:bg-[#161b22]"
                      }`}
                      onClick={() => {
                        if (hasVariants) {
                          setExpandedComponent(isExpanded ? null : `${activeAdapter}::${comp.name}`);
                        } else {
                          toggleSelection(activeAdapter, comp.name);
                        }
                      }}
                    >
                      {/* Checkbox (only for non-variant components) */}
                      {!hasVariants && (
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            isSelected(activeAdapter, comp.name)
                              ? "bg-[#3b82f6] border-[#3b82f6]"
                              : "border-[#484f58] bg-transparent"
                          }`}
                        >
                          {isSelected(activeAdapter, comp.name) && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${anySelected ? "text-white" : "text-[#e6edf3]"}`}>
                            {comp.name}
                          </span>
                          {anySelected && (
                            <span className="text-[9px] bg-[#3b82f6]/20 text-[#60a5fa] border border-[#3b82f6]/30 px-1 py-0.5 rounded">
                              selected
                            </span>
                          )}
                        </div>
                        {comp.description && (
                          <p className="text-[10px] text-[#484f58] truncate mt-0.5">{comp.description}</p>
                        )}
                      </div>

                      {/* Tags */}
                      <div className="flex gap-1 flex-shrink-0">
                        {(comp.tags ?? []).slice(0, 2).map((t) => (
                          <span key={t} className="text-[9px] text-[#484f58] bg-[#21262d] px-1 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                      </div>

                      {hasVariants && (
                        <ChevronRight
                          className={`w-3 h-3 text-[#484f58] flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                      )}
                    </div>

                    {/* Variants sub-list */}
                    {hasVariants && isExpanded && (
                      <div className="bg-[#0a0d12] border-t border-[#21262d]">
                        {/* "all variants" row */}
                        <div
                          className={`flex items-center gap-2 pl-8 pr-3 py-2 cursor-pointer hover:bg-[#161b22] transition-colors ${
                            isSelected(activeAdapter, comp.name) ? "bg-[#1a2744]" : ""
                          }`}
                          onClick={() => toggleSelection(activeAdapter, comp.name)}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                              isSelected(activeAdapter, comp.name)
                                ? "bg-[#3b82f6] border-[#3b82f6]"
                                : "border-[#484f58]"
                            }`}
                          >
                            {isSelected(activeAdapter, comp.name) && (
                              <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className="text-[11px] text-[#8b949e]">default (no variant)</span>
                        </div>
                        {comp.variants!.map((v) => (
                          <div
                            key={v.name}
                            className={`flex items-center gap-2 pl-8 pr-3 py-2 cursor-pointer hover:bg-[#161b22] transition-colors ${
                              isSelected(activeAdapter, comp.name, v.flag) ? "bg-[#1a2744]" : ""
                            }`}
                            onClick={() => toggleSelection(activeAdapter, comp.name, v.flag)}
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                isSelected(activeAdapter, comp.name, v.flag)
                                  ? "bg-[#3b82f6] border-[#3b82f6]"
                                  : "border-[#484f58]"
                              }`}
                            >
                              {isSelected(activeAdapter, comp.name, v.flag) && (
                                <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-[#8b949e]">
                              {v.flag ?? v.name}
                            </span>
                            {v.description && (
                              <span className="text-[10px] text-[#484f58] ml-1">{v.description}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredComponents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-[#484f58]">
                  <Search className="w-8 h-8 opacity-20 mb-2" />
                  <p className="text-xs">No components match your search</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: selections + terminal ── */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Selected queue */}
            <div className="flex-shrink-0 border-b border-[#30363d]">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-[#484f58]">
                  Queue ({selections.length})
                </span>
                {selections.length > 0 && (
                  <button
                    onClick={() => setSelections([])}
                    className="text-[10px] text-[#484f58] hover:text-red-400 transition-colors"
                  >
                    clear all
                  </button>
                )}
              </div>
              <div className="px-3 pb-2 max-h-28 overflow-y-auto space-y-1">
                {selections.length === 0 ? (
                  <p className="text-[11px] text-[#484f58] italic px-1 pb-1">
                    Select components from the list to queue them for install
                  </p>
                ) : (
                  selections.map((sel, i) => {
                    const adp = CLI_ADAPTERS.find((a) => a.id === sel.adapterId)!;
                    const cmd = `npx ${adp.baseCmd} ${adp.subCmd} ${sel.componentName}${sel.variantFlag ? " " + sel.variantFlag : ""}`;
                    return (
                      <div key={i} className="flex items-center gap-2 bg-[#161b22] rounded px-2 py-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${adp.bgClass}`}>
                          {adp.label}
                        </span>
                        <code className="flex-1 text-[10px] font-mono text-[#e6edf3] truncate">{cmd}</code>
                        <button
                          onClick={() => toggleSelection(sel.adapterId, sel.componentName, sel.variantFlag)}
                          className="text-[#484f58] hover:text-red-400 transition-colors flex-shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Terminal log */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="px-4 py-2 flex items-center gap-2 border-b border-[#30363d] flex-shrink-0">
                <span className="text-[10px] uppercase tracking-widest text-[#484f58]">Terminal</span>
                {status === "running" && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-green-400">{progress}%</span>
                  </div>
                )}
                {(status === "done" || status === "error") && (
                  <button onClick={handleReset} className="ml-auto text-[10px] text-[#484f58] hover:text-white">
                    clear
                  </button>
                )}
              </div>

              {/* Progress bar */}
              {status === "running" && (
                <div className="h-0.5 bg-[#21262d] flex-shrink-0">
                  <div
                    className="h-full bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              <div
                ref={logRef}
                className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed bg-[#070b0f]"
                style={{ fontFamily: "DM Mono, monospace" }}
              >
                {log.length === 0 ? (
                  <p className="text-[#484f58] italic">
                    {status === "idle"
                      ? "Select components and press Install to begin…"
                      : "Waiting…"}
                  </p>
                ) : (
                  log.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.startsWith("✓") || line.startsWith("✅")
                          ? "text-green-400"
                          : line.startsWith("✗") || line.startsWith("⚠")
                          ? "text-red-400"
                          : line.startsWith("▶")
                          ? "text-[#3b82f6] font-semibold"
                          : "text-[#8b949e]"
                      }
                    >
                      {line || "\u00a0"}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-[#30363d] flex-shrink-0">
              {adapter.docs && (
                <a
                  href={adapter.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-[#484f58] hover:text-white transition-colors mr-auto"
                >
                  <Link className="w-3 h-3" />
                  Docs
                </a>
              )}

              {status === "running" ? (
                <button
                  onClick={handleAbort}
                  className="px-4 h-8 rounded-lg text-xs font-semibold bg-red-900/40 hover:bg-red-900/70 text-red-400 border border-red-800/50 transition-colors"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    onClick={onClose}
                    className="px-4 h-8 rounded-lg text-xs text-[#8b949e] hover:text-white bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleInstall}
                    disabled={selections.length === 0 || status === "done"}
                    className="flex items-center gap-2 px-4 h-8 rounded-lg text-xs font-semibold bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Install {selections.length > 0 ? `(${selections.length})` : ""}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Wrapper component with error boundary
function ComponentInstaller(props: React.ComponentProps<typeof ComponentInstallerInner>) {
  return (
    <ComponentInstallerErrorBoundary onError={props.onClose}>
      <ComponentInstallerInner {...props} />
    </ComponentInstallerErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT LIBRARY (drag palette)
// ─────────────────────────────────────────────────────────────────────────────

interface LibItem {
  name: string;
  component: React.ElementType;
  defaultProps: Record<string, unknown>;
  preview?: React.ReactNode;
}

const LIBRARY_CATEGORIES: { label: string; icon: React.ElementType; items: LibItem[] }[] = [
  {
    label: "Layout",
    icon: Layout,
    items: [
      { name: "Container", component: ContainerCraft, defaultProps: ContainerCraft.craft.props },
      { name: "Grid", component: GridCraft, defaultProps: GridCraft.craft.props },
      { name: "Hero Section", component: HeroCraft, defaultProps: HeroCraft.craft.props },
      { name: "NavBar", component: NavBarCraft, defaultProps: NavBarCraft.craft.props },
    ],
  },
  {
    label: "Typography",
    icon: Type,
    items: [
      { name: "Text / Heading", component: TextCraft, defaultProps: { ...TextCraft.craft.props, tag: "h2", text: "Heading", styles: { fontSize: "24px", fontWeight: "700", color: "#e6edf3" } } },
      { name: "Text / Paragraph", component: TextCraft, defaultProps: TextCraft.craft.props },
      { name: "Code Block", component: CodeBlockCraft, defaultProps: CodeBlockCraft.craft.props },
    ],
  },
  {
    label: "Interactive",
    icon: Zap,
    items: [
      { name: "Button / Primary", component: ButtonCraft, defaultProps: ButtonCraft.craft.props },
      { name: "Button / Outline", component: ButtonCraft, defaultProps: { ...ButtonCraft.craft.props, variant: "outline" } },
      { name: "Button / Gradient", component: ButtonCraft, defaultProps: { ...ButtonCraft.craft.props, variant: "gradient" } },
      { name: "Input", component: InputCraft, defaultProps: InputCraft.craft.props },
      { name: "Form", component: FormCraft, defaultProps: FormCraft.craft.props },
    ],
  },
  {
    label: "Data Display",
    icon: Grid,
    items: [
      { name: "Card / Default", component: CardCraft, defaultProps: CardCraft.craft.props },
      { name: "Card / Glass", component: CardCraft, defaultProps: { ...CardCraft.craft.props, variant: "glass" } },
      { name: "Card / Elevated", component: CardCraft, defaultProps: { ...CardCraft.craft.props, variant: "elevated" } },
      { name: "Badge", component: BadgeCraft, defaultProps: BadgeCraft.craft.props },
      { name: "Alert", component: AlertCraft, defaultProps: AlertCraft.craft.props },
      { name: "Stat Card", component: StatCardCraft, defaultProps: StatCardCraft.craft.props },
      { name: "Table", component: TableCraft, defaultProps: TableCraft.craft.props },
      { name: "Avatar", component: AvatarCraft, defaultProps: AvatarCraft.craft.props },
    ],
  },
  {
    label: "Media",
    icon: ImageIcon,
    items: [
      { name: "Image", component: ImageCraft, defaultProps: ImageCraft.craft.props },
      { name: "Divider", component: DividerCraft, defaultProps: DividerCraft.craft.props },
      { name: "Divider / Label", component: DividerCraft, defaultProps: { ...DividerCraft.craft.props, label: "OR" } },
    ],
  },
  {
    label: "✨ Advanced UI",
    icon: Zap,
    items: [
      { name: "Bento Grid", component: BentoGridCraft, defaultProps: BentoGridCraft.craft.props },
      { name: "Spotlight Card", component: SpotlightCardCraft, defaultProps: SpotlightCardCraft.craft.props },
      { name: "Shiny Button", component: ShinyButtonCraft, defaultProps: ShinyButtonCraft.craft.props },
      { name: "Gradient Text", component: GradientTextCraft, defaultProps: GradientTextCraft.craft.props },
      { name: "Background Beams", component: BackgroundBeamsCraft, defaultProps: BackgroundBeamsCraft.craft.props },
      { name: "Pricing Card", component: PricingCardCraft, defaultProps: PricingCardCraft.craft.props },
      { name: "Testimonial", component: TestimonialCardCraft, defaultProps: TestimonialCardCraft.craft.props },
      { name: "Feature List", component: FeatureListCraft, defaultProps: FeatureListCraft.craft.props },
    ],
  },
  {
    label: "📱 Mobile UI",
    icon: Smartphone,
    items: [
      { name: "Mobile Nav", component: MobileNavCraft, defaultProps: MobileNavCraft.craft.props },
      { name: "Bottom Tab Bar", component: BottomTabBarCraft, defaultProps: BottomTabBarCraft.craft.props },
      { name: "Status Bar", component: StatusBarCraft, defaultProps: StatusBarCraft.craft.props },
      { name: "App Header", component: AppHeaderCraft, defaultProps: AppHeaderCraft.craft.props },
    ],
  },
];

function ComponentLibrary({ projectPath = "" }: { projectPath?: string }) {
  const { connectors } = useEditor();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["Layout", "Interactive"]));
  const [installerOpen, setInstallerOpen] = useState(false);

  const toggle = (label: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(label) ? n.delete(label) : n.add(label);
      return n;
    });

  const filtered = useMemo(() => {
    if (!search) return LIBRARY_CATEGORIES;
    const q = search.toLowerCase();
    return LIBRARY_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter((i) => i.name.toLowerCase().includes(q)),
    })).filter((cat) => cat.items.length > 0);
  }, [search]);

  return (
    <>
      {/* ── Installer Modal (portal-like, rendered here but covers whole screen) ── */}
      <ComponentInstaller
        open={installerOpen}
        onClose={() => setInstallerOpen(false)}
        projectPath={projectPath}
      />

      <div className="flex flex-col h-full overflow-hidden">
        {/* Header with search + install button */}
        <div className="px-3 py-3 border-b border-[#30363d] space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#484f58]">Components</p>
            <button
              onClick={() => setInstallerOpen(true)}
              title="Install from CLI (HeroUI, shadcn, Magic UI, Aceternity…)"
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 border border-[#3b82f6]/30 text-[#60a5fa] hover:text-[#93c5fd] text-[10px] font-semibold transition-all group"
            >
              <Download className="w-3 h-3 group-hover:animate-bounce" />
              Install
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484f58]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search components…"
              className="w-full pl-7 pr-2 h-7 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {filtered.map((cat) => {
            const CatIcon = cat.icon;
            const isOpen = expanded.has(cat.label);
            return (
              <div key={cat.label}>
                <button
                  onClick={() => toggle(cat.label)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[#8b949e] hover:text-white hover:bg-[#21262d] text-xs transition-colors"
                >
                  <CatIcon className="w-3.5 h-3.5" />
                  <span className="flex-1 text-left font-medium">{cat.label}</span>
                  {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>

                {isOpen && (
                  <div className="pb-1">
                    {cat.items.map((item) => (
                      <div
                        key={item.name}
                        ref={(ref) => {
                          if (ref) {
                            connectors.create(
                              ref,
                              React.createElement(item.component as any, item.defaultProps)
                            );
                          }
                        }}
                        className="flex items-center gap-2 mx-2 px-2 py-2 rounded text-xs text-[#8b949e] hover:text-white hover:bg-[#21262d] cursor-grab active:cursor-grabbing transition-colors group"
                      >
                        <Grip className="w-3 h-3 text-[#30363d] group-hover:text-[#484f58]" />
                        <span>{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer install prompt */}
        <div className="px-3 py-2.5 border-t border-[#30363d]">
          <button
            onClick={() => setInstallerOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-[#30363d] hover:border-[#3b82f6]/50 text-[#484f58] hover:text-[#60a5fa] text-[11px] transition-all hover:bg-[#3b82f6]/5 group"
          >
            <Plus className="w-3 h-3 group-hover:rotate-90 transition-transform duration-200" />
            Install from HeroUI / shadcn / Magic UI…
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLBAR  (inside the Editor context)
// ─────────────────────────────────────────────────────────────────────────────

function EditorToolbar({
  editorMode,
  onModeChange,
  viewport,
  onViewportChange,
  onSave,
  onReturn,
  isSaving,
  saveStatus,
  projectName,
}: {
  editorMode: "design" | "code" | "split";
  onModeChange: (m: "design" | "code" | "split") => void;
  viewport: "desktop" | "tablet" | "mobile";
  onViewportChange: (v: "desktop" | "tablet" | "mobile") => void;
  onSave: () => void;
  onReturn: () => void;
  isSaving: boolean;
  saveStatus: "idle" | "saved" | "error";
  projectName: string;
}) {
  const { actions, canUndo, canRedo } = useEditor((state, query) => ({
    canUndo: query.history.canUndo(),
    canRedo: query.history.canRedo(),
  }));

  return (
    <div
      className="h-12 flex items-center justify-between px-4 border-b border-[#30363d] bg-[#0d1117] flex-shrink-0"
      style={{ fontFamily: "Syne, sans-serif" }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={onReturn}
          className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <div className="w-px h-4 bg-[#30363d]" />

        {/* Mode */}
        <div className="flex bg-[#161b22] rounded-lg border border-[#30363d] overflow-hidden">
          {(["design", "split", "code"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-3 h-7 text-[11px] font-medium flex items-center gap-1.5 transition-colors capitalize ${
                editorMode === m
                  ? "bg-[#3b82f6] text-white"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              {m === "design" ? <Eye className="w-3 h-3" /> : m === "code" ? <Code className="w-3 h-3" /> : <Layout className="w-3 h-3" />}
              {m}
            </button>
          ))}
        </div>

        {/* Viewport */}
        <div className="flex items-center gap-0.5 bg-[#161b22] rounded border border-[#30363d] p-0.5">
          {(["desktop", "tablet", "mobile"] as const).map((v) => {
            const Icon = v === "desktop" ? Monitor : v === "tablet" ? Tablet : Smartphone;
            return (
              <button
                key={v}
                onClick={() => onViewportChange(v)}
                title={v}
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  viewport === v
                    ? "bg-[#3b82f6] text-white"
                    : "text-[#8b949e] hover:text-white"
                }`}
              >
                <Icon className="w-3 h-3" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Center */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white truncate max-w-[200px]">
          {projectName}
        </span>
        <button
          onClick={() => actions.history.undo()}
          disabled={!canUndo}
          title="Undo ⌘Z"
          className="w-7 h-7 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-30 transition-all"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => actions.history.redo()}
          disabled={!canRedo}
          title="Redo ⌘⇧Z"
          className="w-7 h-7 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-30 transition-all"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {saveStatus === "saved" && (
          <span className="flex items-center gap-1 text-[11px] text-green-400">
            <CheckCircle className="w-3 h-3" /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="flex items-center gap-1 text-[11px] text-red-400">
            <AlertCircle className="w-3 h-3" /> Error
          </span>
        )}
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 h-7 bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-60 text-white text-[11px] font-semibold rounded-lg transition-colors"
        >
          {isSaving ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          Save & Sync
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CODE EDITOR (file tree + textarea, standalone — not inside craft context)
// ─────────────────────────────────────────────────────────────────────────────

function CodeEditorPane({
  files,
  onFileChange,
}: {
  files: Record<string, string>;
  onFileChange: (path: string, content: string) => void;
}) {
  const names = Object.keys(files);
  const [selected, setSelected] = useState(names[0] ?? "");
  const [content, setContent] = useState(files[names[0]] ?? "");

  useEffect(() => {
    if (selected && files[selected] !== undefined) setContent(files[selected]);
  }, [selected, files]);

  return (
    <div className="flex h-full bg-[#0d1117] overflow-hidden">
      {/* File tree */}
      <div className="w-44 border-r border-[#30363d] flex flex-col flex-shrink-0">
        <div className="px-3 py-2 border-b border-[#30363d]">
          <span className="text-[9px] uppercase tracking-widest text-[#484f58]">Files</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {names.map((n) => (
            <button
              key={n}
              onClick={() => setSelected(n)}
              className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors truncate ${
                selected === n
                  ? "bg-[#1f3249] text-white border-l-2 border-[#3b82f6] pl-2.5"
                  : "text-[#8b949e] hover:bg-[#21262d] hover:text-white"
              }`}
            >
              <FileCode className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected && (
          <div className="px-4 py-1.5 border-b border-[#30363d] flex items-center gap-2">
            <span className="text-[11px] text-[#8b949e]">{selected}</span>
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            onFileChange(selected, e.target.value);
          }}
          spellCheck={false}
          className="flex-1 bg-[#0d1117] text-[#e6edf3] font-mono text-xs p-4 resize-none focus:outline-none leading-relaxed"
          style={{ fontFamily: "DM Mono, monospace" }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEWPORT WIDTHS
// ─────────────────────────────────────────────────────────────────────────────

const VIEWPORT_WIDTHS = { desktop: "100%", tablet: "768px", mobile: "390px" };

// ─────────────────────────────────────────────────────────────────────────────
// JSX → CRAFT.JS PARSER
// ─────────────────────────────────────────────────────────────────────────────

function jsxToCraftNodes(jsxCode: string): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  let nodeIdCounter = 1;
  
  const getNextId = () => `node-${nodeIdCounter++}`;
  
  function parseStyle(styleStr: string): Record<string, string> {
    const styles: Record<string, string> = {};
    if (!styleStr) return styles;
    
    styleStr.split(';').forEach(rule => {
      const [key, ...valueParts] = rule.split(':');
      if (key && valueParts.length > 0) {
        const k = key.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const v = valueParts.join(':').trim();
        if (k && v) styles[k] = v;
      }
    });
    return styles;
  }
  
  function parseJSXElement(tagName: string, props: Record<string, unknown>, children: string[]): Record<string, unknown> {
    const id = getNextId();
    const node: Record<string, unknown> = {
      type: tagName,
      props: { ...props },
      nodes: [],
      linkedNodes: {},
    };
    
    if (children.length > 0) {
      const childElements: Record<string, unknown>[] = [];
      let textContent = '';
      
      children.forEach(child => {
        const trimmed = child.trim();
        if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
          if (textContent) {
            childElements.push({
              type: 'text',
              props: { text: textContent },
              nodes: [],
              linkedNodes: {},
            });
            textContent = '';
          }
          const parsed = parseSimpleJSX(trimmed);
          if (parsed) childElements.push(parsed);
        } else if (trimmed) {
          textContent += (textContent ? ' ' : '') + trimmed;
        }
      });
      
      if (textContent) {
        childElements.push({
          type: 'text',
          props: { text: textContent },
          nodes: [],
          linkedNodes: {},
        });
      }
      
      node.nodes = childElements.map((c: Record<string, unknown>) => {
        const childId = c.type === 'text' ? getNextId() : (c as any).id || getNextId();
        nodes[childId] = { ...c, id: childId };
        return childId;
      });
    }
    
    return { id, ...node };
  }
  
  function parseSimpleJSX(jsx: string): Record<string, unknown> | null {
    const openTagMatch = jsx.match(/<(\w+)([^>]*)>/);
    if (!openTagMatch) return null;
    
    const tagName = openTagMatch[1];
    const propsStr = openTagMatch[2];
    const props: Record<string, unknown> = {};
    
    const styleMatch = propsStr.match(/style\s*=\s*["']([^"']*)["']/);
    if (styleMatch) {
      props.styles = parseStyle(styleMatch[1]);
    }
    
    const classMatch = propsStr.match(/className\s*=\s*["']([^"']*)["']/);
    if (classMatch) {
      props.className = classMatch[1];
    }
    
    const srcMatch = propsStr.match(/src\s*=\s*["']([^"']*)["']/);
    if (srcMatch) {
      props.src = srcMatch[1];
    }
    
    const altMatch = propsStr.match(/alt\s*=\s*["']([^"']*)["']/);
    if (altMatch) {
      props.alt = altMatch[1];
    }
    
    const textMatch = jsx.match(/>([^<]*)<\/\w+>/);
    if (textMatch && tagName !== 'img' && tagName !== 'input' && tagName !== 'br' && tagName !== 'hr') {
      props.text = textMatch[1].trim();
    }
    
    const componentMap: Record<string, string> = {
      'div': 'ContainerCraft',
      'span': 'TextCraft',
      'p': 'TextCraft',
      'h1': 'TextCraft',
      'h2': 'TextCraft',
      'h3': 'TextCraft',
      'button': 'ButtonCraft',
      'img': 'ImageCraft',
      'input': 'InputCraft',
      'section': 'ContainerCraft',
      'nav': 'NavBarCraft',
      'header': 'ContainerCraft',
      'footer': 'ContainerCraft',
      'main': 'ContainerCraft',
      'article': 'ContainerCraft',
      'aside': 'ContainerCraft',
    };
    
    const craftType = componentMap[tagName] || 'ContainerCraft';
    
    return {
      type: craftType,
      resolvedName: craftType,
      props,
      nodes: [],
      linkedNodes: {},
    };
  }
  
  function extractJSXElements(code: string): string[] {
    const elements: string[] = [];
    let depth = 0;
    let currentStart = -1;
    
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '<' && code[i + 1] !== '/') {
        if (depth === 0) currentStart = i;
        depth++;
      } else if (code[i] === '<' && code[i + 1] === '/') {
        depth--;
        if (depth === 0 && currentStart >= 0) {
          let j = i;
          while (j < code.length && code[j] !== '>') j++;
          elements.push(code.slice(currentStart, j + 1));
          currentStart = -1;
        }
      } else if (code[i] === '/' && code[i + 1] === '>') {
        depth--;
        if (depth === 0 && currentStart >= 0) {
          elements.push(code.slice(currentStart, i + 2));
          currentStart = -1;
        }
      }
    }
    
    return elements;
  }
  
  const jsxElements = extractJSXElements(jsxCode);
  const rootChildren: string[] = [];
  
  jsxElements.forEach(elem => {
    const parsed = parseSimpleJSX(elem);
    if (parsed) {
      const id = getNextId();
      nodes[id] = { ...parsed, id };
      rootChildren.push(id);
    }
  });
  
  nodes['ROOT'] = {
    type: 'div',
    props: {},
    nodes: rootChildren,
    linkedNodes: {},
  };
  
  return nodes;
}

function findMainJSXFile(files: Record<string, string>): string | null {
  const priorityFiles = [
    'app.tsx', 'app.jsx', 'App.tsx', 'App.jsx',
    'page.tsx', 'page.jsx', 'Page.tsx', 'Page.jsx',
    'index.tsx', 'index.jsx', 'Index.tsx', 'Index.jsx',
    'main.tsx', 'main.jsx', 'Main.tsx', 'Main.jsx',
  ];
  
  for (const pf of priorityFiles) {
    for (const [path] of Object.entries(files)) {
      if (path.toLowerCase().endsWith(pf.toLowerCase())) {
        return files[path];
      }
    }
  }
  
  for (const [path, content] of Object.entries(files)) {
    if (path.match(/\.(tsx|jsx)$/i) && content.includes('return') && content.includes('<')) {
      return content;
    }
  }
  
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS WRAPPER — renders Craft <Frame> centred inside the viewport chrome
// ─────────────────────────────────────────────────────────────────────────────

function CanvasPane({ 
  viewport,
  initialNodes,
}: { 
  viewport: "desktop" | "tablet" | "mobile";
  initialNodes?: Record<string, unknown>;
}) {
  const { enabled, actions } = useEditor((state) => ({ 
    enabled: state.options.enabled,
    actions: state.actions,
  }));
  const width = VIEWPORT_WIDTHS[viewport];
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (initialNodes && !hasInitialized.current && Object.keys(initialNodes).length > 1) {
      hasInitialized.current = true;
      try {
        actions.deserialize(initialNodes);
      } catch (e) {
        console.warn("[CanvasPane] Failed to deserialize initial nodes:", e);
      }
    }
  }, [initialNodes, actions]);

  return (
    <div className="flex-1 bg-[#070b0f] overflow-auto flex flex-col items-center">
      {/* Viewport label */}
      <div className="w-full flex items-center justify-center py-2 gap-2">
        <span className="text-[10px] text-[#484f58]">
          {viewport} {viewport !== "desktop" ? `· ${width}` : ""}
        </span>
      </div>

      {/* Page canvas */}
      <div
        className="relative flex-1 w-full"
        style={{
          maxWidth: width,
          minHeight: "100%",
          background: "#ffffff",
          boxShadow: "0 0 0 1px #30363d, 0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <Frame>
          <Element
            is={ContainerCraft}
            canvas
            styles={{
              display: "flex",
              flexDirection: "column",
              minHeight: "100vh",
              background: "#ffffff",
            }}
          />
        </Frame>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORTED COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface VisualEditorMainProps {
  project: VFSProject;
  onSave: (updatedFiles: Record<string, string>) => void;
  onReturn: () => void;
  isSaving: boolean;
  saveStatus: "idle" | "saved" | "error";
}

export function VisualEditorMain({
  project,
  onSave,
  onReturn,
  isSaving,
  saveStatus,
}: VisualEditorMainProps) {
  const [editorMode, setEditorMode] = useState<"design" | "code" | "split">("design");
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [files, setFiles] = useState<Record<string, string>>(project.files);
  const [showLayers, setShowLayers] = useState(true);
  const [showProps, setShowProps] = useState(true);
  const [showComponents, setShowComponents] = useState(true);

  // Parse JSX files to create initial Craft.js nodes
  const initialNodes = useMemo(() => {
    const mainJSX = findMainJSXFile(project.files);
    if (mainJSX) {
      try {
        return jsxToCraftNodes(mainJSX);
      } catch (e) {
        console.warn("[VisualEditorMain] Failed to parse JSX:", e);
      }
    }
    return undefined;
  }, [project.files]);

  // We keep a ref to the Craft serialised JSON so the toolbar can read it on save
  const craftJsonRef = useRef<Record<string, unknown>>({});

  const handleFileChange = useCallback((path: string, content: string) => {
    setFiles((prev) => ({ ...prev, [path]: content }));
  }, []);

  const handleSave = useCallback(() => {
    // Serialize craft nodes → JSX and inject into project files
    const craftNodes = craftJsonRef.current;
    const jsxString = craftNodesToJSX(craftNodes as Record<string, any>);

    // Find the main entry file to update
    const mainFile =
      Object.keys(files).find((f) =>
        ["app.tsx", "app.jsx", "page.tsx", "index.tsx", "index.jsx", "index.html"].some((m) =>
          f.toLowerCase().endsWith(m)
        )
      ) ?? Object.keys(files)[0];

    const updatedFiles = { ...files };
    if (mainFile && Object.keys(craftNodes).length > 1) {
      // Only override if user actually placed craft nodes
      updatedFiles[mainFile] = jsxString;
    }

    onSave(updatedFiles);
  }, [files, onSave]);

  return (
    <Editor
      resolver={RESOLVER}
      onRender={({ render }) => render}
      onNodesChange={(query) => {
        craftJsonRef.current = query.getSerializedNodes() as Record<string, unknown>;
      }}
    >
      <div
        className="h-screen w-screen flex flex-col bg-[#0d1117] overflow-hidden"
        style={{ fontFamily: "Syne, sans-serif" }}
      >
        {/* ── GLOBAL STYLES ── */}
        <style>{`
          .craft-node { position: relative; }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 4px; height: 4px; }
          ::-webkit-scrollbar-track { background: #0d1117; }
          ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
          ::-webkit-scrollbar-thumb:hover { background: #484f58; }
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
          @keyframes shiny {
            0% { left: -100%; }
            100% { left: 100%; }
          }
        `}</style>

        {/* ── TOOLBAR ── */}
        <EditorToolbar
          editorMode={editorMode}
          onModeChange={setEditorMode}
          viewport={viewport}
          onViewportChange={setViewport}
          onSave={handleSave}
          onReturn={onReturn}
          isSaving={isSaving}
          saveStatus={saveStatus}
          projectName={project.name ?? "Untitled"}
        />

        {/* ── BODY ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* ── LEFT SIDEBAR ── */}
          <div
            className={`flex-shrink-0 border-r border-[#30363d] bg-[#161b22] flex flex-col overflow-hidden transition-all duration-200 ${
              showComponents ? "w-56" : "w-0 border-r-0"
            }`}
          >
            {editorMode !== "code" && <ComponentLibrary projectPath={(project as any).filesystemScopePath ?? ""} />}
          </div>

          {/* ── CENTER ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {editorMode === "design" && <CanvasPane viewport={viewport} initialNodes={initialNodes} />}
            {editorMode === "code" && (
              <CodeEditorPane files={files} onFileChange={handleFileChange} />
            )}
            {editorMode === "split" && (
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden border-r border-[#30363d]">
                  <CanvasPane viewport={viewport} initialNodes={initialNodes} />
                </div>
                <div className="flex-1 flex flex-col overflow-hidden">
                  <CodeEditorPane files={files} onFileChange={handleFileChange} />
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div
            className={`flex-shrink-0 border-l border-[#30363d] bg-[#161b22] flex flex-col overflow-hidden transition-all duration-200 ${
              showProps || showLayers ? "w-64" : "w-0 border-l-0"
            }`}
          >
            {editorMode !== "code" && (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Layers */}
                {showLayers && (
                  <div className="flex flex-col border-b border-[#30363d]" style={{ height: "38%" }}>
                    <div className="px-3 py-2 flex items-center justify-between border-b border-[#30363d]">
                      <div className="flex items-center gap-1.5">
                        <LayersIcon className="w-3.5 h-3.5 text-[#8b949e]" />
                        <span className="text-[10px] uppercase tracking-widest text-[#484f58]">
                          Layers
                        </span>
                      </div>
                      <button
                        onClick={() => setShowLayers(false)}
                        className="w-4 h-4 flex items-center justify-center text-[#484f58] hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1">
                      <Layers
                        expandRootOnLoad
                        renderLayer={({ layer, children }) => (
                          <div
                            style={{ paddingLeft: `${(layer.depth - 1) * 12}px` }}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                              layer.selected
                                ? "bg-[#1f3249] text-white"
                                : "text-[#8b949e] hover:bg-[#21262d] hover:text-white"
                            }`}
                          >
                            <span className="truncate">
                              {layer.data.displayName ?? layer.data.type?.resolvedName ?? "Node"}
                            </span>
                            {children}
                          </div>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Settings / Inspector */}
                {showProps && (
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="px-3 py-2 flex items-center justify-between border-b border-[#30363d] flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Settings className="w-3.5 h-3.5 text-[#8b949e]" />
                        <span className="text-[10px] uppercase tracking-widest text-[#484f58]">
                          Properties
                        </span>
                      </div>
                      <button
                        onClick={() => setShowProps(false)}
                        className="w-4 h-4 flex items-center justify-center text-[#484f58] hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <SettingsPanel />
                  </div>
                )}

                {/* Restore buttons */}
                {(!showLayers || !showProps) && (
                  <div className="p-2 border-t border-[#30363d] flex gap-1">
                    {!showLayers && (
                      <button
                        onClick={() => setShowLayers(true)}
                        className="flex-1 py-1 text-[10px] text-[#8b949e] hover:text-white bg-[#21262d] rounded flex items-center justify-center gap-1"
                      >
                        <LayersIcon className="w-3 h-3" /> Layers
                      </button>
                    )}
                    {!showProps && (
                      <button
                        onClick={() => setShowProps(true)}
                        className="flex-1 py-1 text-[10px] text-[#8b949e] hover:text-white bg-[#21262d] rounded flex items-center justify-center gap-1"
                      >
                        <Settings className="w-3 h-3" /> Props
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── STATUS BAR ── */}
        <div className="h-6 bg-[#161b22] border-t border-[#30363d] flex items-center justify-between px-4 text-[10px] text-[#484f58] flex-shrink-0">
          <div className="flex items-center gap-4">
            <span>{project.framework}</span>
            <span>{project.name}</span>
            <span>{Object.keys(files).length} files</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowComponents(!showComponents)}
              className="flex items-center gap-1 hover:text-white transition-colors"
            >
              <PanelLeft className="w-3 h-3" />
              {showComponents ? "Hide" : "Show"} library
            </button>
            <button
              onClick={() => { setShowLayers(true); setShowProps(true); }}
              className="flex items-center gap-1 hover:text-white transition-colors"
            >
              <PanelRight className="w-3 h-3" />
              Show panels
            </button>
          </div>
        </div>
      </div>
    </Editor>
  );
}
