"use client"

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Calculator, Copy, Check, History } from 'lucide-react';
import type { PluginProps } from './plugin-manager';

export const CalculatorPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const inputNumber = (num: string) => {
    if (waitingForOperand) {
      setDisplay(num);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? num : display + num);
    }
  };

  const inputOperation = (nextOperation: string) => {
    const inputValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operation) {
      const currentValue = previousValue || 0;
      const newValue = calculate(currentValue, inputValue, operation);

      setDisplay(String(newValue));
      setPreviousValue(newValue);
      
      // Add to history
      const calculation = `${currentValue} ${operation} ${inputValue} = ${newValue}`;
      setHistory(prev => [calculation, ...prev.slice(0, 9)]); // Keep last 10
    }

    setWaitingForOperand(true);
    setOperation(nextOperation);
  };

  const calculate = (firstValue: number, secondValue: number, operation: string): number => {
    try {
      switch (operation) {
        case '+':
          return firstValue + secondValue;
        case '-':
          return firstValue - secondValue;
        case '×':
          return firstValue * secondValue;
        case '÷':
          if (secondValue === 0) {
            throw new Error('Division by zero is not allowed');
          }
          return firstValue / secondValue;
        case '=':
          return secondValue;
        default:
          return secondValue;
      }
    } catch (error) {
      console.error('Calculator error:', error);
      throw error;
    }
  };

  const performCalculation = () => {
    try {
      const inputValue = parseFloat(display);

      if (isNaN(inputValue)) {
        throw new Error('Invalid number input');
      }

      if (previousValue !== null && operation) {
        const newValue = calculate(previousValue, inputValue, operation);
        const calculation = `${previousValue} ${operation} ${inputValue} = ${newValue}`;
        
        if (!isFinite(newValue)) {
          throw new Error('Result is not a finite number');
        }
        
        setDisplay(String(newValue));
        setPreviousValue(null);
        setOperation(null);
        setWaitingForOperand(true);
        setHistory(prev => [calculation, ...prev.slice(0, 9)]);
        
        onResult?.(newValue);
      }
    } catch (error) {
      console.error('Calculation error:', error);
      setDisplay('Error');
      setPreviousValue(null);
      setOperation(null);
      setWaitingForOperand(true);
      
      // In enhanced mode, this error will be caught by the isolation system
      throw error;
    }
  };

  const clear = () => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setWaitingForOperand(false);
  };

  const clearEntry = () => {
    setDisplay('0');
  };

  const inputDecimal = () => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
    } else if (display.indexOf('.') === -1) {
      setDisplay(display + '.');
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const buttonClass = "h-12 text-lg font-semibold transition-all duration-150 active:scale-95";
  const numberButtonClass = `${buttonClass} bg-gray-700 hover:bg-gray-600 text-white`;
  const operatorButtonClass = `${buttonClass} bg-blue-600 hover:bg-blue-700 text-white`;
  const specialButtonClass = `${buttonClass} bg-gray-600 hover:bg-gray-500 text-white`;

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Calculator</h3>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={copyResult}
          className="text-white/60 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 mr-1" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Display */}
      <div className="bg-black/40 border border-white/20 rounded-lg p-4">
        <div className="text-right text-2xl font-mono text-white overflow-hidden">
          {display}
        </div>
      </div>

      {/* Calculator Grid */}
      <div className="grid grid-cols-4 gap-2 flex-1">
        <Button onClick={clear} className={specialButtonClass}>
          AC
        </Button>
        <Button onClick={clearEntry} className={specialButtonClass}>
          CE
        </Button>
        <Button onClick={() => inputOperation('÷')} className={operatorButtonClass}>
          ÷
        </Button>
        <Button onClick={() => inputOperation('×')} className={operatorButtonClass}>
          ×
        </Button>

        <Button onClick={() => inputNumber('7')} className={numberButtonClass}>
          7
        </Button>
        <Button onClick={() => inputNumber('8')} className={numberButtonClass}>
          8
        </Button>
        <Button onClick={() => inputNumber('9')} className={numberButtonClass}>
          9
        </Button>
        <Button onClick={() => inputOperation('-')} className={operatorButtonClass}>
          -
        </Button>

        <Button onClick={() => inputNumber('4')} className={numberButtonClass}>
          4
        </Button>
        <Button onClick={() => inputNumber('5')} className={numberButtonClass}>
          5
        </Button>
        <Button onClick={() => inputNumber('6')} className={numberButtonClass}>
          6
        </Button>
        <Button onClick={() => inputOperation('+')} className={operatorButtonClass}>
          +
        </Button>

        <Button onClick={() => inputNumber('1')} className={numberButtonClass}>
          1
        </Button>
        <Button onClick={() => inputNumber('2')} className={numberButtonClass}>
          2
        </Button>
        <Button onClick={() => inputNumber('3')} className={numberButtonClass}>
          3
        </Button>
        <Button 
          onClick={performCalculation} 
          className={`${operatorButtonClass} row-span-2`}
        >
          =
        </Button>

        <Button 
          onClick={() => inputNumber('0')} 
          className={`${numberButtonClass} col-span-2`}
        >
          0
        </Button>
        <Button onClick={inputDecimal} className={numberButtonClass}>
          .
        </Button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="bg-black/20 border border-white/10 rounded-lg p-3 max-h-32 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <History className="w-4 h-4 text-white/60" />
            <span className="text-sm text-white/60">History</span>
          </div>
          <div className="space-y-1">
            {history.map((calc, index) => (
              <div key={index} className="text-xs text-white/80 font-mono">
                {calc}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalculatorPlugin;