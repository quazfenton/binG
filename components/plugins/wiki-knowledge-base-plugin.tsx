"use client";

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { 
  FileText, Search, Plus, Trash2, Link as LinkIcon, Download,
  BookOpen, Network, XCircle, Save, Tag, Calendar
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  links: string[];
  created: string;
  modified: string;
}

export default function WikiKnowledgeBasePlugin({ onClose }: PluginProps) {
  const [notes, setNotes] = useState<Note[]>([
    {
      id: '1',
      title: 'Getting Started',
      content: '# Welcome to Wiki\n\nThis is your personal knowledge base. Use [[links]] to connect notes.',
      tags: ['tutorial', 'guide'],
      links: [],
      created: '2024-01-15',
      modified: '2024-01-15'
    }
  ]);
  const [activeNote, setActiveNote] = useState<Note | null>(notes[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [newTag, setNewTag] = useState('');

  const createNote = () => {
    const newNote: Note = {
      id: Date.now().toString(),
      title: 'Untitled Note',
      content: '',
      tags: [],
      links: [],
      created: new Date().toISOString().split('T')[0],
      modified: new Date().toISOString().split('T')[0]
    };
    setNotes([...notes, newNote]);
    setActiveNote(newNote);
    setIsEditing(true);
    setEditContent('');
    toast.success('New note created');
  };

  const saveNote = () => {
    if (!activeNote) return;
    
    const updatedNote = {
      ...activeNote,
      content: editContent,
      modified: new Date().toISOString().split('T')[0]
    };
    
    setNotes(notes.map(n => n.id === activeNote.id ? updatedNote : n));
    setActiveNote(updatedNote);
    setIsEditing(false);
    toast.success('Note saved');
  };

  const deleteNote = (id: string) => {
    setNotes(notes.filter(n => n.id !== id));
    if (activeNote?.id === id) setActiveNote(null);
    toast.success('Note deleted');
  };

  const addTag = () => {
    if (!activeNote || !newTag) return;
    
    const updatedNote = {
      ...activeNote,
      tags: [...activeNote.tags, newTag]
    };
    
    setNotes(notes.map(n => n.id === activeNote.id ? updatedNote : n));
    setActiveNote(updatedNote);
    setNewTag('');
    toast.success('Tag added');
  };

  const removeTag = (tag: string) => {
    if (!activeNote) return;
    
    const updatedNote = {
      ...activeNote,
      tags: activeNote.tags.filter(t => t !== tag)
    };
    
    setNotes(notes.map(n => n.id === activeNote.id ? updatedNote : n));
    setActiveNote(updatedNote);
  };

  const exportAllNotes = () => {
    const data = JSON.stringify(notes, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wiki-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Notes exported');
  };

  const filteredNotes = notes.filter(n =>
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            Wiki Knowledge Base
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-4 gap-4 h-full">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button size="icon" onClick={createNote}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-1">
              {filteredNotes.map(note => (
                <div
                  key={note.id}
                  className={`p-2 rounded cursor-pointer text-sm ${
                    activeNote?.id === note.id ? 'bg-blue-500/20' : 'hover:bg-white/5'
                  }`}
                  onClick={() => {
                    setActiveNote(note);
                    setIsEditing(false);
                  }}
                >
                  <div className="font-medium">{note.title}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {note.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Button variant="outline" onClick={exportAllNotes} className="w-full">
              <Download className="w-4 h-4 mr-2" />
              Export All
            </Button>
          </div>

          <div className="col-span-3">
            {activeNote ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Input
                    value={activeNote.title}
                    onChange={(e) => setActiveNote({ ...activeNote, title: e.target.value })}
                    className="flex-1 font-medium text-lg"
                  />
                  <div className="flex gap-2 ml-3">
                    {isEditing ? (
                      <Button onClick={saveNote}>
                        <Save className="w-4 h-4 mr-2" />
                        Save
                      </Button>
                    ) : (
                      <Button onClick={() => {
                        setIsEditing(true);
                        setEditContent(activeNote.content);
                      }}>
                        Edit
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => deleteNote(activeNote.id)}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>

                <Card className="bg-white/5">
                  <CardContent className="p-4">
                    {isEditing ? (
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={15}
                        className="font-mono text-sm"
                        placeholder="Write in Markdown..."
                      />
                    ) : (
                      <div className="prose prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm">{activeNote.content}</pre>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-white/5">
                  <CardHeader className="p-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Tag className="w-4 h-4" />
                      Tags
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {activeNote.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
                          {tag} ×
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add tag..."
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addTag()}
                        className="flex-1"
                      />
                      <Button size="sm" onClick={addTag}>Add</Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/5">
                  <CardContent className="p-3 text-xs text-gray-400">
                    <div className="flex justify-between">
                      <span>Created: {activeNote.created}</span>
                      <span>Modified: {activeNote.modified}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Select a note or create a new one</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
}
