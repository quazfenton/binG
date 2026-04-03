"use client";

type DeprecatedCodeModeProps = {
  onClose?: () => void;
  onSendMessage?: (message: string, context?: unknown) => void;
  projectFiles?: Record<string, string>;
  onUpdateFiles?: (files: Record<string, string>) => void;
};

/**
 * Deprecated compatibility shim.
 * Code mode is retired from the runtime UI and this component intentionally renders nothing.
 */
export default function CodeMode(_props: DeprecatedCodeModeProps) {
  return null;
}
