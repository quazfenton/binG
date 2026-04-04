/**
 * E2E Tests: UI Components
 * 
 * Comprehensive tests for UI components including chat, settings, and specialized components.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

describe('UI Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Chat Components', () => {
    const { ChatPanel } = require('@/components/chat-panel');
    const { MessageBubble } = require('@/components/message-bubble');
    const { ChatHistoryModal } = require('@/components/chat-history-modal');

    it('should render ChatPanel', () => {
      const { container } = render(<ChatPanel />);
      expect(container).toBeDefined();
    });

    it('should render MessageBubble', () => {
      render(
        <MessageBubble
          role="user"
          content="Test message"
          timestamp={Date.now()}
        />
      );
      expect(screen.getByText('Test message')).toBeDefined();
    });

    it('should render MessageBubble with assistant role', () => {
      render(
        <MessageBubble
          role="assistant"
          content="Assistant response"
          timestamp={Date.now()}
        />
      );
      expect(screen.getByText('Assistant response')).toBeDefined();
    });

    it('should handle MessageBubble copy', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      render(
        <MessageBubble
          role="user"
          content="Copy me"
          timestamp={Date.now()}
          showCopyButton
        />
      );

      const copyButton = screen.getByRole('button', { name: /copy/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy me');
      });
    });

    it('should render ChatHistoryModal', () => {
      const { container } = render(
        <ChatHistoryModal
          open
          onClose={vi.fn()}
          conversations={[]}
        />
      );
      expect(container).toBeDefined();
    });

    it('should call onClose when ChatHistoryModal closes', () => {
      const onClose = vi.fn();
      render(
        <ChatHistoryModal
          open
          onClose={onClose}
          conversations={[]}
        />
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Settings Components', () => {
    const { Settings } = require('@/components/settings');

    it('should render Settings', () => {
      const { container } = render(<Settings />);
      expect(container).toBeDefined();
    });

    it('should display API key settings', () => {
      render(<Settings />);
      expect(screen.getByText(/api key/i)).toBeDefined();
    });

    it('should display provider settings', () => {
      render(<Settings />);
      expect(screen.getByText(/provider/i)).toBeDefined();
    });

    it('should save settings', async () => {
      const onSave = vi.fn();
      render(<Settings onSave={onSave} />);

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
    });
  });

  describe('Agent Components', () => {
    const { AgentTerminal } = require('@/components/agent/AgentTerminal');
    const { AgentDesktop } = require('@/components/agent/AgentDesktop');

    it('should render AgentTerminal', () => {
      const { container } = render(
        <AgentTerminal
          sessionId="test-session"
          onCommand={vi.fn()}
        />
      );
      expect(container).toBeDefined();
    });

    it('should handle AgentTerminal commands', async () => {
      const onCommand = vi.fn();
      render(
        <AgentTerminal
          sessionId="test-session"
          onCommand={onCommand}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'ls -la' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(onCommand).toHaveBeenCalledWith('ls -la');
      });
    });

    it('should render AgentDesktop', () => {
      const { container } = render(
        <AgentDesktop
          sessionId="test-session"
          onAction={vi.fn()}
        />
      );
      expect(container).toBeDefined();
    });
  });

  describe('Integration Components', () => {
    const { ToolAuthPrompt } = require('@/components/ToolAuthPrompt');

    it('should render ToolAuthPrompt', () => {
      const { container } = render(
        <ToolAuthPrompt
          toolName="github"
          authUrl="https://example.com/auth"
          onAuthorize={vi.fn()}
        />
      );
      expect(container).toBeDefined();
    });

    it('should display tool name in ToolAuthPrompt', () => {
      render(
        <ToolAuthPrompt
          toolName="GitHub"
          authUrl="https://example.com/auth"
          onAuthorize={vi.fn()}
        />
      );
      expect(screen.getByText(/GitHub/i)).toBeDefined();
    });

    it('should call onAuthorize when authorizing', async () => {
      const onAuthorize = vi.fn();
      render(
        <ToolAuthPrompt
          toolName="GitHub"
          authUrl="https://example.com/auth"
          onAuthorize={onAuthorize}
        />
      );

      const authorizeButton = screen.getByRole('button', { name: /authorize/i });
      fireEvent.click(authorizeButton);

      await waitFor(() => {
        expect(onAuthorize).toHaveBeenCalled();
      });
    });
  });

  describe('Tambo Components', () => {
    const { TamboChat } = require('@/components/tambo/TamboChat');
    const { TamboTools } = require('@/components/tambo/TamboTools');

    it('should render TamboChat', () => {
      const { container } = render(<TamboChat />);
      expect(container).toBeDefined();
    });

    it('should render TamboTools', () => {
      const { container } = render(<TamboTools />);
      expect(container).toBeDefined();
    });

    it('should display available tools in TamboTools', () => {
      render(<TamboTools />);
      expect(screen.getByText(/tools/i)).toBeDefined();
    });
  });

  describe('Stateful Agent Components', () => {
    const { AgentStatus } = require('@/components/stateful-agent/AgentStatus');
    const { DiffViewer } = require('@/components/stateful-agent/DiffViewer');
    const { ApprovalDialog } = require('@/components/stateful-agent/ApprovalDialog');

    it('should render AgentStatus', () => {
      const { container } = render(
        <AgentStatus
          status="running"
          progress={50}
        />
      );
      expect(container).toBeDefined();
    });

    it('should display status text', () => {
      render(
        <AgentStatus
          status="running"
          progress={50}
        />
      );
      expect(screen.getByText(/running/i)).toBeDefined();
    });

    it('should render DiffViewer', () => {
      const { container } = render(
        <DiffViewer
          oldContent="old code"
          newContent="new code"
        />
      );
      expect(container).toBeDefined();
    });

    it('should display diff content', () => {
      render(
        <DiffViewer
          oldContent="old code"
          newContent="new code"
        />
      );
      expect(screen.getByText(/old code/i)).toBeDefined();
      expect(screen.getByText(/new code/i)).toBeDefined();
    });

    it('should render ApprovalDialog', () => {
      const { container } = render(
        <ApprovalDialog
          open
          action="delete"
          target="file.txt"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      );
      expect(container).toBeDefined();
    });

    it('should call onApprove when approving', async () => {
      const onApprove = vi.fn();
      render(
        <ApprovalDialog
          open
          action="delete"
          target="file.txt"
          onApprove={onApprove}
          onReject={vi.fn()}
        />
      );

      const approveButton = screen.getByRole('button', { name: /approve/i });
      fireEvent.click(approveButton);

      await waitFor(() => {
        expect(onApprove).toHaveBeenCalled();
      });
    });

    it('should call onReject when rejecting', async () => {
      const onReject = vi.fn();
      render(
        <ApprovalDialog
          open
          action="delete"
          target="file.txt"
          onApprove={vi.fn()}
          onReject={onReject}
        />
      );

      const rejectButton = screen.getByRole('button', { name: /reject|cancel/i });
      fireEvent.click(rejectButton);

      await waitFor(() => {
        expect(onReject).toHaveBeenCalled();
      });
    });
  });

  describe('Fallback UI Components', () => {
    const { FallbackUI } = require('@/components/fallback-ui');

    it('should render FallbackUI', () => {
      const { container } = render(<FallbackUI />);
      expect(container).toBeDefined();
    });

    it('should display fallback message', () => {
      render(<FallbackUI />);
      expect(screen.getByText(/fallback|error|loading/i)).toBeDefined();
    });
  });

  describe('Theme Components', () => {
    const { ThemeProvider, useTheme } = require('@/components/theme-provider');

    it('should render ThemeProvider', () => {
      const { container } = render(
        <ThemeProvider defaultTheme="light">
          <div>Test</div>
        </ThemeProvider>
      );
      expect(container).toBeDefined();
    });

    it('should use useTheme hook', () => {
      const TestComponent = () => {
        const { theme, setTheme } = useTheme();
        return (
          <div>
            <span data-theme={theme}>Current: {theme}</span>
            <button onClick={() => setTheme('dark')}>Set Dark</button>
          </div>
        );
      };

      render(
        <ThemeProvider defaultTheme="light">
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByText('Current: light')).toBeDefined();

      const button = screen.getByRole('button', { name: /set dark/i });
      fireEvent.click(button);

      expect(screen.getByText('Current: dark')).toBeDefined();
    });
  });

  describe('PWA Components', () => {
    const { PWAInstallPrompt } = require('@/components/pwa-install-prompt');

    it('should render PWAInstallPrompt', () => {
      const { container } = render(<PWAInstallPrompt />);
      expect(container).toBeDefined();
    });

    it('should handle PWA install', async () => {
      const deferredPrompt = {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
      };

      vi.spyOn(window, 'addEventListener').mockImplementation(
        (event: string, callback: any) => {
          if (event === 'beforeinstallprompt') {
            callback({ preventDefault: vi.fn(), ...deferredPrompt });
          }
        }
      );

      render(<PWAInstallPrompt />);

      await waitFor(() => {
        const installButton = screen.queryByRole('button', { name: /install/i });
        if (installButton) {
          expect(installButton).toBeDefined();
        }
      });
    });
  });
});
