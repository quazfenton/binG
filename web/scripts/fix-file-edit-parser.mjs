/**
 * Fix file-edit-parser.ts to support additional LLM output formats
 */
import fs from 'fs';
import path from 'path';

const filePath = path.join('web/lib/chat/file-edit-parser.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add missing format markers to hasAnyMarker detection
const oldMarker = "    content.includes('<file_edit') ||\n    content.includes('<file_write') ||\n    content.includes('ws_action') ||";
const newMarker = "    content.includes('<file_edit') ||\n    content.includes('<file_write') ||\n    content.includes('<write_file') ||\n    content.includes('