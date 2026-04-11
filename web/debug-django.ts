import { detectProject, type PreviewRequest } from './lib/previews/live-preview-offloading.ts';

// Test Django detection
const files1: Record<string, string> = {
  'requirements.txt': 'django==4',
  'manage.py': 'import django'
};
const result1 = detectProject({ files: files1 } as PreviewRequest);
console.log('Test 1 - Django (minimal):', result1.framework, result1.previewMode);

// Test with more explicit content
const files2: Record<string, string> = {
  'requirements.txt': 'django==4.0.0',
  'app.py': 'from django import django\ndjango.setup()'
};
const result2 = detectProject({ files: files2 } as PreviewRequest);
console.log('Test 2 - Django (explicit):', result2.framework, result2.previewMode);

// Test with Django settings
const files3: Record<string, string> = {
  'requirements.txt': 'Django==4.0.0',
  'settings.py': 'import django\ndjango.setup()'
};
const result3 = detectProject({ files: files3 } as PreviewRequest);
console.log('Test 3 - Django (settings):', result3.framework, result3.previewMode);