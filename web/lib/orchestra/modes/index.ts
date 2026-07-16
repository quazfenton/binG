// Modes delegate the continuation decision to processUnifiedAgentRequest upstream. If you need a continuation loop here, use runAutoContinueLoop instead of rolling your own.
/**
 * Agent Execution Modes — Barrel Export
 *
 * Extended execution modes for the unified agent service, derived from
 * 0harness.md concepts. Each mode is a self-contained function that
 * calls processUnifiedAgentRequest internally.
 */

export {
  runDualProcessMode,
  type DualProcessConfig,
} from './dual-process';

export {
  runAdversarialVerifyMode,
  type AdversarialConfig,
} from './adversarial-verify';

export {
  runAttractorDrivenMode,
  type AttractorConfig,
  type Attractor,
  type AttractorAlignment,
} from './attractor-driven';

export {
  runIntentDrivenMode,
  type IntentFieldConfig,
  type IntentVector,
} from './intent-driven';

export {
  runEnergyDrivenMode,
  type EnergyDrivenConfig,
} from './energy-driven';

export {
  runDistributedCognitionMode,
  type DistributedConfig,
} from './distributed-cognition';

export {
  runCognitiveResonanceMode,
  type ResonanceConfig,
} from './cognitive-resonance';

export {
  runExecutionControllerMode,
  type ExecutionControllerConfig,
  type Evaluation,
  type CompletionScore,
  type TriggerResult,
} from './execution-controller';
