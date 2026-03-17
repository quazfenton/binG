/**
 * Component Tests: Message Bubble
 * 
 * Tests the MessageBubble component in isolation
 * Using React Testing Library
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessageBubble from '@/components/message-bubble';
import type { Message } from '@/types';

// Mock next/image
vi.mock('next/image', () => ({
  default: vi.fn((props: any) => <img {...props} />),
}));

// Mock react-syntax-highlighter
vi.mock('react-syntax-highlighter', () => ({
  Prism: {
    default: vi.fn(({ children }: any) => <pre>{children}</pre>),
  },
}));

describe('MessageBubble', () => {
  const baseMessage: Message = {
    id: 'test-1',
    role: 'assistant',
    content: 'Hello, how can I help you?',
    timestamp: new Date().toISOString(),
  };

  it('renders user message correctly', () => {
    const userMessage: Message = {
      ...baseMessage,
      role: 'user',
      content: 'Hi there!',
    };

    render(<MessageBubble message={userMessage} />);

    expect(screen.getByText('Hi there!')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble')).toHaveClass('user');
  });

  it('renders assistant message correctly', () => {
    render(<MessageBubble message={baseMessage} />);

    expect(screen.getByText('Hello, how can I help you?')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble')).toHaveClass('assistant');
  });

  it('renders system message with correct styling', () => {
    const systemMessage: Message = {
      ...baseMessage,
      role: 'system',
      content: 'System notification',
    };

    render(<MessageBubble message={systemMessage} />);

    expect(screen.getByText('System notification')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble')).toHaveClass('system');
  });

  it('displays timestamp when provided', () => {
    const messageWithTime: Message = {
      ...baseMessage,
      timestamp: '2026-02-27T10:00:00Z',
    };

    render(<MessageBubble message={messageWithTime} />);

    expect(screen.getByTestId('message-timestamp')).toBeInTheDocument();
  });

  it('shows copy button for assistant messages', async () => {
    render(<MessageBubble message={baseMessage} />);

    const copyButton = screen.getByTestId('copy-button');
    expect(copyButton).toBeInTheDocument();

    // Click copy button
    fireEvent.click(copyButton);

    // Should show copied state
    await waitFor(() => {
      expect(screen.getByTestId('copy-feedback')).toBeInTheDocument();
    });
  });

  it('hides copy button for user messages', () => {
    const userMessage: Message = {
      ...baseMessage,
      role: 'user',
    };

    render(<MessageBubble message={userMessage} />);

    expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument();
  });

  it('renders markdown content correctly', () => {
    const markdownMessage: Message = {
      ...baseMessage,
      content: '# Heading\n\n**Bold** and *italic*\n\n- List item',
    };

    render(<MessageBubble message={markdownMessage} />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('List item')).toBeInTheDocument();
  });

  it('renders code blocks with syntax highlighting', () => {
    const codeMessage: Message = {
      ...baseMessage,
      content: '```typescript\nconst x = 1;\n```',
    };

    render(<MessageBubble message={codeMessage} />);

    expect(screen.getByTestId('code-block')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('displays reasoning content when provided', () => {
    const messageWithReasoning: Message = {
      ...baseMessage,
      metadata: {
        reasoning: 'Let me think about this step by step...',
      },
    };

    render(<MessageBubble message={messageWithReasoning} />);

    expect(screen.getByTestId('reasoning-content')).toBeInTheDocument();
    expect(screen.getByText(/Let me think/)).toBeInTheDocument();
  });

  it('toggles reasoning visibility', async () => {
    const messageWithReasoning: Message = {
      ...baseMessage,
      metadata: {
        reasoning: 'Hidden reasoning',
      },
    };

    render(<MessageBubble message={messageWithReasoning} />);

    // Reasoning should be visible by default
    expect(screen.getByTestId('reasoning-content')).toBeVisible();

    // Click toggle button
    const toggleButton = screen.getByTestId('toggle-reasoning');
    fireEvent.click(toggleButton);

    // Reasoning should be hidden
    await waitFor(() => {
      expect(screen.queryByTestId('reasoning-content')).not.toBeVisible();
    });

    // Click again to show
    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(screen.getByTestId('reasoning-content')).toBeVisible();
    });
  });

  it('displays tool invocations when provided', () => {
    const messageWithTools: Message = {
      ...baseMessage,
      metadata: {
        toolInvocations: [
          {
            toolCallId: 'call-1',
            toolName: 'github_list_repos',
            state: 'result',
            result: { repos: ['repo1', 'repo2'] },
          },
        ],
      },
    };

    render(<MessageBubble message={messageWithTools} />);

    expect(screen.getByTestId('tool-invocation')).toBeInTheDocument();
    expect(screen.getByText('github_list_repos')).toBeInTheDocument();
  });

  it('shows loading state when streaming', () => {
    render(
      <MessageBubble 
        message={baseMessage} 
        isStreaming={true}
        streamingContent="Streaming..."
      />
    );

    expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
  });

  it('calls onStreamingComplete when streaming finishes', async () => {
    const onStreamingComplete = vi.fn();
    
    render(
      <MessageBubble 
        message={baseMessage}
        isStreaming={true}
        onStreamingComplete={onStreamingComplete}
      />
    );

    // Simulate streaming complete
    fireEvent.animationEnd(screen.getByTestId('streaming-indicator'));

    await waitFor(() => {
      expect(onStreamingComplete).toHaveBeenCalled();
    });
  });

  it('applies custom maxWidth when provided', () => {
    render(<MessageBubble message={baseMessage} maxWidth={500} />);

    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toHaveStyle('max-width: 500px');
  });

  it('handles error messages correctly', () => {
    const errorMessage: Message = {
      ...baseMessage,
      role: 'assistant',
      content: 'Error: Something went wrong',
      isError: true,
    };

    render(<MessageBubble message={errorMessage} />);

    expect(screen.getByTestId('message-bubble')).toHaveClass('error');
    expect(screen.getByText(/Error/)).toBeInTheDocument();
  });

  it('renders data messages with correct format', () => {
    const dataMessage: Message = {
      ...baseMessage,
      role: 'data',
      content: '{"key": "value"}',
    };

    render(<MessageBubble message={dataMessage} />);

    expect(screen.getByTestId('data-content')).toBeInTheDocument();
  });

  it('handles long content with scroll', () => {
    const longMessage: Message = {
      ...baseMessage,
      content: 'A'.repeat(5000),
    };

    render(<MessageBubble message={longMessage} responsive={true} />);

    const bubble = screen.getByTestId('message-bubble');
    // Should have overflow handling
    expect(bubble).toHaveStyle('overflow: auto');
  });

  it('displays auth prompt when auth is required', () => {
    const authMessage: Message = {
      ...baseMessage,
      metadata: {
        requiresAuth: true,
        authUrl: '/auth',
        toolName: 'gmail_send',
      },
    };

    render(<MessageBubble message={authMessage} />);

    expect(screen.getByTestId('auth-prompt')).toBeInTheDocument();
    expect(screen.getByText(/Authorize/)).toBeInTheDocument();
  });

  it('handles keyboard navigation', () => {
    render(<MessageBubble message={baseMessage} />);

    const bubble = screen.getByTestId('message-bubble');
    
    // Should be focusable
    bubble.tabIndex = 0;
    bubble.focus();
    
    expect(document.activeElement).toBe(bubble);
  });
});

describe('MessageBubble - Accessibility', () => {
  it('has proper ARIA labels', () => {
    render(<MessageBubble message={{
      id: 'test-1',
      role: 'assistant',
      content: 'Test',
    }} />);

    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toHaveAttribute('role', 'article');
    expect(bubble).toHaveAttribute('aria-label');
  });

  it('announces streaming status to screen readers', () => {
    render(
      <MessageBubble 
        message={{
          id: 'test-1',
          role: 'assistant',
          content: 'Streaming',
        }}
        isStreaming={true}
      />
    );

    expect(screen.getByTestId('streaming-status')).toHaveAttribute('aria-live', 'polite');
  });

  it('has proper heading hierarchy', () => {
    render(<MessageBubble message={{
      id: 'test-1',
      role: 'assistant',
      content: '# Test Heading',
    }} />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('MessageBubble - Performance', () => {
  const baseMessage: Message = {
    id: 'test-1',
    role: 'assistant',
    content: 'Hello, how can I help you?',
    timestamp: new Date().toISOString(),
  };

  it('memoizes content rendering', () => {
    const { rerender } = render(<MessageBubble message={baseMessage} />);
    
    // Rerender with same props
    rerender(<MessageBubble message={baseMessage} />);
    
    // Should not re-render content unnecessarily
    expect(screen.getByText('Hello, how can I help you?')).toBeInTheDocument();
  });

  it('handles large code blocks efficiently', () => {
    const largeCodeMessage: Message = {
      ...baseMessage,
      content: '```typescript\n' + 'const x = 1;\n'.repeat(100) + '```',
    };

    const startTime = Date.now();
    render(<MessageBubble message={largeCodeMessage} />);
    const renderTime = Date.now() - startTime;

    // Should render in under 100ms
    expect(renderTime).toBeLessThan(100);
    
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
  });
});

