/**
 * GitHub Pull Request Creator Component
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { GitPullRequest, X, Loader2, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface CreatePullRequestProps {
  onSuccess?: (prUrl: string) => void;
  onCancel?: () => void;
  defaultBranch?: string;
  baseBranch?: string;
}

export default function CreatePullRequest({ 
  onSuccess, 
  onCancel,
  defaultBranch = 'main',
  baseBranch = 'main',
}: CreatePullRequestProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [headBranch, setHeadBranch] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    if (!headBranch.trim()) {
      toast.error('Source branch is required');
      return;
    }

    try {
      setIsCreating(true);

      const response = await fetch('/api/integrations/github/source-control/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body: description,
          head: headBranch,
          base: baseBranch,
          draft: isDraft,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create pull request');
      }

      toast.success('Pull request created!', {
        description: `#${data.pr.number}: ${data.pr.title}`,
        action: {
          label: 'Open on GitHub',
          onClick: () => window.open(data.pr.html_url, '_blank'),
        },
      });

      onSuccess?.(data.pr.html_url);
    } catch (error: any) {
      toast.error('Failed to create pull request', {
        description: error.message,
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-4 space-y-4 bg-black/40 backdrop-blur-xl rounded-xl border border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-5 h-5 text-purple-400" />
          <h3 className="text-white font-medium">Create Pull Request</h3>
        </div>
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm text-gray-400 mb-1.5 block">
            Title <span className="text-red-400">*</span>
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Add new feature"
            className="bg-gray-900 border-gray-700 text-white"
          />
        </div>

        <div>
          <label className="text-sm text-gray-400 mb-1.5 block">
            Description
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your changes..."
            className="bg-gray-900 border-gray-700 text-white min-h-[100px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">
              Source Branch <span className="text-red-400">*</span>
            </label>
            <Input
              value={headBranch}
              onChange={(e) => setHeadBranch(e.target.value)}
              placeholder={defaultBranch}
              className="bg-gray-900 border-gray-700 text-white"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">
              Base Branch
            </label>
            <Input
              value={baseBranch}
              placeholder={defaultBranch}
              className="bg-gray-900 border-gray-700 text-white"
              disabled
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="draft-pr"
            checked={isDraft}
            onChange={(e) => setIsDraft(e.target.checked)}
            className="w-4 h-4 rounded border-gray-700 bg-gray-900 text-purple-500 focus:ring-purple-500/20"
          />
          <label htmlFor="draft-pr" className="text-sm text-gray-300">
            Create as draft pull request
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleCreate}
            disabled={isCreating || !title.trim() || !headBranch.trim()}
            className="flex-1 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 text-white"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <GitPullRequest className="w-4 h-4 mr-2" />
                Create Pull Request
              </>
            )}
          </Button>
          
          {onCancel && (
            <Button
              variant="outline"
              onClick={onCancel}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </Button>
          )}
        </div>

        {isDraft && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
            <EyeOff className="w-3 h-3" />
            <span>Draft PRs are not ready for review and won't notify reviewers</span>
          </div>
        )}
      </div>
    </div>
  );
}
