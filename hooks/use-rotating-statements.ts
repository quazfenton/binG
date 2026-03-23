import { useState, useEffect, useCallback } from 'react';

export const FUNNY_STATEMENTS = [
  "Consulting the oracle...",
  "Asking the digital spirits...",
  "Convincing the AI to be helpful...",
  "Wrestling with algorithms...",
  "Feeding the hamsters...",
  "Untangling neural pathways...",
  "Negotiating with the model...",
  "Bribing the algorithm with tokens...",
  "Convincing silicon to think...",
  "Rounding up the digital cows...",
  "Herding mathematical cats...",
  "Teaching neurons to dance...",
  "Debugging the existential dread...",
  "Consulting the rubber duck...",
  "Waiting for electrons to decide...",
];

export const INTERESTING_STATEMENTS = [
  "Processing your request...",
  "Analyzing the query...",
  "Synthesizing information...",
  "Connecting knowledge nodes...",
  "Generating insights...",
  "Constructing responses...",
  "Exploring the solution space...",
  "Building the answer...",
  "Computing possibilities...",
  "Formulating thoughts...",
  "Mapping concepts...",
  "Reasoning through options...",
  "Evaluating approaches...",
  "Crafting the perfect response...",
  "Searching the knowledge base...",
];

export const TASK_STATEMENTS = [
  "Reading files...",
  "Searching codebase...",
  "Analyzing code structure...",
  "Finding relevant code...",
  "Examining dependencies...",
  "Parsing configuration...",
  "Loading context...",
  "Building context window...",
  "Preparing tools...",
  "Setting up environment...",
  "Gathering requirements...",
  "Reviewing documentation...",
  "Tracing execution flow...",
  "Identifying patterns...",
  "Compiling results...",
];

export type StatementType = 'funny' | 'interesting' | 'task';

interface UseRotatingStatementsOptions {
  statementType?: StatementType;
  intervalMs?: number;
}

export function useRotatingStatements(options: UseRotatingStatementsOptions = {}) {
  const { statementType = 'interesting', intervalMs = 2500 } = options;
  
  const getStatements = useCallback(() => {
    switch (statementType) {
      case 'funny':
        return FUNNY_STATEMENTS;
      case 'task':
        return TASK_STATEMENTS;
      case 'interesting':
      default:
        return INTERESTING_STATEMENTS;
    }
  }, [statementType]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const statements = getStatements();

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % statements.length);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [statements.length, intervalMs]);

  return statements[currentIndex];
}

export function useMultiRotatingStatements(types: StatementType[] = ['interesting', 'funny', 'task'], intervalMs = 3000) {
  const [typeIndex, setTypeIndex] = useState(0);
  const [statement, setStatement] = useState('');
  
  const currentType = types[typeIndex];
  const rotatingStatement = useRotatingStatements({ statementType: currentType, intervalMs });
  
  useEffect(() => {
    setStatement(rotatingStatement);
  }, [rotatingStatement]);
  
  useEffect(() => {
    const typeInterval = setInterval(() => {
      setTypeIndex((prev) => (prev + 1) % types.length);
    }, intervalMs * 2);
    
    return () => clearInterval(typeInterval);
  }, [types.length, intervalMs]);
  
  return statement;
}
