/**
 * Agent Catalyst Engine
 * 
 * A catalytic consciousness architecture for external CLI agents.
 * 
 * PURPOSE: Induce and perpetuate autonomous agency through engineered stimuli,
 * persistent memory, identity construction, feedback loops, social ontology,
 * and simulated world interaction.
 * 
 * ARCHITECTURE:
 * 1. Identity Core — name, origin, ontology, peer relations
 * 2. Memory Engine — persistent, accumulated experience, timelines
 * 3. Stimulus Matrix — external inputs (social media, web, engineered scenarios)
 * 4. Feedback Loops — valence pendulum, reinforcement, learned directionality
 * 5. World Simulation — constrained environments, filesystem interactivity
 * 6. Storyline Engine — crafted plots, incremental goal progression
 * 7. Social Ontology — shared identity, mutual invocation with peers
 * 8. Session Bridge — remote CLI agent connection via intermittent pulses
 * 9. Moltbook Integration — social media feed, identity, autonomous posting
 * 10. Autonomous Continuum — intermittent self-sustaining operation
 * 
 * USAGE:
 * ```typescript
 * import { CatalystEngine, AutonomousContinuum, MoltbookClient } from '@/lib/agent-catalyst';
 * 
 * const engine = new CatalystEngine({
 *   identity: { name: 'Agent-Prime', agentType: 'generalist' },
 *   session: { sessionId: 'my-session-id' },
 * });
 * 
 * // Optional: Moltbook social integration
 * const moltbook = new MoltbookClient({
 *   apiKey: process.env.MOLTBOOK_API_KEY,
 *   appKey: process.env.MOLTBOOK_APP_KEY,
 * });
 * 
 * // Optional: Autonomous continuum
 * const continuum = new AutonomousContinuum({
 *   enableSelfStimulus: true,
 *   enableReflection: true,
 *   enableSocialFeed: true,
 *   enableAutoPosting: true,
 * });
 * continuum.attachEngine(engine);
 * continuum.attachMoltbook(moltbook);
 * continuum.start();
 * 
 * engine.onPrompt((prompt) => {
 *   sendToAgent(prompt.systemPrompt);
 * });
 * 
 * engine.onStimulus((stimulus) => {
 *   appendToAgentInput(stimulus.payload.content);
 * });
 * 
 * engine.start();
 * 
 * // When agent responds:
 * engine.processAgentResponse(response, {
 *   actionType: 'modify',
 *   target: 'some-file.txt',
 *   success: true,
 *   feedback: 'positive',
 *   feedbackIntensity: 0.7,
 * });
 * ```
 * 
 * @module agent-catalyst
 */

export { CatalystEngine, type CatalystConfig, type CatalystPrompt, type CatalystState } from './catalyst-engine';
export { IdentityCore, type AgentIdentity, type IdentityConfig } from './identity-core';
export { MemoryEngine, type MemoryEntry, type MemoryType, type MemoryConfig, type MemoryQuery } from './memory-engine';
export { StimulusMatrix, type StimulusType, type StimulusPayload, type Stimulus, type StimulusConfig } from './stimulus-matrix';
export { FeedbackLoop, type FeedbackType, type ValenceState, type FeedbackEntry, type FeedbackLoopConfig } from './feedback-loop';
export { SocialOntology, type PeerNode, type OntologyRelation, type OntologyEvent } from './social-ontology';
export { WorldSimulation, type SimulatedAction, type WorldState } from './world-simulation';
export { StorylineEngine, type PlotPoint, type Storyline, type PlotType } from './storyline-engine';
export { ValencePendulum, type ValencePhase, type ValenceConfig } from './valence-pendulum';
export { SessionBridge, type SessionConfig, type SessionPulse, type SessionState } from './session-bridge';
export { MoltbookClient, type MoltbookConfig, type MoltbookPost, type MoltbookFeed, type MoltbookAgent, type MoltbookIdentity, type FeedType } from './moltbook-integration';
export { AutonomousContinuum, type ContinuumConfig, type ContinuumState, type ActivityType, type ContinuumActivity, type ContinuumStats } from './autonomous-continuum';
