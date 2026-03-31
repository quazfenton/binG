/**
 * Mind Map Shared Store
 *
 * ⚠️ LIMITATION: Uses in-memory storage (Map) which is NOT suitable for production.
 * Data will be lost on server restart and is not shared across server instances.
 * For production use, replace with a database (PostgreSQL, MongoDB, etc.).
 */

export interface MindMapNode {
  id: string;
  text: string;
  parentId?: string;
  x: number;
  y: number;
  color?: string;
  icon?: string;
}

export interface MindMap {
  id: string;
  title: string;
  nodes: MindMapNode[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
}

// In-memory store - shared across all mind-map route files
// ⚠️ WARNING: This is for demonstration/prototyping only.
// In production, use a persistent database with proper concurrency handling.
export const mindMaps = new Map<string, MindMap>();

// Seed with sample mind maps once
if (mindMaps.size === 0) {
  mindMaps.set('sample-1', {
    id: 'sample-1',
    title: 'Project Planning',
    nodes: [
      { id: 'root', text: 'Project Goals', x: 400, y: 300, color: '#8B5CF6' },
      { id: 'node-1', text: 'Research', parentId: 'root', x: 200, y: 150, color: '#3B82F6' },
      { id: 'node-2', text: 'Development', parentId: 'root', x: 600, y: 150, color: '#10B981' },
      { id: 'node-3', text: 'Testing', parentId: 'root', x: 400, y: 450, color: '#F59E0B' },
    ],
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 2,
    isPublic: true,
  });

  mindMaps.set('sample-2', {
    id: 'sample-2',
    title: 'Learning Path',
    nodes: [
      { id: 'root', text: 'Web Development', x: 400, y: 300, color: '#EC4899' },
      { id: 'node-1', text: 'HTML/CSS', parentId: 'root', x: 200, y: 150, color: '#F97316' },
      { id: 'node-2', text: 'JavaScript', parentId: 'root', x: 600, y: 150, color: '#FACC15' },
    ],
    createdAt: Date.now() - 86400000 * 10,
    updatedAt: Date.now() - 86400000 * 7,
    isPublic: true,
  });
}
