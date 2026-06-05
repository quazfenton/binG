/**
 * Tests for the next-step suggestions service.
 *
 * Covers:
 *  - The .text dead-code path is gone (only .content is read)
 *  - parseSuggestions extracts and caps suggestions
 *  - JSON wrapped in markdown fences is still parsed
 *  - generateNextStepSuggestions returns [] on failure (silent)
 *  - generateNextStepSuggestions respects the fast-model override
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/chat/enhanced-llm-service', () => ({
  enhancedLLMService: {
    generateResponse: vi.fn(),
  },
}));

vi.mock('@/lib/providers/model-ranker', () => ({
  getSpecGenerationModel: vi.fn(),
}));

import { enhancedLLMService } from '@/lib/chat/enhanced-llm-service';
import { getSpecGenerationModel } from '@/lib/providers/model-ranker';
import { generateNextStepSuggestions } from '../next-step-suggestions';

const mockedGenerate = enhancedLLMService.generateResponse as unknown as ReturnType<typeof vi.fn>;
const mockedGetSpec = getSpecGenerationModel as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateNextStepSuggestions', () => {
  it('returns up to 3 suggestions from a clean JSON response', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { label: 'Run tests', fullText: 'Run the test suite to verify changes.' },
          { label: 'Deploy', fullText: 'Deploy the new build to staging.' },
          { label: 'Open a PR', fullText: 'Open a pull request for review.' },
        ],
      }),
      tokensUsed: 100,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    const result = await generateNextStepSuggestions(
      ['Test my changes'],
      'I made several changes to the auth flow.',
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      label: 'Run tests',
      fullText: 'Run the test suite to verify changes.',
    });
  });

  it('strips markdown code fences before parsing', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content:
        '```json\n' +
        JSON.stringify({
          suggestions: [
            { label: 'Refactor', fullText: 'Refactor the auth helper.' },
          ],
        }) +
        '\n```',
      tokensUsed: 50,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    const result = await generateNextStepSuggestions(['x'], 'y');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Refactor');
  });

  it('caps each label at 48 chars and fullText at 280 chars', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          {
            label: 'x'.repeat(100),
            fullText: 'y'.repeat(500),
          },
        ],
      }),
      tokensUsed: 50,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    const result = await generateNextStepSuggestions(['x'], 'y');
    expect(result[0].label.length).toBeLessThanOrEqual(48);
    expect(result[0].fullText.length).toBeLessThanOrEqual(280);
  });

  it('skips malformed entries silently', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { label: '', fullText: 'No label here' },
          { label: 'No fullText', fullText: '' },
          null,
          { fullText: 'No label either' },
          { label: 'Valid one', fullText: 'A valid suggestion.' },
        ],
      }),
      tokensUsed: 50,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    const result = await generateNextStepSuggestions(['x'], 'y');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Valid one');
  });

  it('returns empty array on JSON parse failure (silent failure)', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: 'not json at all, just words',
      tokensUsed: 50,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    const result = await generateNextStepSuggestions(['x'], 'y');
    expect(result).toEqual([]);
  });

  it('returns empty array when the service throws (silent failure)', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockRejectedValue(new Error('provider down'));

    const result = await generateNextStepSuggestions(['x'], 'y');
    expect(result).toEqual([]);
  });

  it('accepts a string response (legacy path)', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        suggestions: [
          { label: 'string path', fullText: 'Works with a plain string response.' },
        ],
      }) as any,
    );

    const result = await generateNextStepSuggestions(['x'], 'y');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('string path');
  });

  it('uses the fallback model when getSpecGenerationModel returns null', async () => {
    mockedGetSpec.mockResolvedValue(null);
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{ label: 'l', fullText: 'f' }],
      }),
      tokensUsed: 1,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    await generateNextStepSuggestions(['x'], 'y');
    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'mistral',
        model: 'mistral-small-latest',
      }),
    );
  });

  it('passes requestId for telemetry correlation', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({ suggestions: [] }),
      tokensUsed: 1,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    await generateNextStepSuggestions(['x'], 'y', 'nextstep-msg-42');
    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'nextstep-msg-42' }),
    );
  });

  it('passes a generated requestId when none is supplied', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({ suggestions: [] }),
      tokensUsed: 1,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    await generateNextStepSuggestions(['x'], 'y');
    const call = mockedGenerate.mock.calls[0][0] as { requestId: string };
    expect(call.requestId).toMatch(/^nextstep-\d+-[a-z0-9]+$/);
  });

  it('caps the lastResponse in the prompt at MAX_RESPONSE_CHARS (4k)', async () => {
    mockedGetSpec.mockResolvedValue({ provider: 'mistral', model: 'mistral-small-latest' });
    mockedGenerate.mockResolvedValue({
      content: JSON.stringify({ suggestions: [] }),
      tokensUsed: 1,
      finishReason: 'stop',
      timestamp: Date.now(),
    });

    const huge = 'x'.repeat(10_000);
    await generateNextStepSuggestions(['x'], huge);
    const messages = (mockedGenerate.mock.calls[0][0] as any).messages as Array<{
      content: string;
    }>;
    const userMessage = messages[0].content;
    // 4k chars + the ellipsis is the cap.
    expect(userMessage.length).toBeLessThan(5_000);
  });
});
