"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from '@/lib/utils/utils'

// VaulComponent import-level adapter — round-6 winning solution, restored
// from round-7's per-site reversion. The adapter re-types each vaul vX
// forwardRef component as React.ForwardRefExoticComponent<any, any>, so
// downstream ComponentPropsWithoutRef spreads type cleanly WITHOUT per-site
// @ts-expect-error directives. The multi-sibling JSX body in DrawerContent
// (Portal → Overlay + Content siblings) is the canonical regression site
// for per-site patterns — TS@5 next-line semantics don't propagate through
// the multi-sibling tree, so TS2322 surfaces on the <DrawerPrimitive.Content>
// sibling even when the directive sits above the outermost <DrawerPortal>.
// Casting at the import boundary resolves this once for all four forwardRef
// sites (Overlay, Content, Title, Description) without spreading the cast
// across the JSX body.
type VaulForwardRefComponent = React.ForwardRefExoticComponent<any, any>;
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

const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root> & { shouldScaleBackground?: boolean }) => (
  // Q5 hybrid inline-cast at Root ONLY (NOT at the adapter level): the vaul
  // vX Root typedef removed shouldScaleBackground but runtime still respects
  // it. Cast at this single site so the prop envelope is preserved across
  // the Legacy/runtime contract. The import-level VaulComponent adapter
  // handles the four forwardRef sites in a single shot; this inline cast
  // handles the Root prop quirk without forcing the adapter to widen the
  // whole DrawerPrimitive.Root type, which would re-introduce the round-7
  // regression on downstream prop envelopes.
  <VaulComponent.Root
    shouldScaleBackground={shouldScaleBackground as any}
    {...props}
  />
)
Drawer.displayName = "Drawer"

const DrawerTrigger = VaulComponent.Trigger

const DrawerPortal = VaulComponent.Portal

const DrawerClose = VaulComponent.Close

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
