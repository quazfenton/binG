import React, { useState } from "react";
import MultiModelComparison from "@/components/multi-model-comparison";
import type { LLMProvider } from "@/lib/chat/providers";

export default function ModelComparisonTab() {
  const [isOpen, setIsOpen] = useState(true);
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>([]);

  // Load available LLM providers
  React.useEffect(() => {
    const loadProviders = async () => {
      try {
        const response = await fetch('/api/providers');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.providers) {
            setAvailableProviders(data.data.providers);
          }
        }
      } catch (error) {
        console.error('Failed to load LLM providers:', error);
        setAvailableProviders([]);
      }
    };
    loadProviders();
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <MultiModelComparison
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          availableProviders={availableProviders}
        />
      </div>
    </div>
  );
}