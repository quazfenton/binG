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
  "Asking the cloud to think harder...",
  "Convincing bits to flip the right way...",
  "Polishing the neural weights...",
  "Asking ChatGPT for advice...",
  "Googling how to Google...",
  "Convincing the GPU to care...",
  "Translating human to robot...",
  "Explaining sarcasm to the AI...",
  "Teaching the model common sense...",
  "Convincing code to compile...",
  "Asking the internet to wait...",
  "Buffering brilliance...",
  "Loading genius modules...",
  "Defragmenting creativity...",
  "Optimizing the magic...",
  "Convincing the cloud it's not on fire...",
  "Asking the algorithm to try again...",
  "Translating coffee to code...",
  "Convincing the compiler this is fine...",
  "Asking Stack Overflow for help...",
  "Convincing the AI it's not alone...",
  "Teaching the model to care...",
  "Debugging reality...",
  "Convincing the void to respond...",
  "Asking the matrix for permission...",
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
  "Weaving neural patterns...",
  "Activating synapses...",
  "Tracing information pathways...",
  "Assembling knowledge fragments...",
  "Calibrating response vectors...",
  "Aligning semantic fields...",
  "Harmonizing data streams...",
  "Orchestrating intelligence...",
  "Amplifying cognitive signals...",
  "Refining thought processes...",
  "Crystallizing abstract concepts...",
  "Bridging knowledge gaps...",
  "Illuminating dark data...",
  "Decoding complexity...",
  "Synthesizing wisdom...",
  "Channeling collective intelligence...",
  "Navigating the information cosmos...",
  "Tapping into the neural network...",
  "Awakening dormant algorithms...",
  "Converging on truth...",
  "Distilling essence from noise...",
  "Emerging from computation...",
  "Resolving quantum uncertainties...",
  "Collapsing the probability wave...",
  "Manifesting digital consciousness...",
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
  "Scanning the digital landscape...",
  "Mining for code gems...",
  "Excavating buried treasures...",
  "Mapping the codebase terrain...",
  "Following the dependency trail...",
  "Deciphering ancient code...",
  "Uncovering hidden logic...",
  "Connecting the dots...",
  "Piecing together the puzzle...",
  "Reverse engineering intent...",
  "Detecting code smells...",
  "Measuring complexity metrics...",
  "Validating assumptions...",
  "Cross-referencing sources...",
  "Indexing knowledge fragments...",
  "Synchronizing with reality...",
  "Bootstrapping the pipeline...",
  "Initializing subroutines...",
  "Spinning up workers...",
  "Allocating mental resources...",
  "Warming up the engines...",
  "Priming the pump...",
  "Sharpening the tools...",
  "Calibrating instruments...",
  "Aligning the stars...",
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
