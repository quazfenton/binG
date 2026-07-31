// @vitest-environment jsdom

/**
 * AutoContinueBanner - component tests.
 *
 * Locks the user-facing presentation contract for each reason-literal:
 *   - Title text + body message render verbatim.
 *   - The palette class picks the right Tailwind utility (amber/blue/red/green).
 *   - The counter chip `N/M` shows when continuationsSoFar + maxContinuations
 *     are both provided; turns red-tight when at-cap with a max_* reason.
 *   - The banner hides entirely when `reason` is undefined / null.
 *   - Unknown / forward-compat reasons render the FALLBACK_META.
 *
 * Test stack mirrors the project's existing component tests:
 *   - vitest (describe / it / expect)
 *   - @testing-library/react (render + screen)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutoContinueBanner } from '@/components/chat/auto-continue-banner';

describe('AutoContinueBanner', () => {
  describe('visibility (happy-path / undefined contract)', () => {
    it('renders NOTHING when reason is undefined', () => {
      const { container } = render(<AutoContinueBanner reason={undefined} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders NOTHING when reason is null', () => {
      const { container } = render(<AutoContinueBanner reason={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders NOTHING when reason is empty string', () => {
      const { container } = render(<AutoContinueBanner reason={''} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('per-reason palette + copy', () => {
    it('renders AMBER copy for ramble-no-tools', () => {
      const { container } = render(<AutoContinueBanner reason="ramble-no-tools" />);
      const root = container.firstChild as HTMLElement;
      expect(root.className).toContain('bg-amber');
      expect(screen.getByText('Long response with no action')).toBeTruthy();
      // Regression: body must NOT leak env-var implementation detail.
      expect(root.textContent).not.toContain('AUTO_CONTINUE_RAMBLE_BYTES');
      expect(root.textContent).not.toContain('env-tunable');
    });

    it('renders AMBER copy for read-then-stall', () => {
      const { container } = render(<AutoContinueBanner reason="read-then-stall" />);
      expect((container.firstChild as HTMLElement).className).toContain('bg-amber');
      expect(screen.getByText('Read without follow-up')).toBeTruthy();
    });

    it('renders BLUE copy for file_request_detected', () => {
      const { container } = render(<AutoContinueBanner reason="file_request_detected" />);
      expect((container.firstChild as HTMLElement).className).toContain('bg-blue');
      expect(screen.getByText('Model asked for a file')).toBeTruthy();
    });

    it('renders BLUE copy for continuation_requested', () => {
      const { container } = render(<AutoContinueBanner reason="continuation_requested" />);
      expect((container.firstChild as HTMLElement).className).toContain('bg-blue');
      expect(screen.getByText('Model asked for another turn')).toBeTruthy();
    });

    it('renders BLUE copy for announced-next-step WITHOUT stray backticks', () => {
      // Regression for cycle-2 reviewer flag: template-literal rewrite
      // produced plain double quotes, NOT backticks.
      const { container } = render(<AutoContinueBanner reason="announced-next-step" />);
      const text = (container.firstChild as HTMLElement).textContent ?? '';
      expect(screen.getByText('Model outlined next steps')).toBeTruthy();
      expect(text).not.toContain('`"I\'ll now ...');
      expect(text).toContain(`"I'll now ..."`);
      expect(text).toContain(`"Next I'll ..."`);
    });

    it('renders RED copy for max_continuations_reached', () => {
      const { container } = render(<AutoContinueBanner reason="max_continuations_reached" />);
      expect((container.firstChild as HTMLElement).className).toContain('bg-red');
      expect(screen.getByText('Auto-continuation limit reached')).toBeTruthy();
    });

    it('renders RED copy for failure_plan_loop', () => {
      const { container } = render(<AutoContinueBanner reason="failure_plan_loop" />);
      expect((container.firstChild as HTMLElement).className).toContain('bg-red');
      expect(screen.getByText('Chat-loop circuit breaker triggered')).toBeTruthy();
    });

    it('renders GREEN copy for agent_stop (happy-path)', () => {
      const { container } = render(<AutoContinueBanner reason="agent_stop" />);
      expect((container.firstChild as HTMLElement).className).toContain('bg-emerald');
      expect(screen.getByText('Stopped by agent')).toBeTruthy();
    });
  });

  describe('counter chip N/M', () => {
    it('renders counter chip N/M when both continuationsSoFar and maxContinuations are provided', () => {
      render(
        <AutoContinueBanner
          reason="ramble-no-tools"
          continuationsSoFar={2}
          maxContinuations={3}
        />,
      );
      expect(screen.getByText('2/3')).toBeTruthy();
    });

    it('renders counter chip with red class when at-cap and reason is max_continuations_reached', () => {
      render(
        <AutoContinueBanner
          reason="max_continuations_reached"
          continuationsSoFar={3}
          maxContinuations={3}
        />,
      );
      const chip = screen.getByText('3/3');
      expect(chip.className).toContain('bg-red-500/20');
      expect(chip.className).toContain('text-red-300');
      expect(chip.getAttribute('title')).toContain(
        'auto-continuation counter',
      );
    });

    it('renders counter chip with red class when at-cap and reason is max_iterations', () => {
      render(
        <AutoContinueBanner
          reason="max_iterations"
          continuationsSoFar={4}
          maxContinuations={3}
        />,
      );
      const chip = screen.getByText('4/3');
      expect(chip.className).toContain('bg-red-500/20');
    });

    it('does NOT render counter chip when continuationsSoFar is missing', () => {
      const { container } = render(
        <AutoContinueBanner reason="ramble-no-tools" maxContinuations={3} />,
      );
      expect((container.firstChild as HTMLElement).textContent ?? '').not.toMatch(/\d+\/\d+/);
    });

    it('does NOT render counter chip when maxContinuations is missing', () => {
      const { container } = render(
        <AutoContinueBanner reason="ramble-no-tools" continuationsSoFar={2} />,
      );
      expect((container.firstChild as HTMLElement).textContent ?? '').not.toMatch(/\d+\/\d+/);
    });
  });

  describe('forward-compat fallback for unknown reason literals', () => {
    it('renders FALLBACK_META for unknown reasons (forward-compat)', () => {
      const { container } = render(
        <AutoContinueBanner reason={'future-bucket-x' as any} />,
      );
      expect(screen.getByText('Auto-continuation triggered')).toBeTruthy();
      expect((container.firstChild as HTMLElement).className).toContain('bg-blue');
    });
  });

  describe('className prop injection', () => {
    it('appends caller-supplied className to the wrap class', () => {
      const { container } = render(
        <AutoContinueBanner
          reason="ramble-no-tools"
          className="sticky top-2 z-50"
        />,
      );
      const root = container.firstChild as HTMLElement;
      expect(root.className).toContain('sticky');
      expect(root.className).toContain('top-2');
      expect(root.className).toContain('z-50');
      expect(root.className).toContain('bg-amber');
    });
  });
});
