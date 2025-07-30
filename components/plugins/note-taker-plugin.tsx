"use client"

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { FileText, Save, Download, Trash2, Plus, Search } from 'lucide-react';
import type { PluginProps } from './plugin-manager';

interface Note {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORIES = [
  'General',
  'Ideas',
  'Tasks',
  'Code',
  'Research',
  'Meeting',
  'Personal'
];

export const NoteTakerPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('General');
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Load notes from localStorage on mount
  useEffect(() => {
    const savedNotes = localStorage.getItem('plugin-notes');
    if (savedNotes) {
      const parsed = JSON.parse(savedNotes);
      setNotes(parsed.map((note: any) => ({
        ...note,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt)
      })));
    }

    // Load initial data if provided
    if (initialData?.content) {
      setContent(initialData.content);
      setTitle(initialData.title || 'New Note');
      setIsEditing(true);
    }
  }, [initialData]);

  // Save notes to localStorage whenever notes change
  useEffect(() => {
    localStorage.setItem('plugin-notes', JSON.stringify(notes));
  }, [notes]);

  const createNewNote = () => {
    setCurrentNote(null);
    setTitle('');
    setContent('');
    setCategory('General');
    setIsEditing(true);
  };

  const saveNote = () => {
    if (!title.trim() || !content.trim()) return;

    const now = new Date();
    
    if (currentNote) {
      // Update existing note
      setNotes(prev => prev.map(note => 
        note.id === currentNote.id 
          ? { ...note, title, content, category, updatedAt: now }
          : note
      ));
      setCurrentNote(prev => prev ? { ...prev, title, content, category, updatedAt: now } : null);
    } else {
      // Create new note
      const newNote: Note = {
        id: Date.now().toString(),
        title,
        content,
        category,
        createdAt: now,
        updatedAt: now
      };
      setNotes(prev => [newNote, ...prev]);
      setCurrentNote(newNote);
    }
    
    setIsEditing(false);
    onResult?.({ title, content, category });
  };

  const loadNote = (note: Note) => {
    setCurrentNote(note);
    setTitle(note.title);
    setContent(note.content);
    setCategory(note.category);
    setIsEditing(false);
  };

  const deleteNote = (noteId: string) => {
    setNotes(prev => prev.filter(note => note.id !== noteId));
    if (currentNote?.id === noteId) {
      createNewNote();
    }
  };

  const exportNote = (note: Note) => {
    const blob = new Blob([`# ${note.title}\n\n${note.content}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredNotes = notes.filter(note => 
    note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="h-full flex">
      {/* Notes List Sidebar */}
      <div className="w-1/3 border-r border-white/10 flex flex-col">
        <div className="p-3 border-b border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-green-400" />
            <h3 className="text-lg font-semibold text-white">Notes</h3>
          </div>
          
          <div className="flex gap-2 mb-3">
            <Button
              size="sm"
              onClick={createNewNote}
              className="bg-green-600 hover:bg-green-700 flex-1"
            >
              <Plus className="w-4 h-4 mr-1" />
              New
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
            <Input
              placeholder="Search notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-black/40 border-white/20 text-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map(note => (
            <div
              key={note.id}
              className={`p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 ${
                currentNote?.id === note.id ? 'bg-white/10' : ''
              }`}
              onClick={() => loadNote(note)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-white truncate">
                    {note.title}
                  </h4>
                  <p className="text-xs text-white/60 mt-1 line-clamp-2">
                    {note.content}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs bg-white/10 px-2 py-1 rounded text-white/80">
                      {note.category}
                    </span>
                    <span className="text-xs text-white/40">
                      {note.updatedAt.toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      exportNote(note);
                    }}
                    className="w-6 h-6 p-0 text-white/40 hover:text-white"
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNote(note.id);
                    }}
                    className="w-6 h-6 p-0 text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          
          {filteredNotes.length === 0 && (
            <div className="p-6 text-center text-white/40">
              {searchTerm ? 'No notes found' : 'No notes yet'}
            </div>
          )}
        </div>
      </div>

      {/* Note Editor */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Input
              placeholder="Note title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 bg-black/40 border-white/20 text-white font-medium"
              disabled={!isEditing && !currentNote}
            />
            <Select 
              value={category} 
              onValueChange={setCategory}
              disabled={!isEditing && !currentNote}
            >
              <SelectTrigger className="w-32 bg-black/40 border-white/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(cat => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button
                  onClick={saveNote}
                  disabled={!title.trim() || !content.trim()}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (currentNote) {
                      setTitle(currentNote.title);
                      setContent(currentNote.content);
                      setCategory(currentNote.category);
                    } else {
                      setTitle('');
                      setContent('');
                      setCategory('General');
                    }
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setIsEditing(true)}
                disabled={!currentNote && !title && !content}
                variant="ghost"
              >
                Edit
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 p-4">
          <Textarea
            placeholder="Start writing your note..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full bg-black/40 border-white/20 text-white resize-none"
            disabled={!isEditing && !currentNote}
          />
        </div>
      </div>
    </div>
  );
};

export default NoteTakerPlugin;