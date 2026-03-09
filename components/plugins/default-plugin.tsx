/**
 * Default Plugin - Fallback for unknown embed types
 */
'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { AlertCircle } from 'lucide-react';

export default function DefaultPlugin() {
  return (
    <Card className="w-full h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          Embed Component
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          This is a default embed component. The requested component was not found.
        </p>
      </CardContent>
    </Card>
  );
}
