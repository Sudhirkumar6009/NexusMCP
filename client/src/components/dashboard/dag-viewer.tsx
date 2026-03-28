'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useWorkflow } from '@/context/workflow-context';
import { DAGNode as DAGNodeComponent } from './dag-node';
import { cn } from '@/lib/utils';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DAGViewer() {
  const {
    currentWorkflow,
    selectedNodeId,
    selectNode,
    updateNodePosition,
    isExecuting,
  } = useWorkflow();

  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });

  // Handle zoom
  const handleZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.5), 2));
  }, []);

  // Reset view
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Fit to view
  const fitToView = useCallback(() => {
    if (!currentWorkflow || !containerRef.current) return;
    
    const nodes = currentWorkflow.nodes;
    if (nodes.length === 0) return;

    const minX = Math.min(...nodes.map((n) => n.position.x));
    const maxX = Math.max(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxY = Math.max(...nodes.map((n) => n.position.y));

    const contentWidth = maxX - minX + 200;
    const contentHeight = maxY - minY + 150;
    
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const scaleX = containerWidth / contentWidth;
    const scaleY = containerHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1) * 0.9;

    setZoom(scale);
    setPan({
      x: (containerWidth - contentWidth * scale) / 2 - minX * scale + 100,
      y: (containerHeight - contentHeight * scale) / 2 - minY * scale + 50,
    });
  }, [currentWorkflow]);

  // Pan handling
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('dag-canvas')) {
        setIsPanning(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        selectNode(null);
      }
    },
    [pan, selectNode]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      } else if (draggingNodeId) {
        const newX = (e.clientX - nodeDragOffset.x - pan.x) / zoom;
        const newY = (e.clientY - nodeDragOffset.y - pan.y) / zoom;
        updateNodePosition(draggingNodeId, { x: newX, y: newY });
      }
    },
    [isPanning, dragStart, draggingNodeId, nodeDragOffset, pan, zoom, updateNodePosition]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDraggingNodeId(null);
  }, []);

  // Node drag handling
  const handleNodeDragStart = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (isExecuting) return;
      
      const node = currentWorkflow?.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      setDraggingNodeId(nodeId);
      setNodeDragOffset({
        x: e.clientX - (node.position.x * zoom + pan.x),
        y: e.clientY - (node.position.y * zoom + pan.y),
      });
      selectNode(nodeId);
    },
    [currentWorkflow, zoom, pan, selectNode, isExecuting]
  );

  // Auto-fit on first load
  useEffect(() => {
    if (currentWorkflow?.nodes.length) {
      fitToView();
    }
  }, [currentWorkflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentWorkflow) {
    return (
      <div className="flex items-center justify-center h-80 border border-dashed border-border rounded-lg bg-surface-primary">
        <p className="text-content-tertiary text-sm">
          Generate a workflow to see the DAG visualization
        </p>
      </div>
    );
  }

  const { nodes, edges } = currentWorkflow;

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-surface-primary border border-border rounded-lg p-1">
        <Button variant="ghost" size="sm" onClick={() => handleZoom(0.1)} className="h-8 w-8 p-0">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleZoom(-0.1)} className="h-8 w-8 p-0">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" onClick={fitToView} className="h-8 w-8 p-0">
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={resetView} className="h-8 w-8 p-0">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <span className="text-xs text-content-secondary px-2 min-w-[50px] text-center">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={cn(
          'relative h-80 border border-border rounded-lg bg-surface-primary overflow-hidden',
          isPanning ? 'cursor-grabbing' : 'cursor-grab',
          draggingNodeId && 'cursor-move'
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Grid background */}
        <div
          className="dag-canvas absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle, var(--border-color) 1px, transparent 1px)`,
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        />

        {/* SVG for edges */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                className="fill-content-tertiary"
              />
            </marker>
            <marker
              id="arrowhead-active"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                className="fill-primary"
              />
            </marker>
          </defs>
          {edges.map((edge) => {
            const sourceNode = nodes.find((n) => n.id === edge.source);
            const targetNode = nodes.find((n) => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;

            const sourceX = sourceNode.position.x + 75; // Node width / 2
            const sourceY = sourceNode.position.y + 40; // Node height
            const targetX = targetNode.position.x + 75;
            const targetY = targetNode.position.y;

            // Calculate control points for bezier curve
            const midY = (sourceY + targetY) / 2;

            const isActive = sourceNode.status === 'running' || targetNode.status === 'running';

            return (
              <g key={edge.id}>
                <path
                  d={`M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`}
                  fill="none"
                  className={cn(
                    'stroke-2',
                    isActive ? 'stroke-primary' : 'stroke-content-tertiary/40'
                  )}
                  markerEnd={isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                />
                {edge.label && (
                  <text
                    x={(sourceX + targetX) / 2}
                    y={midY - 5}
                    className="fill-content-secondary text-xs"
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {nodes.map((node) => (
            <DAGNodeComponent
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              onSelect={() => selectNode(node.id)}
              onDragStart={(e) => handleNodeDragStart(node.id, e)}
              isDragging={draggingNodeId === node.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
