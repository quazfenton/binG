/**
 * RAG Knowledge Store — Barrel Export
 */

export {
  getKnowledgeStore,
  resetKnowledgeStore,
} from './knowledge-store';
export type {
  KnowledgeChunk,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeType,
} from './knowledge-store';

export {
  runRetrievalPipeline,
  detectTaskType,
  ingestFewShot,
  ingestExperience,
  ingestTrajectory,
  ingestRule,
  ingestAntiPattern,
} from './retrieval';
export type {
  RetrievalPipelineOptions,
  RetrievalResult,
} from './retrieval';
