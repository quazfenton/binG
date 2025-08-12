"use client";

import { useReactFlow } from '@xyflow/react';

import React, { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  MiniMap,
  NodeTypes,
  ReactFlowProvider,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { X, Share2, Circle, Square, Diamond, ZoomIn, ZoomOut, Minus, Plus } from 'lucide-react';

// Define custom node types
const nodeTypes: NodeTypes = {
  input: ({ data }) => (
    <div className="px-4 py-2 rounded-md bg-green-500 text-white border-2 border-green-700">
      {data.label}
    </div>
  ),
  output: ({ data }) => (
    <div className="px-4 py-2 rounded-md bg-red-500 text-white border-2 border-red-700">
      {data.label}
    </div>
  ),
  process: ({ data }) => (
    <div className="px-4 py-2 rounded-md bg-blue-500 text-white border-2 border-blue-700">
      {data.label}
    </div>
  ),
  decision: ({ data }) => (
    <div className="flex items-center justify-center w-16 h-16 transform rotate-45 bg-yellow-500 border-2 border-yellow-700">
      <div className="transform -rotate-45 text-white text-center text-xs px-1">
        {data.label}
      </div>
    </div>
  ),
};

const initialNodes: Node[] = [
  {
    id: '1',
    data: { label: 'Start' },
    position: { x: 250, y: 5 },
    type: 'input',
    style: { backgroundColor: '#10B981' }
  },
  {
    id: '2',
    data: { label: 'Process' },
    position: { x: 250, y: 100 },
    type: 'process',
    style: { backgroundColor: '#3B82F6' }
  },
  {
    id: '3',
    data: { label: 'End' },
    position: { x: 250, y: 200 },
    type: 'output',
    style: { backgroundColor: '#EF4444' }
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3' },
];

interface InteractiveDiagrammingPluginProps {
  onClose: () => void;
  onResult?: (result: any) => void;
}

const InteractiveDiagrammingPlugin: React.FC<InteractiveDiagrammingPluginProps> = ({ onClose, onResult }) => {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [editingElement, setEditingElement] = useState<Node | Edge | null>(null);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, node?: Node} | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes]
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    setEditingElement(node);
  }, []);

  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setEditingElement(edge);
  }, []);

  const updateNodeLabel = (nodeId: string, newLabel: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, label: newLabel } };
        }
        return node;
      })
    );
  };

  const updateEdgeLabel = (edgeId: string, newLabel: string) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === edgeId) {
          return { ...edge, label: newLabel };
        }
        return edge;
      })
    );
  };
  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const handleInsertDiagram = () => {
    const diagramData = {
      type: 'flowchart',
      nodes,
      edges,
      description: 'An interactive flowchart diagram.',
    };
    onResult?.({
      content: `Here is the diagram data: \`\`\`json\n${JSON.stringify(diagramData, null, 2)}\n\`\`\``,
    });
    onClose();
  };

  const addNode = (type: string, position: {x: number, y: number}) => {
    const newNodeId = `${Date.now()}`;
    const newNode: Node = {
      id: newNodeId,
      data: { label: type.charAt(0).toUpperCase() + type.slice(1) },
      position,
      type,
      style: {
        backgroundColor:
          type === 'input' ? '#10B981' :
          type === 'output' ? '#EF4444' :
          type === 'decision' ? '#F59E0B' : '#3B82F6'
      }
    };
    setNodes((nds) => nds.concat(newNode));
  };

  const handlePaneClick = (e: React.MouseEvent) => {
    if (e.target === flowRef.current) {
      setContextMenu({x: e.clientX, y: e.clientY});
    } else {
      setContextMenu(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node?: Node) => {
    e.preventDefault();
    setContextMenu(node ? {x: e.clientX, y: e.clientY, node} : null);
  };

  const deleteNode = (nodeId: string) => {
    setNodes(nodes.filter(n => n.id !== nodeId));
    setEdges(edges.filter(e => e.source !== nodeId && e.target !== nodeId));
    setContextMenu(null);
  };

  const addEdgeLabel = (edgeId: string) => {
    setEdges(eds =>
      eds.map(edge => {
        if (edge.id === edgeId) {
          return { ...edge, label: 'Label' };
        }
        return edge;
      })
    );
    setEditingElement(edges.find(e => e.id === edgeId) || null);
  };

  return (
    <ReactFlowProvider>
      <div
        className="h-full flex flex-col bg-gray-900 text-white"
        onContextMenu={(e) => handlePaneClick(e)}
      >
        <CardHeader className="p-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-lg">Advanced Diagramming</CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-grow p-0 relative">
          <ReactFlow
            ref={flowRef}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodeContextMenu={handleContextMenu}
            nodeTypes={nodeTypes}
            fitView
            className="bg-gray-800"
          >
            <Controls />
            <MiniMap />
            <Background gap={12} size={1} />
            <ZoomControls />
          </ReactFlow>
          <div className="absolute top-4 left-4 z-10 flex gap-2 bg-gray-800/80 p-2 rounded">
            <Button variant="outline" size="icon" title="Add Rectangle" onClick={() => addNode('process', {x: 100, y: 100})}>
              <Square size={16} />
            </Button>
            <Button variant="outline" size="icon" title="Add Circle" onClick={() => addNode('input', {x: 100, y: 100})}>
              <Circle size={16} />
            </Button>
            <Button variant="outline" size="icon" title="Add Diamond" onClick={() => addNode('decision', {x: 100, y: 100})}>
              <Diamond size={16} />
            </Button>
          </div>
        </CardContent>
        {editingElement && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full">
              <h3 className="text-lg font-medium mb-4">
                {editingElement.type ? 'Edit Node' : 'Edit Edge'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Label</label>
                  <input
                    type="text"
                    value={(editingElement as any).data?.label || (editingElement as any).label || ''}
                    onChange={(e) => {
                      if ('data' in editingElement) {
                        updateNodeLabel(editingElement.id, e.target.value);
                      } else {
                        updateEdgeLabel(editingElement.id, e.target.value);
                      }
                    }}
                    className="w-full p-2 rounded bg-gray-700 text-white"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditingElement(null)}>Cancel</Button>
                  <Button onClick={() => setEditingElement(null)}>Save</Button>
                </div>
              </div>
            </div>
          </div>
        )}
        {contextMenu && (
          <div
            className="fixed bg-gray-800 border border-gray-700 rounded shadow-lg z-50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="py-1">
              {contextMenu.node ? (
                <>
                  <button
                    className="block w-full text-left px-4 py-2 hover:bg-gray-700"
                    onClick={() => {
                      setEditingElement(contextMenu.node || null);
                      setContextMenu(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="block w-full text-left px-4 py-2 hover:bg-gray-700"
                    onClick={() => deleteNode(contextMenu.node!.id)}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="block w-full text-left px-4 py-2 hover:bg-gray-700"
                    onClick={() => addNode('process', {x: contextMenu.x, y: contextMenu.y})}
                  >
                    Add Rectangle
                  </button>
                  <button
                    className="block w-full text-left px-4 py-2 hover:bg-gray-700"
                    onClick={() => addNode('input', {x: contextMenu.x, y: contextMenu.y})}
                  >
                    Add Circle
                  </button>
                  <button
                    className="block w-full text-left px-4 py-2 hover:bg-gray-700"
                    onClick={() => addNode('decision', {x: contextMenu.x, y: contextMenu.y})}
                  >
                    Add Diamond
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        <div className="p-4 border-t border-white/10 flex-shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleInsertDiagram}>Insert Diagram</Button>
        </div>
      </div>
    </ReactFlowProvider>
  );
};

const ZoomControls = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  
  return (
    <Panel position="top-right" className="flex gap-1">
      <Button variant="outline" size="icon" onClick={() => zoomIn()}><ZoomIn size={16} /></Button>
      <Button variant="outline" size="icon" onClick={() => zoomOut()}><ZoomOut size={16} /></Button>
      <Button variant="outline" size="icon" onClick={() => fitView()}><Minus size={16} /></Button>
    </Panel>
  );
};

export default InteractiveDiagrammingPlugin;

