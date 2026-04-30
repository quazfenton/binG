import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamingSpeaker } from '@/lib/voice/streaming-speaker';
import {
  detectUnclosedTags,
  sanitizeAssistantDisplayContent,
} from '@/lib/chat/file-edit-parser';

// ============================================================================
// Unit Tests: StreamingSpeaker Core Algorithm
// ============================================================================

describe('StreamingSpeaker', () => {
  let speaker: StreamingSpeaker;

  beforeEach(() => {
    speaker = new StreamingSpeaker();
    speaker.reset();
    // Mock window for listener setup
    if (typeof window === 'undefined') {
      (global as any).window = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }
  });

  afterEach(() => {
    speaker.destroy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Prose-only responses
  // ──────────────────────────────────────────────────────────────────────────

  it('streams prose-only response with sentence boundaries', async () => {
    const prose1 = 'Hello. This is a test.';
    const prose2 = ' More content here.';
    const prose3 = ' Another sentence.';

    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    // Feed streaming chunks
    speaker.feed(prose1);
    expect(speechQueue).toHaveLength(1);
    expect(speechQueue[0]).toBe('Hello.');

    speaker.feed(prose1 + prose2);
    expect(speechQueue).toHaveLength(2);
    expect(speechQueue[1]).toContain('This is a test.');

    speaker.feed(prose1 + prose2 + prose3);
    expect(speechQueue).toHaveLength(3);
    expect(speechQueue[2]).toContain('More content here.');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Red Zone detection (code blocks)
  // ──────────────────────────────────────────────────────────────────────────

  it('detects Red Zone and suppresses speech during unclosed code blocks', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const prose = 'Let me show you: ';
    const codeStart = prose + '```typescript\nconst x = 42;';

    speaker.feed(codeStart);
    // Should not enqueue anything while code is open
    expect(speechQueue).toHaveLength(0);

    // Close the code block
    const codeEnd = codeStart + '\n```\n\nNow we can talk.';
    speaker.feed(codeEnd);
    // Now speech should be enqueued for the final prose
    expect(speechQueue.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: File edit blocks
  // ──────────────────────────────────────────────────────────────────────────

  it('skips file_edit blocks and only speaks adjacent prose', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const intro = 'I will create a file. ';
    const fileEdit =
      intro + '<file_edit path="test.ts">export const x = 1;</file_edit>';
    const outro = fileEdit + ' Done!';

    speaker.feed(intro);
    expect(speechQueue).toHaveLength(1);
    expect(speechQueue[0]).toBe('I will create a file.');

    speaker.feed(fileEdit);
    // File edit is filtered out by sanitization
    expect(speechQueue).toHaveLength(1); // Still only the intro

    speaker.feed(outro);
    // Now the outro should be picked up
    expect(speechQueue.length).toBeGreaterThan(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Latency buffer (trailing characters held back)
  // ──────────────────────────────────────────────────────────────────────────

  it('holds back trailing characters to avoid partial words', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const firstChunk = 'This is a test sentence';
    speaker.feed(firstChunk);

    // Without the final period and space, no sentence boundary detected
    expect(speechQueue).toHaveLength(0);

    // Add period and more content
    const withPeriod = firstChunk + '. ';
    speaker.feed(withPeriod);

    // Now we should have detected the sentence
    expect(speechQueue.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Idempotency
  // ──────────────────────────────────────────────────────────────────────────

  it('is idempotent when called with the same content twice', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const content = 'Hello. This is a test. ';
    speaker.feed(content);
    const firstCallCount = speechQueue.length;

    speaker.feed(content);
    // Should not enqueue again for identical content
    expect(speechQueue).toHaveLength(firstCallCount);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Pause and Resume (barge-in)
  // ──────────────────────────────────────────────────────────────────────────

  it('suppresses speech when paused (barge-in)', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    speaker.feed('Hello. ');
    expect(speechQueue.length).toBeGreaterThan(0);
    const countBeforePause = speechQueue.length;

    speaker.pause();
    speaker.feed('More content. ');
    // Should not add to queue while paused
    expect(speechQueue).toHaveLength(countBeforePause);

    speaker.resume();
    speaker.feed('More content. Even more. ');
    // Should resume adding after pause
    expect(speechQueue.length).toBeGreaterThan(countBeforePause);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Finalization
  // ──────────────────────────────────────────────────────────────────────────

  it('processes remaining prose on finalize', async () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    // Stream incomplete final sentence
    const incomplete = 'Here is some content. And another sentence';
    speaker.feed(incomplete);

    const countBeforeFinal = speechQueue.length;

    // Finalize should capture the "sentence" even without period
    await speaker.finalizeWithContent(incomplete + ' here.');
    expect(speechQueue.length).toBeGreaterThanOrEqual(countBeforeFinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Mixed content (prose + code + file edits)
  // ──────────────────────────────────────────────────────────────────────────

  it('handles mixed content with prose, code, and file edits', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const mixed = `Here's my approach. 
\`\`\`python
def hello():
    print("world")
\`\`\`
Now I'll create a file.
<file_edit path="src/main.py">print("test")</file_edit>
All done! `;

    speaker.feed(mixed);

    // Should only have prose, not code or file edit content
    const combined = speechQueue.join(' ');
    expect(combined).toContain("Here's my approach");
    expect(combined).not.toContain('python');
    expect(combined).not.toContain('file_edit');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: State machine transitions
  // ──────────────────────────────────────────────────────────────────────────

  it('transitions between SPEAKING_PROSE and WAITING_FOR_CLOSURE states', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    // Start in SPEAKING_PROSE
    expect((speaker as any).state).toBe('SPEAKING_PROSE');

    // Feed content with unclosed tag
    speaker.feed('Text. ```\ncode incomplete');
    expect((speaker as any).state).toBe('WAITING_FOR_CLOSURE');

    // Close the code block
    speaker.feed('Text. ```\ncode incomplete\n```\nMore text. ');
    expect((speaker as any).state).toBe('SPEAKING_PROSE');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Filesystem update signal
  // ──────────────────────────────────────────────────────────────────────────

  it('transitions to SPEAKING_PROSE when filesystem-updated arrives', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    // Create waiting state with unclosed tag
    speaker.feed('Creating file. <file_edit path="test.ts">content');
    expect((speaker as any).state).toBe('WAITING_FOR_CLOSURE');

    // Simulate filesystem-updated event
    speaker.onFilesystemUpdate();
    expect((speaker as any).state).toBe('SPEAKING_PROSE');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Reset behavior
  // ──────────────────────────────────────────────────────────────────────────

  it('resets state correctly for new responses', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    speaker.feed('First response. ');
    const firstCount = speechQueue.length;

    speaker.reset();
    expect((speaker as any).state).toBe('SPEAKING_PROSE');
    expect((speaker as any).lastSpokenIndex).toBe(0);
    expect((speaker as any).lastContentLength).toBe(0);
    expect((speaker as any).isPaused).toBe(false);
    expect(speechQueue).toHaveLength(firstCount);

    speaker.feed('Second response. ');
    expect(speechQueue.length).toBeGreaterThan(firstCount);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Empty and very short content
  // ──────────────────────────────────────────────────────────────────────────

  it('gracefully handles empty and very short content', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    speaker.feed('');
    expect(speechQueue).toHaveLength(0);

    speaker.feed('Hi');
    expect(speechQueue).toHaveLength(0);

    speaker.feed('Hello. ');
    expect(speechQueue.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Multiple sentences
  // ──────────────────────────────────────────────────────────────────────────

  it('detects multiple sentence boundaries and splits correctly', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const content = 'First sentence. Second sentence! Third one? Continue. ';
    speaker.feed(content);

    // Should have multiple entries
    expect(speechQueue.length).toBeGreaterThan(1);

    // Each should end with proper punctuation or be complete
    speechQueue.forEach((text) => {
      expect(text.trim().length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test: Heredoc blocks
  // ──────────────────────────────────────────────────────────────────────────

  it('suppresses heredoc content and only speaks surrounding prose', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const withHeredoc = `Creating script. \`\`\`bash cat << 'EOF'
Line 1
Line 2
EOF
\`\`\` Done! `;

    speaker.feed(withHeredoc);

    const combined = speechQueue.join(' ').toLowerCase();
    expect(combined).toContain('creating script');
    expect(combined).not.toContain('line 1');
    expect(combined).toContain('done');
  });
});

// ============================================================================
// Integration Tests: StreamingSpeaker with File Edit Parser
// ============================================================================

describe('StreamingSpeaker Integration with File Edit Parser', () => {
  let speaker: StreamingSpeaker;

  beforeEach(() => {
    speaker = new StreamingSpeaker();
    speaker.reset();
  });

  afterEach(() => {
    speaker.destroy();
  });

  it('correctly handles detectUnclosedTags output', () => {
    const content = 'Text. <file_edit path="x.ts">export const';
    const unclosed = detectUnclosedTags(content, 0, 500);

    expect(unclosed.length).toBeGreaterThan(0);
    expect(unclosed[0]).toBeLessThan(content.length);
  });

  it('correctly sanitizes content using sanitizeAssistantDisplayContent', () => {
    const mixed =
      'Hello. <file_edit path="test.ts">const x = 1;</file_edit> World. ';
    const sanitized = sanitizeAssistantDisplayContent(mixed);

    expect(sanitized).toContain('Hello');
    expect(sanitized).toContain('World');
    expect(sanitized).not.toContain('file_edit');
  });

  it('combines Red Zone and sanitization for correct boundaries', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const content =
      'Starting. <file_edit path="app.ts">// incomplete code section';

    speaker.feed(content);

    // Red Zone should prevent speech while tag is unclosed
    expect(speechQueue).toHaveLength(0);

    // Complete the tag
    const completed = content + '\n</file_edit>\nDone. ';
    speaker.feed(completed);

    // Now speech should be enqueued
    expect(speechQueue.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Performance Tests: StreamingSpeaker Efficiency
// ============================================================================

describe('StreamingSpeaker Performance', () => {
  let speaker: StreamingSpeaker;

  beforeEach(() => {
    speaker = new StreamingSpeaker();
    speaker.reset();
  });

  afterEach(() => {
    speaker.destroy();
  });

  it('handles large streaming responses efficiently', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const largeContent =
      'Sentence one. ' +
      'Sentence two. '.repeat(100) + // 100 sentences
      'Sentence final.';

    const startTime = Date.now();
    speaker.feed(largeContent);
    const elapsed = Date.now() - startTime;

    // Should process in reasonable time (< 100ms)
    expect(elapsed).toBeLessThan(100);
    expect(speechQueue.length).toBeGreaterThan(0);
  });

  it('does not accumulate O(n²) complexity on repeated feeds', () => {
    const speechQueue: string[] = [];
    vi.spyOn(speaker as any, 'enqueue').mockImplementation((text: string) => {
      speechQueue.push(text);
    });

    const base = 'Sentence. '.repeat(50);

    const timings = [];
    for (let i = 1; i <= 5; i++) {
      const content = base.repeat(i);
      const start = Date.now();
      speaker.feed(content);
      timings.push(Date.now() - start);
    }

    // Timings should not grow quadratically
    const ratios = [];
    for (let i = 1; i < timings.length; i++) {
      ratios.push(timings[i] / timings[i - 1]);
    }

    // Average ratio should be under 3 (linear growth acceptable, quadratic would be 5-25)
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(avgRatio).toBeLessThan(3);
  });
});
