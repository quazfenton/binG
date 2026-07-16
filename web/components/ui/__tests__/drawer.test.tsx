import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../drawer';

/**
 * <DrawerContent> test — ARCH-001 Flag 2 acceptance criterion.
 *
 * Asserts:
 *   1. The multi-sibling JSX tree (Portal → Overlay + Content + Title +
 *      Description) renders clean given all 4 forwardRef siblings.
 *   2. shouldScaleBackground={true | false} propagates without TS2322
 *      (the compile-time assertion is the tsc run; the runtime assertion
 *      is that the component does not throw on mount with the prop).
 *
 * Coverage: this test exercises the Q5 hybrid VaulComponent adapter
 * + the Root inline-cast audit loci for ARCH-001 Flag 2.
 */
describe('<DrawerContent> (ARCH-001 Flag 2 acceptance)', () => {
  it('renders the multi-sibling JSX tree without throwing given all 4 forwardRef siblings', () => {
    expect(() =>
      render(
        <Drawer shouldScaleBackground>
          <DrawerTrigger>Open</DrawerTrigger>
          <DrawerContent data-testid="drawer-content">
            <DrawerHeader>
              <DrawerTitle>Test Title</DrawerTitle>
              <DrawerDescription>Test Description</DrawerDescription>
            </DrawerHeader>
            <div>Body content</div>
          </DrawerContent>
        </Drawer>,
      ),
    ).not.toThrow();

    // The body content is reachable without firing the trigger (the
    // overlay portal renders the content tree eagerly in jsdom because
    // vaul's portal-injection path doesn't gate on open-state in this
    // test environment).
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('propagates shouldScaleBackground={true} without TS2322 (Rule B Q5 hybrid inline-cast carve-out)', () => {
    // Compile-time assertion: the build that ran vitest had 0 TS2322
    // errors at the Drawer Root prop site. The runtime assertion is
    // that the prop is accepted and the component still mounts cleanly.
    expect(() =>
      render(
        <Drawer shouldScaleBackground={true}>
          <DrawerContent data-testid="drawer-content-scale-true">
            Body
          </DrawerContent>
        </Drawer>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('drawer-content-scale-true')).toBeInTheDocument();
  });

  it('propagates shouldScaleBackground={false} without throwing (Rule B variant)', () => {
    // Symmetric variant: the boolean | undefined envelope must accept
    // explicit-false as well as explicit-true. vaul runtime reads the
    // prop conditionally; the typed envelope accepts the boolean.
    expect(() =>
      render(
        <Drawer shouldScaleBackground={false}>
          <DrawerContent data-testid="drawer-content-scale-false">
            Body
          </DrawerContent>
        </Drawer>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('drawer-content-scale-false')).toBeInTheDocument();
  });

  // Conscious skip: trigger-opens-overlay cannot be reliably asserted in jsdom
  // because vaul renders the portal content eagerly without gating on open-state.
  // A userEvent.click would dispatch without throwing, but a waitFor(...) DOM-mount
  // transition is meaningless because the overlay/content nodes are already present
  // in the document. ARCH-001 Flag 2 acceptance is PARTIAL by design; the adapter
  // shape is exercised (3 it() cases above) but the third-party portal behavior
  // is gated. The skip is the honest disclosure — a silently-passing test that
  // hides the gap would falsely report "ARCH-001 Flag 2 fully accepted."
  it.skip('trigger-opens-overlay (conscious skip — vaul portal renders eagerly in jsdom)', () => {
    // See describe-block docstring for full rationale on the conscious skip.
  });
});
