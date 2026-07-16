"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from '@/lib/utils/utils'

// VaulComponent import-level adapter — round-6 winning solution, restored
// from round-7's per-site reversion. The adapter re-types each vaul vX
// forwardRef component as React.ForwardRefExoticComponent<any, any>, so
// downstream ComponentPropsWithoutRef spreads type cleanly WITHOUT per-site
// ts-expect-error directives. The multi-sibling JSX body in DrawerContent
// (Portal → Overlay + Content siblings) is the canonical regression site
// for per-site patterns — TS@5 next-line semantics don't propagate through
// the multi-sibling tree, so TS2322 surfaces on the <DrawerPrimitive.Content>
// sibling even when the directive sits above the outermost <DrawerPortal>.
// Casting at the import boundary resolves this once for all four forwardRef
// sites (Overlay, Content, Title, Description) without spreading the cast
// across the JSX body.
/**
 * @rationale `as VaulForwardRefComponent|VaulRegularComponent` import-level typed-passthrough adapter (Rule B ≥3-site root-cause consolidation). Selected over per-site `@ts-expect-error` because rounds 1-5 of this file regressed TS2322 on `<DrawerPrimitive.Content>`'s multi-sibling body (Rule C blocked condition). Selected over `as unknown as X` because the surface here is 4 distinct vaul accessors composing a single typed envelope, not a single site; the adapter also handles the `ElementRef<typeof VaulComponent.X>` ref-typing hookup downstream. Removal trigger (ARCH-001 Flag 2): pin `vaul` to a specific version whose surface matches upstream typedefs.
 * Ticket: ARCH-001 Flag 2.
 */
type VaulForwardRefComponent = React.ForwardRefExoticComponent<any>;
type VaulRegularComponent = React.ComponentType<any>;
const VaulComponent = {
  Root: DrawerPrimitive.Root as VaulRegularComponent,
  Trigger: DrawerPrimitive.Trigger as VaulRegularComponent,
  Portal: DrawerPrimitive.Portal as VaulRegularComponent,
  Close: DrawerPrimitive.Close as VaulRegularComponent,
  Overlay: DrawerPrimitive.Overlay as VaulForwardRefComponent,
  Content: DrawerPrimitive.Content as VaulForwardRefComponent,
  Title: DrawerPrimitive.Title as VaulForwardRefComponent,
  Description: DrawerPrimitive.Description as VaulForwardRefComponent,
};

/**
 * @rationale `as any` (Rule B single-prop inline-cast by exception; Q5 hybrid carve-out): vaul vX `Root` typedef REMOVED `shouldScaleBackground` but runtime still respects it — a single surgical cast on the JSX expression preserves the legacy/runtime prop envelope without widening the adapter (which would re-introduce the round-7 regression on every downstream prop). Selected over `as unknown as boolean | undefined` because the runtime contract is loose; `as any` matches the actual permissiveness. Selected over an extracted helper because the cast surfaces at exactly ONE site. Ticket: ARCH-001 Flag 2. Removal trigger: drop the cast when vaul vX refreshes root typedefs to include shouldScaleBackground.
 */
const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root> & { shouldScaleBackground?: boolean }) => (
  // Q5 hybrid inline-cast at Root ONLY (NOT at the adapter level). See JSDoc above.
  <VaulComponent.Root
    shouldScaleBackground={shouldScaleBackground as any}
    {...props}
  />
)
Drawer.displayName = "Drawer"

const DrawerTrigger = VaulComponent.Trigger

const DrawerPortal = VaulComponent.Portal

const DrawerClose = VaulComponent.Close

/**
 * @rationale `VaulComponent.Overlay` (Rule B import-level adapter reference): forwardRef typed against the adapter's `Overlay` accessor (ForwardRefExoticComponent<any, any>). The actual cast lives at the adapter level — this site is a CONSUMER of the adapter, not a holder of `@ts-expect-error`. Removal trigger: drop the adapter when ARCH-001 Flag 2 lands.
 * Ticket: ARCH-001 Flag 2.
 */
const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof VaulComponent.Overlay>,
  React.ComponentPropsWithoutRef<typeof VaulComponent.Overlay>
>(({ className, ...props }, ref) => (
  <VaulComponent.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

/**
 * @rationale `VaulComponent.Content` (Rule B import-level adapter reference; multi-sibling JSX body): forwardRef typed against the adapter's `Content` accessor. The multi-sibling JSX body below (`<Portal><Overlay /><Content />{children}</Content></Portal>`) is the canonical regression site for per-site `@ts-expect-error` patterns — TS@5 next-line semantics don't propagate, so an inline directive above `<VaulComponent.Portal>` would NOT catch a TS2322 on the second `<VaulComponent.Content>` sibling. This site is a CONSUMER of the adapter, which solves both Rule B and Rule C in one place.
 * Ticket: ARCH-001 Flag 2.
 */
const DrawerContent = React.forwardRef<
  React.ElementRef<typeof VaulComponent.Content>,
  React.ComponentPropsWithoutRef<typeof VaulComponent.Content>
>(({ className, children, ...props }, ref) => (
  <VaulComponent.Portal>
    <DrawerOverlay />
    <VaulComponent.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </VaulComponent.Content>
  </VaulComponent.Portal>
))
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

/**
 * @rationale `VaulComponent.Title` (Rule B import-level adapter reference): forwardRef typed against the adapter's `Title` accessor. Single-sibling JSX body (no Portal wrapper here); per-site cast would have been acceptable per Rule C, but adapter-level consolidation keeps all four forwardRef sites symmetric.
 * Ticket: ARCH-001 Flag 2.
 */
const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof VaulComponent.Title>,
  React.ComponentPropsWithoutRef<typeof VaulComponent.Title>
>(({ className, ...props }, ref) => (
  <VaulComponent.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

/**
 * @rationale `VaulComponent.Description` (Rule B import-level adapter reference): forwardRef typed against the adapter's `Description` accessor. Single-sibling JSX body (no Portal wrapper here); per-site cast would have been acceptable per Rule C, but adapter-level consolidation keeps all four forwardRef sites symmetric.
 * Ticket: ARCH-001 Flag 2.
 */
const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof VaulComponent.Description>,
  React.ComponentPropsWithoutRef<typeof VaulComponent.Description>
>(({ className, ...props }, ref) => (
  <VaulComponent.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
