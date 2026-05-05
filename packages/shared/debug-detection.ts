/**
 * Debug incomplete response detection
 */

import { detectIncompleteResponse } from './agent/feedback-injection';

const testCase = {
  name: 'User case from autocontinue.md',
  response: 'To create a web game like slither.io, we need to implement the following features:\n\n#### 1. index.html**This file will contain',
};

console.log('Testing:', testCase.name);
console.log('Response:', JSON.stringify(testCase.response));
console.log('Response length:', testCase.response.length);
console.log('');

const trimmed = testCase.response.trim();
console.log('Trimmed:', JSON.stringify(trimmed));
console.log('Trimmed length:', trimmed.length);
console.log('');

const tailLength = Math.min(500, trimmed.length);
const tail = trimmed.slice(-tailLength);
console.log('Tail (last 500 chars):', JSON.stringify(tail));
console.log('');

const lines = tail.split('\n');
console.log('Lines:', lines);
console.log('Last line:', JSON.stringify(lines[lines.length - 1]));
console.log('');

const last50 = trimmed.slice(-50);
console.log('Last 50 chars:', JSON.stringify(last50));
console.log('Ends with letter:', /[a-zA-Z0-9]$/.test(last50));
console.log('Ends with punctuation:', /[.!?。！？]$/.test(last50));
console.log('Has double newline:', /\n\n/.test(last50));
console.log('');

const lastLine = lines[lines.length - 1] || '';
console.log('Last line:', JSON.stringify(lastLine));
console.log('Ends with list marker:', /^[\s]*[-*+]\s*$/.test(lastLine) || /^[\s]*\d+\.\s*$/.test(lastLine) || /^[\s]*\d+\.$/.test(lastLine));
console.log('Ends with incomplete header:', /^#{1,6}\s[^#\n]*$/.test(lastLine) && lastLine.length < 100);
console.log('Ends mid-word:', /[a-zA-Z]{3,}$/.test(lastLine) && !/[.!?，。！？\s]$/.test(lastLine) && lastLine.length < 30);
console.log('');

const result = detectIncompleteResponse(testCase.response);
console.log('Result:', result);
console.log('Detected:', result.detected);
console.log('Confidence:', result.confidence);
console.log('Reason:', result.reason);