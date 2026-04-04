/**
 * Monaco VFS Editor Module
 */

export { MonacoVFSEditor, type MonacoEditorProps, type OpenFileEvent } from "../monaco-vfs-editor";
export {
  terminalCommandHandlers,
  getTerminalHandler,
  isEditorCommand,
  executeTerminalCommand,
  type TerminalCommandHandler,
  type TerminalContext,
  type TerminalResult,
} from "./terminal-handlers";
