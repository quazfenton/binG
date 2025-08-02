"use client";

import React, { useState, useCallback } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { X, Share2 } from 'lucide-react';

const initialNodes: Node[] = [
  { id: '1', data: { label: 'Start' }, position: { x: 250, y: 5 }, type: 'input' },
  { id: '2', data: { label: 'Process' }, position: { x: 250, y: 100 } },
  { id: '3', data: { label: 'End' }, position: { x: 250, y: 200 }, type: 'output' },
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

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes]
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );
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

  const addNode = () => {
    const newNodeId = (nodes.length + 1).toString();
    const newNode: Node = {
      id: newNodeId,
      data: { label: `Node ${newNodeId}` },
      position: {
        x: Math.random() * 400,
        y: Math.random() * 400,
      },
    };
    setNodes((nds) => nds.concat(newNode));
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <CardHeader className="p-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-lg">Interactive Diagramming</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-grow p-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          className="bg-gray-800"
        >
          <Controls />
          <MiniMap />
          <Background gap={12} size={1} />
        </ReactFlow>
        <div className="absolute top-4 left-4 z-10 flex gap-2">
            <Button onClick={addNode}>Add Node</Button>
        </div>
      </CardContent>
      <div className="p-4 border-t border-white/10 flex-shrink-0 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleInsertDiagram}>Insert Diagram</Button>
      </div>
    </div>
  );
};

export default InteractiveDiagrammingPlugin;
