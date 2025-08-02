"use client"

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../ui/alert-dialog';
import { FileText, Save, Download, Trash2, Plus, Search, Edit, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Note {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = ['General', 'Ideas', 'Tasks', 'Code', 'Research', 'Meeting', 'Personal'];

export const NoteTakerPlugin: React.FC<PluginProps> = ({ onClose, onResult, initialData }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('General');
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    try {
      const savedNotes = localStorage.getItem('plugin-notes');
      if (savedNotes) {
        setNotes(JSON.parse(savedNotes));
      }
    } catch (error) {
      console.error("Failed to load notes from localStorage", error);
      toast.error("Could not load notes.");
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('plugin-notes', JSON.stringify(notes));
    } catch (error) {
      console.error("Failed to save notes to localStorage", error);
      toast.error("Could not save notes.");
    }
  }, [notes]);

  const currentNote = useMemo(() => notes.find(n => n.id === currentNoteId), [notes, currentNoteId]);

  useEffect(() => {
    if (currentNote) {
      setTitle(currentNote.title);
      setContent(currentNote.content);
      setCategory(currentNote.category);
      setIsEditing(false);
      setViewMode('preview');
    } else if (initialData?.content) {
      setTitle(initialData.title || 'New Note from Chat');
      setContent(initialData.content);
      setCategory('General');
      const newId = Date.now().toString();
      setCurrentNoteId(newId);
      setIsEditing(true);
      setViewMode('edit');
    } else {
      setTitle('');
      setContent('');
      setCategory('General');
      setCurrentNoteId(null);
    }
  }, [currentNote, initialData]);

  const createNewNote = useCallback(() => {
    setIsEditing(true);
    setCurrentNoteId(null);
    setTitle('Untitled Note');
    setContent('');
    setCategory('General');
    setViewMode('edit');
    toast.info("Started a new note.");
  }, []);

  const saveNote = useCallback(() => {
    if (!title.trim()) {
      toast.error("Title cannot be empty.");
      return;
    }

    const now = new Date().toISOString();
    
    if (currentNoteId) {
      setNotes(prev => prev.map(note => 
        note.id === currentNoteId 
          ? { ...note, title, content, category, updatedAt: now }
          : note
      ));
      toast.success("Note updated successfully!");
    } else {
      const newNote: Note = {
        id: Date.now().toString(),
        title,
        content,
        category,
        createdAt: now,
        updatedAt: now
      };
      setNotes(prev => [newNote, ...prev]);
      setCurrentNoteId(newNote.id);
      toast.success("Note saved successfully!");
    }
    
    setIsEditing(false);
    onResult?.({ title, content, category });
  }, [title, content, category, currentNoteId, onResult]);

  const deleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(note => note.id !== noteId));
    if (currentNoteId === noteId) {
      setCurrentNoteId(null);
      setTitle('');
      setContent('');
    }
    toast.success("Note deleted.");
  }, [currentNoteId]);

  const exportNote = useCallback((note: Note) => {
    const blob = new Blob([`# ${note.title}\n\n**Category: ${note.category}**\n_Last updated: ${new Date(note.updatedAt).toLocaleString()}_\n\n---\n\n${note.content}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Note exported as Markdown.");
  }, []);

  const filteredNotes = useMemo(() => notes.filter(note => 
    note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.category.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [notes, searchTerm]);

  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);

  return (
    <div className="h-full flex bg-black/30 backdrop-blur-sm border border-white/20 rounded-lg text-white overflow-hidden">
      {/* Sidebar */}
      <div className="w-1/3 min-w-[250px] border-r border-white/20 flex flex-col">
        <div className="p-3 border-b border-white/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-400" />
              <h3 className="text-lg font-semibold">Notes</h3>
            </div>
            <Button size="icon" variant="ghost" onClick={onClose}><XCircle className="w-5 h-5" /></Button>
          </div>
          <Button onClick={createNewNote} className="w-full bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" />New Note</Button>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 bg-white/10 border-white/20" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map(note => (
            <div key={note.id} onClick={() => setCurrentNoteId(note.id)} className={`p-3 border-b border-white/10 cursor-pointer ${currentNoteId === note.id ? 'bg-green-900/50' : 'hover:bg-white/10'}`}>
              <h4 className="font-semibold truncate">{note.title}</h4>
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{note.content || 'No content'}</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{note.category}</span>
                <span className="text-xs text-gray-500">{new Date(note.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col">
        {currentNoteId || isEditing ? (
          <>
            <div className="p-3 border-b border-white/20">
              <div className="flex items-center gap-3 mb-3">
                <Input placeholder="Note Title" value={title} onChange={(e) => setTitle(e.target.value)} readOnly={!isEditing} className="text-lg font-bold bg-transparent border-0 focus:ring-0 p-0" />
                <Select value={category} onValueChange={setCategory} disabled={!isEditing}>
                  <SelectTrigger className="w-40 bg-white/10 border-white/20"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-gray-900/80 backdrop-blur-sm border-white/20 text-white">{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <Button onClick={saveNote} className="bg-green-600 hover:bg-green-700"><Save className="w-4 h-4 mr-2" />Save</Button>
                      <Button variant="ghost" onClick={() => { setIsEditing(false); if(currentNote) { setTitle(currentNote.title); setContent(currentNote.content); setCategory(currentNote.category); }}}>Cancel</Button>
                    </>
                  ) : (
                    <Button onClick={() => setIsEditing(true)}><Edit className="w-4 h-4 mr-2" />Edit</Button>
                  )}
                  <Button variant="outline" onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')} className="border-white/20">{viewMode === 'edit' ? 'Preview' : 'Edit'}</Button>
                </div>
                <div className="flex gap-2">
                  {currentNote && <Button variant="ghost" size="icon" onClick={() => exportNote(currentNote)}><Download className="w-4 h-4" /></Button>}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      {currentNote && <Button variant="destructive" size="icon"><Trash2 className="w-4 h-4" /></Button>}
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-gray-900/80 backdrop-blur-sm border-white/20 text-white">
                      <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the note "{currentNote?.title}".</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/20">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => currentNote && deleteNote(currentNote.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              {viewMode === 'edit' ? (
                <Textarea placeholder="Start writing your note with Markdown..." value={content} onChange={(e) => setContent(e.target.value)} className="h-full w-full bg-white/10 border-white/20 resize-none font-mono" readOnly={!isEditing} />
              ) : (
                <div className="prose prose-invert max-w-none p-2 bg-white/10 rounded-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
              )}
            </div>
            <div className="p-2 border-t border-white/20 text-xs text-gray-400 flex justify-between">
              <span>{wordCount} words</span>
              {currentNote && <span>Last updated: {new Date(currentNote.updatedAt).toLocaleString()}</span>}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">Select a note to view or create a new one.</div>
        )}
      </div>
    </div>
  );
};

export default NoteTakerPlugin;
