import React, { useReducer, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Film, Plus, Trash, ArrowLeft, ArrowRight, Download, Upload, GripVertical, X, Square, Circle, Type } from 'lucide-react';
import { useToast } from '../ui/use-toast';

// --- Types ---
interface CanvasObject {
  id: string;
  type: 'rect' | 'circle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  color: string;
}

interface Scene {
  id: string;
  title: string;
  description: string;
  characters: string[];
  dialogue: string;
  notes: string;
  canvasObjects: CanvasObject[];
}

type StoryboardState = {
  scenes: Scene[];
  currentSceneIndex: number;
  title: string;
};

type Action =
  | { type: 'ADD_SCENE' }
  | { type: 'REMOVE_SCENE'; payload: number }
  | { type: 'UPDATE_SCENE'; payload: { index: number; field: keyof Scene; value: any } }
  | { type: 'REORDER_SCENES'; payload: { startIndex: number; endIndex: number } }
  | { type: 'SET_CURRENT_SCENE'; payload: number }
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'LOAD_STORYBOARD'; payload: StoryboardState }
  | { type: 'ADD_CANVAS_OBJECT'; payload: { type: 'rect' | 'circle' | 'text' } }
  | { type: 'UPDATE_CANVAS_OBJECT'; payload: { objectId: string; updates: Partial<CanvasObject> } }
  | { type: 'REMOVE_CANVAS_OBJECT'; payload: { objectId: string } };

// --- Reducer ---
const storyboardReducer = (state: StoryboardState, action: Action): StoryboardState => {
  switch (action.type) {
    case 'ADD_SCENE': {
      const newScene: Scene = {
        id: `scene-${Date.now()}`,
        title: `Scene ${state.scenes.length + 1}`,
        description: '',
        characters: [],
        dialogue: '',
        notes: '',
        canvasObjects: [],
      };
      return { ...state, scenes: [...state.scenes, newScene], currentSceneIndex: state.scenes.length };
    }
    case 'REMOVE_SCENE': {
      if (state.scenes.length <= 1) return state;
      const newScenes = state.scenes.filter((_, i) => i !== action.payload);
      return {
        ...state,
        scenes: newScenes,
        currentSceneIndex: Math.min(state.currentSceneIndex, newScenes.length - 1),
      };
    }
    case 'UPDATE_SCENE': {
      const newScenes = [...state.scenes];
      newScenes[action.payload.index] = {
        ...newScenes[action.payload.index],
        [action.payload.field]: action.payload.value,
      };
      return { ...state, scenes: newScenes };
    }
    case 'REORDER_SCENES': {
      const { startIndex, endIndex } = action.payload;
      const newScenes = [...state.scenes];
      const [removed] = newScenes.splice(startIndex, 1);
      newScenes.splice(endIndex, 0, removed);
      return { ...state, scenes: newScenes, currentSceneIndex: endIndex };
    }
    case 'SET_CURRENT_SCENE':
      return { ...state, currentSceneIndex: action.payload };
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'LOAD_STORYBOARD':
      return {
        ...action.payload,
        scenes: action.payload.scenes.map(scene => ({
          ...scene,
          canvasObjects: scene.canvasObjects || [],
        })),
      };
    case 'ADD_CANVAS_OBJECT': {
      const newObject: CanvasObject = {
        id: `obj-${Date.now()}`,
        type: action.payload.type,
        x: 50,
        y: 50,
        width: action.payload.type === 'text' ? 100 : 50,
        height: 50,
        text: action.payload.type === 'text' ? 'Text' : undefined,
        color: '#FFFFFF',
      };
      const newScenes = [...state.scenes];
      newScenes[state.currentSceneIndex].canvasObjects.push(newObject);
      return { ...state, scenes: newScenes };
    }
    case 'UPDATE_CANVAS_OBJECT': {
      const newScenes = [...state.scenes];
      const scene = newScenes[state.currentSceneIndex];
      scene.canvasObjects = scene.canvasObjects.map(obj =>
        obj.id === action.payload.objectId ? { ...obj, ...action.payload.updates } : obj
      );
      return { ...state, scenes: newScenes };
    }
    case 'REMOVE_CANVAS_OBJECT': {
      const newScenes = [...state.scenes];
      const scene = newScenes[state.currentSceneIndex];
      scene.canvasObjects = scene.canvasObjects.filter(obj => obj.id !== action.payload.objectId);
      return { ...state, scenes: newScenes };
    }
    default:
      return state;
  }
};

const initialState: StoryboardState = {
  scenes: [
    {
      id: 'scene-initial',
      title: 'Opening Scene',
      description: 'Establish setting and main character',
      characters: ['Protagonist'],
      dialogue: '',
      notes: 'Morning light, establishing shot',
      canvasObjects: [],
    },
  ],
  currentSceneIndex: 0,
  title: 'My Storyboard',
};

// --- Sub-components ---
const SceneNavigator: React.FC<{
  state: StoryboardState;
  dispatch: React.Dispatch<Action>;
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ state, dispatch, onExport, onImport }) => (
    <div className="flex justify-between items-center mb-4">
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        disabled={state.currentSceneIndex === 0}
        onClick={() => dispatch({ type: 'SET_CURRENT_SCENE', payload: state.currentSceneIndex - 1 })}
      >
        <ArrowLeft className="w-4 h-4" />
      </Button>
      <span className="text-sm font-medium">
        Scene {state.currentSceneIndex + 1} of {state.scenes.length}
      </span>
      <Button
        variant="outline"
        size="icon"
        disabled={state.currentSceneIndex === state.scenes.length - 1}
        onClick={() => dispatch({ type: 'SET_CURRENT_SCENE', payload: state.currentSceneIndex + 1 })}
      >
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
    <div className="flex gap-2">
      <Button variant="secondary" onClick={() => dispatch({ type: 'ADD_SCENE' })}>
        <Plus className="w-4 h-4 mr-2" />
        Add Scene
      </Button>
      <Button onClick={onExport}>
        <Download className="w-4 h-4 mr-2" />
        Export
      </Button>
      <Button asChild>
        <label htmlFor="import-storyboard" className="cursor-pointer">
          <Upload className="w-4 h-4 mr-2" />
          Import
          <input id="import-storyboard" type="file" accept=".json" className="hidden" onChange={onImport} />
        </label>
      </Button>
    </div>
  </div>
);

const SceneEditor: React.FC<{
  scene: Scene;
  index: number;
  dispatch: React.Dispatch<Action>;
}> = ({ scene, index, dispatch }) => {
  const handleChange = (field: keyof Scene, value: string | string[]) => {
    dispatch({ type: 'UPDATE_SCENE', payload: { index, field, value } });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-2 block">Scene Title</label>
        <Input
          value={scene.title}
          onChange={(e) => handleChange('title', e.target.value)}
          placeholder="e.g., The Confrontation"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-2 block">Description</label>
        <Textarea
          value={scene.description}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="A brief description of the scene's setting and action."
          className="min-h-[100px]"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-2 block">Characters</label>
        <Textarea
          value={scene.characters.join(', ')}
          onChange={(e) => handleChange('characters', e.target.value.split(',').map(c => c.trim()))}
          placeholder="e.g., Alice, Bob, Charlie"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-2 block">Dialogue</label>
        <Textarea
          value={scene.dialogue}
          onChange={(e) => handleChange('dialogue', e.target.value)}
          placeholder="Character dialogue for this scene."
          className="min-h-[100px]"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-2 block">Director's Notes</label>
        <Textarea
          value={scene.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          placeholder="e.g., Camera angle, lighting, sound effects."
          className="min-h-[100px]"
        />
      </div>
    </div>
  );
};

const SceneList: React.FC<{
  state: StoryboardState;
  dispatch: React.Dispatch<Action>;
}> = ({ state, dispatch }) => {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      dispatch({ type: 'REORDER_SCENES', payload: { startIndex: dragItem.current, endIndex: dragOverItem.current } });
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  return (
    <div className="pr-4 border-r border-white/10 h-full overflow-y-auto">
      <h3 className="text-md font-semibold mb-4 sticky top-0 bg-background z-10 p-2">Scenes</h3>
      {state.scenes.map((scene, index) => (
        <div
          key={scene.id}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragEnter={(e) => handleDragEnter(e, index)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => e.preventDefault()}
          className={`p-3 mb-2 rounded-lg cursor-grab flex items-center justify-between ${
            state.currentSceneIndex === index ? 'bg-purple-500/20' : 'bg-black/20'
          }`}
          onClick={() => dispatch({ type: 'SET_CURRENT_SCENE', payload: index })}
        >
          <span className="truncate">{index + 1}. {scene.title}</span>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'REMOVE_SCENE', payload: index });
              }}
              disabled={state.scenes.length <= 1}
            >
              <Trash className="w-4 h-4" />
            </Button>
            <GripVertical className="w-5 h-5 text-white/50 ml-1" />
          </div>
        </div>
      ))}
    </div>
  );
};

const VisualCanvas: React.FC<{
  scene: Scene;
  dispatch: React.Dispatch<Action>;
}> = ({ scene, dispatch }) => {
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseDown = (e: React.MouseEvent<SVGElement>, objectId: string) => {
    e.stopPropagation();
    setSelectedObject(objectId);
    setDragging(true);
    const CTM = svgRef.current?.getScreenCTM();
    if (CTM) {
      setStartPos({
        x: (e.clientX - CTM.e) / CTM.a,
        y: (e.clientY - CTM.f) / CTM.d,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGElement>) => {
    if (dragging && selectedObject) {
      const CTM = svgRef.current?.getScreenCTM();
      if (CTM) {
        const newX = (e.clientX - CTM.e) / CTM.a;
        const newY = (e.clientY - CTM.f) / CTM.d;
        const selected = scene.canvasObjects.find(o => o.id === selectedObject);
        if (selected) {
          dispatch({
            type: 'UPDATE_CANVAS_OBJECT',
            payload: {
              objectId: selectedObject,
              updates: { x: selected.x + (newX - startPos.x), y: selected.y + (newY - startPos.y) },
            },
          });
          setStartPos({ x: newX, y: newY });
        }
      }
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObject) {
      dispatch({ type: 'REMOVE_CANVAS_OBJECT', payload: { objectId: selectedObject } });
      setSelectedObject(null);
    }
  };

  return (
    <div className="bg-black/20 border border-white/10 rounded p-4 flex flex-col h-full" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Visual Canvas</h3>
        <div className="flex gap-2">
          <Button size="icon" variant="outline" onClick={() => dispatch({ type: 'ADD_CANVAS_OBJECT', payload: { type: 'rect' } })}>
            <Square className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="outline" onClick={() => dispatch({ type: 'ADD_CANVAS_OBJECT', payload: { type: 'circle' } })}>
            <Circle className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="outline" onClick={() => dispatch({ type: 'ADD_CANVAS_OBJECT', payload: { type: 'text' } })}>
            <Type className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="w-full flex-1 bg-black/30 border border-dashed border-white/20 rounded"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {scene.canvasObjects.map(obj => {
          const isSelected = selectedObject === obj.id;
          switch (obj.type) {
            case 'rect':
              return (
                <rect
                  key={obj.id}
                  x={obj.x}
                  y={obj.y}
                  width={obj.width}
                  height={obj.height}
                  fill={obj.color}
                  stroke={isSelected ? 'cyan' : 'none'}
                  strokeWidth="2"
                  className="cursor-move"
                  onMouseDown={(e) => handleMouseDown(e, obj.id)}
                />
              );
            case 'circle':
              return (
                <circle
                  key={obj.id}
                  cx={obj.x + obj.width / 2}
                  cy={obj.y + obj.height / 2}
                  r={Math.min(obj.width, obj.height) / 2}
                  fill={obj.color}
                  stroke={isSelected ? 'cyan' : 'none'}
                  strokeWidth="2"
                  className="cursor-move"
                  onMouseDown={(e) => handleMouseDown(e, obj.id)}
                />
              );
            case 'text':
              return (
                <text
                  key={obj.id}
                  x={obj.x}
                  y={obj.y + obj.height / 2}
                  fill={obj.color}
                  className="cursor-move"
                  onMouseDown={(e) => handleMouseDown(e, obj.id)}
                  style={{ userSelect: 'none' }}
                >
                  {obj.text}
                </text>
              );
            default:
              return null;
          }
        })}
      </svg>
    </div>
  );
};

// --- Main Plugin Component ---
interface InteractiveStoryboardPluginProps {
  onClose: () => void;
  onResult?: (result: any) => void;
}

const InteractiveStoryboardPlugin: React.FC<InteractiveStoryboardPluginProps> = ({ onClose, onResult }) => {
  const [state, dispatch] = useReducer(storyboardReducer, initialState);
  const { toast } = useToast();

  const currentScene = state.scenes[state.currentSceneIndex];

  const handleExport = () => {
    const storyboardData = {
      title: state.title,
      scenes: state.scenes,
      created: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(storyboardData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.title.replace(/\s+/g, '_').toLowerCase()}_storyboard.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Success", description: "Storyboard exported successfully." });
    onResult?.(storyboardData);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (importedData.scenes && Array.isArray(importedData.scenes)) {
          dispatch({ type: 'LOAD_STORYBOARD', payload: { ...initialState, ...importedData } });
          toast({ title: "Success", description: "Storyboard imported successfully." });
        } else {
          throw new Error("Invalid storyboard format.");
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Import Error",
          description: error instanceof Error ? error.message : "Could not parse the file.",
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="h-full flex flex-col bg-background text-white">
      <CardHeader className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-purple-400" />
            <Input
              className="text-lg bg-transparent border-0 focus:ring-0 p-0"
              value={state.title}
              onChange={(e) => dispatch({ type: 'SET_TITLE', payload: e.target.value })}
            />
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <div className="grid grid-cols-1 lg:grid-cols-4 h-full">
          <div className="lg:col-span-1 h-full">
            <SceneList state={state} dispatch={dispatch} />
          </div>
          <div className="lg:col-span-3 flex flex-col h-full overflow-y-auto p-4">
            <SceneNavigator state={state} dispatch={dispatch} onExport={handleExport} onImport={handleImport} />
            {currentScene && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1">
                <VisualCanvas scene={currentScene} dispatch={dispatch} />
                <div className="space-y-4">
                  <SceneEditor scene={currentScene} index={state.currentSceneIndex} dispatch={dispatch} />
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
};

export default InteractiveStoryboardPlugin;
