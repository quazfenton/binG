import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Cloud, X, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { FEATURE_FLAGS } from '@/config/features';
import { cloudStorage } from '@/lib/services/cloud-storage';

const CloudStoragePlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { isAuthenticated, user } = useAuth();
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [diffContent, setDiffContent] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [quotaUsedBytes, setQuotaUsedBytes] = useState<number>(0);
  const diffRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isAuthenticated || !FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) return;
    const email = user?.email || 'anonymous';
    (async () => {
      try {
        const listing = await cloudStorage?.list('', email);
        setFiles(listing || []);
        // In dev, we do not have persisted usage; show calculated from mocked listing lengths
        setQuotaUsedBytes(0);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [isAuthenticated]);

  // removed helper in favor of context value

  const handleFileSelect = (file: string) => {
    setSelectedFile(file);
    // Mock file content
    setFileContent(`Content of ${file}\n\nThis is a sample file content.`);
    setDiffContent('');
  };

  const handleGenerateDiff = () => {
    if (!diffRef.current || !fileContent) return;
    
    const newContent = diffRef.current.value;
    if (newContent === fileContent) {
      toast('No Changes', {
        description: 'The file content has not changed',
      });
      return;
    }
    
    // Generate line-by-line diff
    const oldLines = fileContent.split('\n');
    const newLines = newContent.split('\n');
    let diffLines: string[] = [];
    
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (i >= oldLines.length) {
        diffLines.push(`+ ${newLines[i]}`);
      } else if (i >= newLines.length) {
        diffLines.push(`- ${oldLines[i]}`);
      } else if (oldLines[i] !== newLines[i]) {
        diffLines.push(`- ${oldLines[i]}`);
        diffLines.push(`+ ${newLines[i]}`);
      } else {
        diffLines.push(`  ${oldLines[i]}`);
      }
    }
    
    setDiffContent(diffLines.join('\n'));
  };

  const handleApplyDiff = async () => {
    if (!diffContent || !selectedFile) return;
    
    try {
      // Apply diff locally
      const newContent = diffRef.current?.value || '';
      
      // Update file content and increment version
      setFileContent(newContent);
      setDiffContent('');
      
      toast.success('Changes Applied', {
        description: 'File updated successfully',
      });
      
      // Save to cloud (dev stub)
      const email = user?.email || 'anonymous';
      const blob = new Blob([newContent], { type: 'text/plain' });
      // @ts-ignore File constructor may not be available in all envs
      const f = new File([blob], selectedFile, { type: 'text/plain' });
      const url = await cloudStorage?.upload(f, selectedFile, email);
      console.log('Saved file to:', url);
    } catch (error) {
      console.error('Error applying diff:', error);
      toast.error('Apply Error', {
        description: 'Failed to apply changes',
      });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE && (
        <div className="p-3 text-xs bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
          Cloud storage is disabled by configuration. Set ENABLE_CLOUD_STORAGE=true to enable.
        </div>
      )}
      <CardHeader className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-lg">
              Cloud Storage {!isAuthenticated && <Lock className="w-4 h-4 text-red-400" />}
            </CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      
      {!isAuthenticated ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <Lock className="w-12 h-12 text-red-400 mb-4" />
          <h3 className="text-xl font-medium mb-2">Cloud Storage Locked</h3>
          <p className="text-white/70 mb-4">
            Please log in to access cloud storage features
          </p>
        </div>
      ) : (
        <CardContent className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2 text-xs text-white/70">
              <span>Per-account quota: 5GB</span>
              <span>Used: {(quotaUsedBytes / (1024*1024)).toFixed(2)} MB</span>
            </div>
            <h3 className="text-sm font-medium mb-2">Select a File</h3>
            <div className="grid grid-cols-2 gap-2">
              {files.map((file) => (
                <Button
                  key={file}
                  variant={selectedFile === file ? "default" : "secondary"}
                  className="text-left justify-start truncate"
                  onClick={() => handleFileSelect(file)}
                >
                  {file}
                </Button>
              ))}
            </div>
          </div>
          
          {selectedFile && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">File Content</h3>
                <textarea
                  ref={diffRef}
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-40 bg-black/20 border border-white/20 rounded p-2 text-sm font-mono"
                />
              </div>
              
              <div className="flex gap-2">
                <Button onClick={handleGenerateDiff} variant="outline">
                  Generate
                </Button>
                <Button onClick={handleApplyDiff} disabled={!diffContent}>
                  Apply Changes
                </Button>
              </div>
              
              {diffContent && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Changes</h3>
                  <pre className="text-xs bg-black/30 p-2 rounded max-h-40 overflow-y-auto">
                    {diffContent}
                  </pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </div>
  );
};

export default CloudStoragePlugin;