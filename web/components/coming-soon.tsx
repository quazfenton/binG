/**
 * Coming Soon Component
 * 
 * Displays a placeholder for features that are still in development.
 * Can be disabled via environment variable or prop for development/testing.
 */

"use client";

import { motion } from "framer-motion";
import { Clock, Sparkles, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ComingSoonProps {
  featureName?: string;
  description?: string;
  showInDev?: boolean;
  children?: React.ReactNode;
}

export function ComingSoon({ 
  featureName = "This Feature", 
  description = "We're working hard to bring you something amazing. Stay tuned!",
  showInDev = false,
  children 
}: ComingSoonProps) {
  // Check if we should show the real content (dev mode)
  const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true' || showInDev;

  if (isDevMode && children) {
    return <>{children}</>;
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center max-w-md space-y-6"
      >
        {/* Animated Icon */}
        <div className="relative">
          <motion.div
            animate={{ 
              rotate: 360,
            }}
            transition={{ 
              duration: 20, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="w-32 h-32 mx-auto rounded-full bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center"
          >
            <Clock className="w-12 h-12 text-purple-400" />
          </motion.div>
          
          {/* Sparkles */}
          <motion.div
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{ 
              duration: 2, 
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute -top-2 -right-2"
          >
            <Sparkles className="w-6 h-6 text-yellow-400" />
          </motion.div>
        </div>

        {/* Text Content */}
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-white">
            Coming Soon
          </h2>
          <h3 className="text-lg font-semibold text-purple-300">
            {featureName}
          </h3>
          <p className="text-sm text-white/60">
            {description}
          </p>
        </div>

        {/* Notification Signup */}
        <div className="pt-4 border-t border-white/10">
          <p className="text-xs text-white/50 mb-3">
            Want to be notified when this is ready?
          </p>
          <Button
            variant="outline"
            size="sm"
            className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
          >
            <Bell className="w-4 h-4 mr-2" />
            Notify Me
          </Button>
        </div>

        {/* Dev Mode Indicator */}
        {process.env.NEXT_PUBLIC_DEV_MODE === 'true' && (
          <div className="pt-4 mt-4 border-t border-yellow-500/20">
            <p className="text-xs text-yellow-500/70">
              [DEV] Dev Mode: Real content is available
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
