import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Scale, X, Download, FileWarning } from 'lucide-react';
import { toast } from 'sonner';

interface LegalDocumentPluginProps {
  onClose: () => void;
  onResult?: (result: string) => void;
}

const LegalDocumentPlugin: React.FC<LegalDocumentPluginProps> = ({ onClose, onResult }) => {
  const [documentType, setDocumentType] = useState('contract');
  const [inputData, setInputData] = useState('');
  const [generatedDocument, setGeneratedDocument] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState('');
  const [error, setError] = useState<string | null>(null);

  const documentTemplates = {
    contract: `This Agreement ("Agreement") is made effective as of [Date], by and between [Party A] and [Party B].\n\nRECITALS:\nWHEREAS, [Party A] is engaged in the business of [Business of Party A];\nWHEREAS, [Party B] is engaged in the business of [Business of Party B];\nNOW, THEREFORE, in consideration of the mutual covenants contained herein, the parties agree as follows:\n...`,
    nda: `This Non-Disclosure Agreement ("Agreement") entered into on [Date] between [Disclosing Party] ("Disclosing Party") and [Receiving Party] ("Receiving Party").\n\nThe Disclosing Party has developed certain confidential information which it desires to share with the Receiving Party for the purpose of [Purpose of Disclosure].\n...`,
    privacy: `This Privacy Policy describes how [Company Name] ("Company," "we," "us," or "our") collects, uses, and shares your personal information when you use our website [Website URL].\n\nInformation We Collect:\nWe may collect personal identification information from you in a variety of ways, including, but not limited to, when you visit our site, register on the site, and in connection with other activities, services, features or resources we make available on our Site.\n...`,
    terms: `These Terms of Service ("Terms") govern your access to and use of [Service Name] website and services (the "Service").\n\nBy accessing or using the Service you agree to be bound by these Terms. If you disagree with any part of the terms then you may not access the Service. Your access to and use of the Service is conditioned on your acceptance of and compliance with our Privacy Policy.\n...`
  };

  const parseInputData = (data: string): Record<string, string> => {
    return data.split('\n').reduce((acc, line) => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        acc[key.trim()] = valueParts.join(':').trim();
      }
      return acc;
    }, {} as Record<string, string>);
  };

  const generateDocument = useCallback(() => {
    setError(null);
    const template = documentTemplates[documentType as keyof typeof documentTemplates] || '';
    const requiredFields = [...template.matchAll(/\[(.*?)\]/g)].map(match => match[1]);
    const parsedInputs = parseInputData(inputData);
    
    const missingFields = requiredFields.filter(field => !parsedInputs[field]);
    if (missingFields.length > 0) {
      const errorMessage = `Missing required fields: ${missingFields.join(', ')}`;
      setError(errorMessage);
      toast.error('Document Generation Failed', { description: errorMessage });
      return;
    }

    const document = template.replace(/\[(.*?)\]/g, (match, p1) => parsedInputs[p1] || match);
    setGeneratedDocument(document);
    onResult?.(document);
    toast.success('Document generated successfully!');
  }, [documentType, inputData, onResult]);

  const analyzeDocument = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisResult('');
    toast.info('Starting document analysis...');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a legal document analysis AI. Analyze the following document and provide: 1) A brief summary, 2) Key clauses identified, 3) Potential risks or issues, 4) Compliance considerations. Format your response clearly with headers.' },
            { role: 'user', content: generatedDocument }
          ]
        }),
      });
      if (!response.ok) throw new Error('Analysis failed');
      const data = await response.json();
      const analysisText = data.message || data.choices?.[0]?.message?.content || data.content || 'Analysis unavailable';

      setAnalysisResult(analysisText);
      onResult?.(analysisText);
      toast.success('Analysis complete!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      setAnalysisResult(`Error: ${errorMessage}`);
      toast.error('Analysis Failed', { description: errorMessage });
    } finally {
      setIsAnalyzing(false);
    }
  }, [generatedDocument, onResult]);

  const exportDocument = () => {
    if (!generatedDocument) {
      toast.warning('No document to export.');
      return;
    }
    const blob = new Blob([generatedDocument], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${documentType}-document.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Document exported.');
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <CardHeader className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-yellow-400" />
            <CardTitle className="text-lg font-semibold">Legal Document Suite</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Document Type</label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger className="w-full bg-gray-800 border-gray-600">
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-gray-600">
                  <SelectItem value="contract">Contract Agreement</SelectItem>
                  <SelectItem value="nda">Non-Disclosure Agreement</SelectItem>
                  <SelectItem value="privacy">Privacy Policy</SelectItem>
                  <SelectItem value="terms">Terms of Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">Input Data</label>
              <Textarea
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                placeholder={`Enter required information in key: value format, each on a new line.\nExample:\nDate: ${new Date().toISOString().split('T')[0]}\nParty A: John Doe\nParty B: Jane Smith`}
                className="min-h-[220px] bg-gray-800 border-gray-600 focus:ring-yellow-400"
              />
            </div>
            
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-900/50 border border-red-500/50 rounded-lg">
                <FileWarning className="w-5 h-5 text-red-400 mt-1" />
                <div className="flex-1">
                  <p className="font-semibold text-red-300">Input Error</p>
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={generateDocument} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black">
                Generate Document
              </Button>
              <Button
                variant="secondary"
                onClick={analyzeDocument}
                disabled={!generatedDocument || isAnalyzing}
                className="flex-1"
              >
                {isAnalyzing ? 'Analyzing...' : 'AI Analysis'}
              </Button>
              <Button variant="outline" onClick={exportDocument} disabled={!generatedDocument} className="flex-1">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Generated Document</label>
            <div className="flex-1 bg-black/30 border border-gray-700 rounded-lg p-3 text-sm overflow-y-auto">
              {generatedDocument ? (
                <pre className="whitespace-pre-wrap font-mono">{generatedDocument}</pre>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 italic">Document will appear here</p>
                </div>
              )}
            </div>
            
            {analysisResult && (
              <div className="mt-2 p-3 bg-blue-900/50 border border-blue-500/50 rounded-lg">
                 <pre className="whitespace-pre-wrap font-mono text-xs">{analysisResult}</pre>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
};

export default LegalDocumentPlugin;
