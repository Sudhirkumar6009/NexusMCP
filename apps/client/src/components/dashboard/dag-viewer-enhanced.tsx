'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflow } from '@/context/workflow-context';
import { cn } from '@/lib/utils';
import { Play, RotateCcw, ChevronRight } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface PhaseGroup {
  label: string;
  y: number;
  h: number;
  fill: string;
  stroke: string;
}

interface ServiceConfig {
  name: string;
  dot: string;
  border: string;
  label_bg: string;
}

interface DAGNodeConfig {
  id: string;
  l: number; // layer index
  cx: number; // horizontal center
  w: number; // width
  label: string;
  sub: string;
  svc: keyof typeof SERVICE_PALETTE;
  d: {
    Tool: string;
    Input: string;
    Output: string;
  };
}

interface DAGEdgeConfig {
  f: string; // from
  t: string; // to
  lb: string; // label
  dashed: boolean;
}

type NodeState = 'idle' | 'running' | 'complete' | 'waiting' | 'failed';

// ============================================================================
// LAYOUT CONSTANTS
// ============================================================================

const VIEW_WIDTH = 860;
const VIEW_HEIGHT = 600;
const LAYER_Y = [78, 208, 344, 476]; // layer Y centers
const NODE_HEIGHT = 52;
const NODE_RADIUS = 8;

// ============================================================================
// PHASE GROUPS (Stage bands)
// ============================================================================

const PHASES: PhaseGroup[] = [
  { label: 'TRIGGER', y: 46, h: 64, fill: 'rgba(216,90,48,.06)', stroke: 'rgba(216,90,48,.22)' },
  { label: 'PARALLEL FAN-OUT', y: 178, h: 60, fill: 'rgba(136,135,128,.05)', stroke: 'rgba(136,135,128,.14)' },
  { label: 'GATE & SYNC', y: 314, h: 60, fill: 'rgba(186,117,23,.07)', stroke: 'rgba(186,117,23,.22)' },
  { label: 'EXECUTE', y: 444, h: 64, fill: 'rgba(29,158,117,.06)', stroke: 'rgba(29,158,117,.22)' },
];

// ============================================================================
// SERVICE PALETTE
// ============================================================================

const SERVICE_PALETTE: Record<string, ServiceConfig> = {
  jira: { name: 'JIRA', dot: '#D85A30', border: '#993C1D', label_bg: 'rgba(216,90,48,.18)' },
  github: { name: 'GITHUB', dot: '#1D9E75', border: '#0F6E56', label_bg: 'rgba(29,158,117,.18)' },
  slack: { name: 'SLACK', dot: '#7F77DD', border: '#534AB7', label_bg: 'rgba(127,119,221,.18)' },
  sheets: { name: 'SHEETS', dot: '#EF9F27', border: '#854F0B', label_bg: 'rgba(239,159,39,.18)' },
  orch: { name: 'ORCH', dot: '#378ADD', border: '#185FA5', label_bg: 'rgba(55,138,221,.18)' },
};

// ============================================================================
// DEFAULT NODE DEFINITIONS (LLM Workflow example)
// ============================================================================

const DEFAULT_NODES: DAGNodeConfig[] = [
  {
    id: 'trig',
    l: 0,
    cx: 430,
    w: 200,
    label: 'Bug filed in Jira',
    sub: 'Webhook \u00b7 P1 \u00b7 issue_type=bug',
    svc: 'jira',
    d: { Tool: 'jira_get_issue', Input: 'issue_id: BUG-4821', Output: 'title, priority, reporter' },
  },
  {
    id: 'gh',
    l: 1,
    cx: 160,
    w: 170,
    label: 'Create branch',
    sub: 'fix/BUG-4821 \u2190 main',
    svc: 'github',
    d: { Tool: 'github_create_branch', Input: 'base: main', Output: 'branch_sha, url' },
  },
  {
    id: 'slack',
    l: 1,
    cx: 400,
    w: 170,
    label: 'Notify on-call',
    sub: 'Slack \u00b7 #incidents',
    svc: 'slack',
    d: { Tool: 'slack_post_message', Input: 'channel, text', Output: 'msg_ts, thread_ts' },
  },
  {
    id: 'sheet',
    l: 1,
    cx: 670,
    w: 170,
    label: 'Log to tracker',
    sub: 'Google Sheets \u00b7 append',
    svc: 'sheets',
    d: { Tool: 'sheets_append_row', Input: 'sheet_id, row_data', Output: 'row_index, range' },
  },
  {
    id: 'appr',
    l: 2,
    cx: 258,
    w: 192,
    label: '\u2691  Approval gate',
    sub: 'Requires human confirmation',
    svc: 'orch',
    d: { Tool: 'orchestrator_approve', Input: 'requires: [gh, slack]', Output: 'approved_by, timestamp' },
  },
  {
    id: 'jupd',
    l: 2,
    cx: 600,
    w: 192,
    label: 'Update Jira status',
    sub: 'Set In Progress + assignee',
    svc: 'jira',
    d: { Tool: 'jira_update_issue', Input: 'status, assignee', Output: 'updated_at, changelog' },
  },
  {
    id: 'dep',
    l: 3,
    cx: 415,
    w: 210,
    label: 'Deploy hotfix',
    sub: 'GitHub Actions \u00b7 workflow_dispatch',
    svc: 'github',
    d: { Tool: 'github_dispatch_workflow', Input: 'workflow: hotfix.yml, ref', Output: 'run_id, run_url' },
  },
];

// ============================================================================
// EDGE DEFINITIONS
// ============================================================================

const DEFAULT_EDGES: DAGEdgeConfig[] = [
  { f: 'trig', t: 'gh', lb: 'issue_id', dashed: false },
  { f: 'trig', t: 'slack', lb: 'title', dashed: false },
  { f: 'trig', t: 'sheet', lb: 'url', dashed: false },
  { f: 'gh', t: 'appr', lb: 'branch', dashed: false },
  { f: 'slack', t: 'appr', lb: 'msg_ts', dashed: false },
  { f: 'sheet', t: 'jupd', lb: 'row_id', dashed: false },
  { f: 'appr', t: 'dep', lb: 'approved', dashed: false },
  { f: 'jupd', t: 'dep', lb: 'assignee', dashed: true },
];

// Execution layers (parallelism within each group)
const EXEC_LAYERS = [['trig'], ['gh', 'slack', 'sheet'], ['appr', 'jupd'], ['dep']];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const getNode = (nodes: DAGNodeConfig[], id: string) => nodes.find((n) => n.id === id);
const layerY = (node: DAGNodeConfig) => LAYER_Y[node.l];
const nodeTop = (node: DAGNodeConfig) => layerY(node) - NODE_HEIGHT / 2;
const nodeBot = (node: DAGNodeConfig) => layerY(node) + NODE_HEIGHT / 2;

// Generate bezier path for edge
const generateEdgePath = (nodes: DAGNodeConfig[], edge: DAGEdgeConfig): string => {
  const a = getNode(nodes, edge.f);
  const b = getNode(nodes, edge.t);
  if (!a || !b) return '';

  const x1 = a.cx;
  const y1 = nodeBot(a);
  const x2 = b.cx;
  const y2 = nodeTop(b);
  const c = (y2 - y1) * 0.52;

  return `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function DAGViewerEnhanced() {
  const { selectNode, selectedNodeId, isExecuting } = useWorkflow();

  // Internal state
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState('Click a node to inspect \u00b7 Run to simulate execution');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const nodes = DEFAULT_NODES;
  const edges = DEFAULT_EDGES;

  // Initialize all nodes to idle
  useEffect(() => {
    const initial: Record<string, NodeState> = {};
    nodes.forEach((n) => {
      initial[n.id] = 'idle';
    });
    setNodeStates(initial);
  }, []);

  // Reset function
  const resetAll = useCallback(() => {
    const initial: Record<string, NodeState> = {};
    nodes.forEach((n) => {
      initial[n.id] = 'idle';
    });
    setNodeStates(initial);
    setSelectedId(null);
    setStepIndex(-1);
    setIsRunning(false);
    setStatusText('Click a node to inspect \u00b7 Run to simulate execution');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [nodes]);

  // Execute layer function
  const execLayer = useCallback(
    (layerIdx: number, continueFromApproval = false) => {
      if (layerIdx >= EXEC_LAYERS.length) {
        setIsRunning(false);
        setStatusText('\u2713  Workflow completed \u2014 all 4 layers executed');
        return;
      }

      const ids = EXEC_LAYERS[layerIdx];
      setStatusText(`Layer ${layerIdx + 1} / ${EXEC_LAYERS.length}  \u00b7  Running: ${ids.join(', ')} ...`);

      // Update states for this layer
      setNodeStates((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = id === 'appr' && !continueFromApproval ? 'waiting' : 'running';
        });
        return next;
      });

      // Approval gate handling
      if (ids.includes('appr') && !continueFromApproval) {
        setStatusText('\u2691  Approval gate \u00b7 Human confirmation required \u2014 click Approve to continue');

        // Complete non-gate nodes after a beat
        timerRef.current = setTimeout(() => {
          setNodeStates((prev) => {
            const next = { ...prev };
            ids.filter((id) => id !== 'appr').forEach((id) => {
              next[id] = 'complete';
            });
            return next;
          });
        }, 900);
        return;
      }

      // Normal: complete after delay
      timerRef.current = setTimeout(
        () => {
          setNodeStates((prev) => {
            const next = { ...prev };
            ids.forEach((id) => {
              next[id] = 'complete';
            });
            return next;
          });

          timerRef.current = setTimeout(() => {
            execLayer(layerIdx + 1);
          }, 380);
        },
        layerIdx === 0 ? 850 : 1050
      );
    },
    []
  );

  // Run workflow
  const runWorkflow = useCallback(() => {
    if (isRunning) return;
    resetAll();
    setIsRunning(true);
    // Small delay to ensure reset completes
    setTimeout(() => {
      execLayer(0);
    }, 50);
  }, [isRunning, resetAll, execLayer]);

  // Approve and continue
  const approveAndContinue = useCallback(() => {
    setNodeStates((prev) => ({
      ...prev,
      appr: 'complete',
    }));

    // Find which layer has appr
    const apprLayerIdx = EXEC_LAYERS.findIndex((layer) => layer.includes('appr'));
    if (apprLayerIdx !== -1) {
      timerRef.current = setTimeout(() => {
        execLayer(apprLayerIdx + 1);
      }, 450);
    }
  }, [execLayer]);

  // Step through execution
  const stepExec = useCallback(() => {
    if (isRunning) return;

    const newStep = stepIndex + 1;
    if (newStep >= EXEC_LAYERS.length) {
      resetAll();
      return;
    }

    // Complete previous layers
    setNodeStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < newStep; i++) {
        EXEC_LAYERS[i].forEach((id) => {
          next[id] = 'complete';
        });
      }
      // Current layer
      EXEC_LAYERS[newStep].forEach((id) => {
        next[id] = id === 'appr' ? 'waiting' : 'running';
      });
      return next;
    });

    setStepIndex(newStep);
    setStatusText(`Step ${newStep + 1} / ${EXEC_LAYERS.length}  \u00b7  ${EXEC_LAYERS[newStep].join(', ')}`);
  }, [isRunning, stepIndex, resetAll]);

  // Handle node selection
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      selectNode(nodeId);
    },
    [selectNode]
  );

  // Get selected node details
  const selectedNode = selectedId ? getNode(nodes, selectedId) : null;
  const selectedService = selectedNode ? SERVICE_PALETTE[selectedNode.svc] : null;

  const isWaitingApproval = nodeStates['appr'] === 'waiting';

  return (
    <div className="w-full max-w-[900px] mx-auto">
      {/* Header */}
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-[13px] font-semibold text-[#e8e4d8] tracking-[.04em]">
            Agentic MCP Gateway
          </div>
          <div className="text-[10px] text-white/30 mt-[3px]">
            Workflow DAG \u00b7 Hierarchical top-to-bottom \u00b7 Step grouped
          </div>
        </div>
        <span className="text-[9px] px-[9px] py-[3px] rounded-xl font-semibold tracking-[.06em] bg-[rgba(29,158,117,.15)] border border-[rgba(29,158,117,.35)] text-[#5DCAA5]">
          LIVE SIM
        </span>
      </header>

      {/* DAG Card */}
      <div className="bg-[#13151d] border border-white/[.07] rounded-[14px] overflow-hidden">
        {/* SVG Canvas */}
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full block"
          style={{ fontFamily: "'DM Mono', 'Fira Mono', 'Courier New', monospace" }}
        >
          <defs>
            <marker
              id="ah"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path
                d="M2 1L8 5L2 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
            <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Phase Group Bands */}
          {PHASES.map((phase, i) => (
            <g key={i}>
              <rect
                x={28}
                y={phase.y}
                width={VIEW_WIDTH - 56}
                height={phase.h}
                rx={10}
                fill={phase.fill}
                stroke={phase.stroke}
                strokeWidth={0.75}
              />
              <text
                x={36}
                y={phase.y + 12}
                fontSize="7.5"
                fontWeight="700"
                letterSpacing=".1em"
                fill={phase.stroke.replace(')', ',.8)').replace('rgba', 'rgba')}
              >
                {phase.label}
              </text>
            </g>
          ))}

          {/* Edges */}
          {edges.map((edge, i) => {
            const fromNode = getNode(nodes, edge.f);
            const isActive = nodeStates[edge.f] === 'complete';
            const col = isActive ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.09)';

            return (
              <g key={i}>
                <path
                  d={generateEdgePath(nodes, edge)}
                  fill="none"
                  stroke={col}
                  strokeWidth={isActive ? 1.5 : 0.8}
                  strokeDasharray={edge.dashed && isActive ? '6 3' : !isActive ? '4 3' : 'none'}
                  markerEnd={isActive ? 'url(#ah)' : undefined}
                  style={{ color: col }}
                />
                {/* Data flow label */}
                {isActive && edge.lb && fromNode && (
                  (() => {
                    const a = fromNode;
                    const b = getNode(nodes, edge.t);
                    if (!b) return null;
                    const mx = (a.cx + b.cx) / 2;
                    const my = (nodeBot(a) + nodeTop(b)) / 2;
                    const lw = edge.lb.length * 5.5 + 14;
                    return (
                      <>
                        <rect
                          x={mx - lw / 2}
                          y={my - 8.5}
                          width={lw}
                          height={15}
                          rx={4}
                          fill="#0d0f16"
                          stroke="rgba(255,255,255,.12)"
                          strokeWidth={0.5}
                        />
                        <text
                          x={mx}
                          y={my}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize="8"
                          fill="rgba(255,255,255,.42)"
                        >
                          {edge.lb}
                        </text>
                      </>
                    );
                  })()
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const state = nodeStates[node.id] || 'idle';
            const svc = SERVICE_PALETTE[node.svc];
            const nx = node.cx - node.w / 2;
            const ny = nodeTop(node);
            const isSel = selectedId === node.id;

            // Stroke color based on state
            let strokeCol = 'rgba(255,255,255,.1)';
            if (state === 'running') strokeCol = svc.dot;
            else if (state === 'complete') strokeCol = svc.border;
            else if (state === 'waiting') strokeCol = '#BA7517';
            else if (isSel) strokeCol = 'rgba(255,255,255,.3)';

            const ix = nx + node.w - 13;
            const iy = ny + NODE_HEIGHT / 2;

            return (
              <g
                key={node.id}
                style={{ cursor: 'pointer' }}
                onClick={() => handleNodeClick(node.id)}
              >
                {/* Glow for running/selected */}
                {(state === 'running' || isSel) && (
                  <rect
                    x={nx - 3}
                    y={ny - 3}
                    width={node.w + 6}
                    height={NODE_HEIGHT + 6}
                    rx={NODE_RADIUS + 3}
                    fill="none"
                    stroke={state === 'running' ? svc.dot : 'rgba(255,255,255,.25)'}
                    strokeWidth={1.5}
                    opacity={0.5}
                    filter="url(#glow)"
                  />
                )}

                {/* Main node rect */}
                <rect
                  x={nx}
                  y={ny}
                  width={node.w}
                  height={NODE_HEIGHT}
                  rx={NODE_RADIUS}
                  fill={state !== 'idle' ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.025)'}
                  stroke={strokeCol}
                  strokeWidth={state === 'idle' ? 0.75 : 1.25}
                />

                {/* Left accent pill */}
                <rect x={nx} y={ny} width={4} height={NODE_HEIGHT} rx={NODE_RADIUS} fill={svc.dot} />
                {/* Mask right side of accent */}
                <rect
                  x={nx + 2}
                  y={ny}
                  width={4}
                  height={NODE_HEIGHT}
                  fill={state !== 'idle' ? 'rgba(19,21,29,.8)' : 'rgba(19,21,29,.9)'}
                />

                {/* Service badge */}
                {(() => {
                  const bw = svc.name.length * 5.2 + 14;
                  const bx = nx + node.w - bw - 8;
                  const byt = ny + 6;
                  return (
                    <>
                      <rect
                        x={bx}
                        y={byt}
                        width={bw}
                        height={13}
                        rx={4}
                        fill={svc.label_bg}
                        stroke={svc.border}
                        strokeWidth={0.5}
                      />
                      <text
                        x={bx + bw / 2}
                        y={byt + 6.5}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="7.5"
                        fontWeight="700"
                        fill={svc.dot}
                      >
                        {svc.name}
                      </text>
                    </>
                  );
                })()}

                {/* Main label */}
                <text
                  x={nx + 14}
                  y={ny + 22}
                  dominantBaseline="central"
                  fontSize="12"
                  fontWeight="600"
                  fill="#e8e4d8"
                >
                  {node.label}
                </text>

                {/* Sub-label */}
                <text
                  x={nx + 14}
                  y={ny + 38}
                  dominantBaseline="central"
                  fontSize="9"
                  fill="rgba(255,255,255,.28)"
                >
                  {node.sub}
                </text>

                {/* State indicator */}
                {state === 'complete' && (
                  <>
                    <circle cx={ix} cy={iy} r={8} fill="#1D9E75" />
                    <path
                      d={`M${ix - 3.5},${iy} L${ix - 1},${iy + 2.8} L${ix + 4},${iy - 3.2}`}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
                {state === 'running' && (
                  <circle
                    cx={ix}
                    cy={iy}
                    r={8}
                    fill="none"
                    stroke={svc.dot}
                    strokeWidth={2}
                    strokeDasharray="24 9"
                  >
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`0 ${ix} ${iy}`}
                      to={`360 ${ix} ${iy}`}
                      dur="1s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                {state === 'waiting' && (
                  <>
                    <circle
                      cx={ix}
                      cy={iy}
                      r={8}
                      fill="rgba(186,117,23,.25)"
                      stroke="#BA7517"
                      strokeWidth={1.2}
                    />
                    <text
                      x={ix}
                      y={iy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="11"
                      fontWeight="800"
                      fill="#EF9F27"
                    >
                      ?
                    </text>
                  </>
                )}
                {state === 'idle' && (
                  <circle
                    cx={ix}
                    cy={iy}
                    r={6}
                    fill="none"
                    stroke="rgba(255,255,255,.14)"
                    strokeWidth={1.2}
                  />
                )}
              </g>
            );
          })}

          {/* Legend - Services */}
          {(() => {
            const lgY = 568;
            let lx = 36;
            return Object.entries(SERVICE_PALETTE).map(([key, svc]) => {
              const el = (
                <g key={key}>
                  <circle cx={lx + 4} cy={lgY} r={3.5} fill={svc.dot} />
                  <text
                    x={lx + 12}
                    y={lgY}
                    dominantBaseline="central"
                    fontSize="8.5"
                    fill="rgba(255,255,255,.27)"
                  >
                    {svc.name}
                  </text>
                </g>
              );
              lx += svc.name.length * 5.4 + 26;
              return el;
            });
          })()}

          {/* Legend - States */}
          {(() => {
            const lgY = 568;
            let lx = VIEW_WIDTH - 280;
            const stMap = [
              { c: 'rgba(255,255,255,.14)', label: 'idle' },
              { c: '#378ADD', label: 'running' },
              { c: '#1D9E75', label: 'complete' },
              { c: '#BA7517', label: 'waiting' },
            ];
            return stMap.map((s, i) => {
              const el = (
                <g key={i}>
                  <circle
                    cx={lx + 4}
                    cy={lgY}
                    r={3.5}
                    fill="none"
                    stroke={s.c}
                    strokeWidth={1.5}
                  />
                  <text
                    x={lx + 12}
                    y={lgY}
                    dominantBaseline="central"
                    fontSize="8.5"
                    fill="rgba(255,255,255,.27)"
                  >
                    {s.label}
                  </text>
                </g>
              );
              lx += s.label.length * 5.4 + 24;
              return el;
            });
          })()}
        </svg>

        {/* Controls */}
        <div className="flex items-center gap-2 px-4 py-[10px] bg-[#0f1119] border-t border-white/[.06]">
          {isWaitingApproval ? (
            <button
              onClick={approveAndContinue}
              className="text-[10.5px] font-semibold px-[13px] py-[5px] rounded-md cursor-pointer border transition-all tracking-[.03em] bg-[#064034] border-[#0F6E56] text-[#5DCAA5] hover:bg-[#085041]"
              style={{ fontFamily: 'inherit' }}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-sm">&#10003;</span> Approve & continue
              </span>
            </button>
          ) : (
            <button
              onClick={runWorkflow}
              disabled={isRunning}
              className={cn(
                'text-[10.5px] font-semibold px-[13px] py-[5px] rounded-md cursor-pointer border transition-all tracking-[.03em]',
                'bg-[#064034] border-[#0F6E56] text-[#5DCAA5] hover:bg-[#085041]',
                isRunning && 'opacity-30 cursor-default'
              )}
              style={{ fontFamily: 'inherit' }}
            >
              <span className="flex items-center gap-1.5">
                <Play className="w-3 h-3" /> Run workflow
              </span>
            </button>
          )}
          <button
            onClick={stepExec}
            disabled={isRunning}
            className={cn(
              'text-[10.5px] font-semibold px-[13px] py-[5px] rounded-md cursor-pointer border transition-all tracking-[.03em]',
              'border-white/[.12] bg-white/[.04] text-white/70 hover:bg-white/[.08] hover:text-white',
              isRunning && 'opacity-30 cursor-default'
            )}
            style={{ fontFamily: 'inherit' }}
          >
            <span className="flex items-center gap-1.5">
              Step <ChevronRight className="w-3 h-3" />
            </span>
          </button>
          <button
            onClick={resetAll}
            className="text-[10.5px] font-semibold px-[13px] py-[5px] rounded-md cursor-pointer border transition-all tracking-[.03em] border-white/[.12] bg-white/[.04] text-white/70 hover:bg-white/[.08] hover:text-white"
            style={{ fontFamily: 'inherit' }}
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw className="w-3 h-3" /> Reset
            </span>
          </button>
          <div className="flex-1 text-right text-[10px] text-white/30">{statusText}</div>
        </div>

        {/* Detail Panel */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-300 border-t border-white/[.06] bg-[#0c0e15]',
            selectedNode ? 'max-h-[140px]' : 'max-h-0'
          )}
        >
          {selectedNode && selectedService && (
            <div className="p-[13px_16px]">
              <div className="flex items-center gap-2 mb-[10px]">
                <span className="text-xs font-semibold text-[#e8e4d8]">{selectedNode.label}</span>
                <span
                  className="text-[8.5px] px-2 py-[2px] rounded-[10px] font-bold tracking-[.05em]"
                  style={{
                    background: selectedService.label_bg,
                    border: `1px solid ${selectedService.border}`,
                    color: selectedService.dot,
                  }}
                >
                  {selectedService.name}
                </span>
                <span className="text-[10px] text-white/35 ml-auto">
                  {nodeStates[selectedNode.id] === 'idle' && '\u25cb  pending'}
                  {nodeStates[selectedNode.id] === 'running' && '\u27f3  running'}
                  {nodeStates[selectedNode.id] === 'complete' && '\u2713  complete'}
                  {nodeStates[selectedNode.id] === 'waiting' && '\u2691  awaiting approval'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(selectedNode.d).map(([key, value]) => (
                  <div key={key}>
                    <label className="block text-[8px] uppercase tracking-[.08em] text-white/30 mb-[3px]">
                      {key}
                    </label>
                    <span className="text-[10px] text-white/70">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
