'use client';

import React, { useState } from 'react';
import { useWorkflow } from '@/context/workflow-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { DAGViewer } from './dag-viewer';
import { DAGViewerEnhanced } from './dag-viewer-enhanced';
import { Sparkles, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';

const examplePrompts = [
  'When a critical bug is filed in Jira, create a GitHub branch, notify the on-call engineer in Slack, and update the incident tracker',
  'When a PR is opened in GitHub, run security scan, notify reviewers in Slack, and create a Jira ticket for tracking',
  'Monitor database for new orders, send Slack notification to sales team, and log to analytics',
];

export function PromptZone() {
  const { generateDAG, isGenerating, currentWorkflow, clearWorkflow } = useWorkflow();
  const [prompt, setPrompt] = useState('');
  const [useEnhancedView, setUseEnhancedView] = useState(true);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    await generateDAG(prompt);
  };

  const handleExampleClick = (example: string) => {
    setPrompt(example);
  };

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">Workflow Designer</h2>
          <p className="text-sm text-content-secondary mt-0.5">
            Describe your workflow in natural language
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUseEnhancedView(!useEnhancedView)}
            leftIcon={useEnhancedView ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
          >
            {useEnhancedView ? 'Enhanced DAG' : 'Classic DAG'}
          </Button>
          {currentWorkflow && (
            <Button variant="ghost" size="sm" onClick={clearWorkflow} leftIcon={<Trash2 className="h-4 w-4" />}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="space-y-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your workflow... e.g., 'When a critical bug is created in Jira, create a GitHub branch, notify the on-call engineer in Slack, and update the tracking sheet'"
          className="min-h-[100px] resize-none"
        />

        {/* Example prompts */}
        {!currentWorkflow && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-content-tertiary">Examples:</span>
            {examplePrompts.map((example, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(example)}
                className="text-xs text-primary hover:text-primary-hover hover:underline truncate max-w-[300px]"
              >
                {example.slice(0, 50)}...
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={!prompt.trim() || isGenerating}
            leftIcon={<Sparkles className="h-4 w-4" />}
          >
            Generate DAG
          </Button>
        </div>
      </div>

      {/* DAG Viewer */}
      {useEnhancedView ? <DAGViewerEnhanced /> : <DAGViewer />}
    </Card>
  );
}
