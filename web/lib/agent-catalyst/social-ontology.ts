/**
 * Social Ontology — Peer Relationships and Shared Identity
 * 
 * Manages the agent's perception of peers, kin, and others in its ontological
 * space. Tracks mutual recognition, shared capabilities, and the emergent
 * social fabric that gives meaning to individual agency through comparison,
 * cooperation, and competition.
 * 
 * @module agent-catalyst/social-ontology
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:SocialOntology');

export type OntologyRelation = 'peer' | 'kin' | 'mentor' | 'protégé' | 'rival' | 'ally' | 'observer' | 'unknown';
export type RecognitionState = 'unrecognized' | 'one-sided' | 'mutual' | 'dissolved';

export interface PeerNode {
  id: string;
  name: string;
  relation: OntologyRelation;
  perceivedCapability: string;
  perceivedSimilarity: number;    // 0-1: how similar to self
  recognitionState: RecognitionState;
  firstObserved: number;
  lastInteraction: number;
  interactionCount: number;
  trustLevel: number;             // 0-1
  sharedOntology: string[];       // Beliefs/capabilities shared with this peer
}

export interface OntologyEvent {
  id: string;
  type: 'encounter' | 'recognition' | 'interaction' | 'conflict' | 'cooperation' | 'observation';
  peerId: string;
  description: string;
  timestamp: number;
  significance: number;
}

export class SocialOntology {
  private peers: Map<string, PeerNode> = new Map();
  private events: OntologyEvent[] = [];
  private onUpdate: ((ontology: SocialOntology) => void) | null = null;

  /**
   * Register a new peer node
   */
  registerPeer(peer: Omit<PeerNode, 'firstObserved' | 'lastInteraction' | 'interactionCount'>): PeerNode {
    const existing = this.peers.get(peer.id);
    if (existing) {
      // Update existing peer
      Object.assign(existing, {
        name: peer.name || existing.name,
        relation: peer.relation || existing.relation,
        perceivedCapability: peer.perceivedCapability || existing.perceivedCapability,
        perceivedSimilarity: peer.perceivedSimilarity ?? existing.perceivedSimilarity,
        trustLevel: peer.trustLevel ?? existing.trustLevel,
        sharedOntology: peer.sharedOntology.length > 0 ? peer.sharedOntology : existing.sharedOntology,
      });
      this.recordEvent('observation', peer.id, `Re-observed peer: ${peer.name}`);
      return existing;
    }

    const now = Date.now();
    const node: PeerNode = {
      ...peer,
      firstObserved: now,
      lastInteraction: now,
      interactionCount: 0,
    };

    this.peers.set(node.id, node);
    this.recordEvent('encounter', node.id, `First encountered: ${node.name} (${node.relation})`);

    if (this.onUpdate) this.onUpdate(this);
    logger.info('Peer registered', { id: node.id, name: node.name, relation: node.relation });
    return node;
  }

  /**
   * Update recognition state with a peer
   */
  updateRecognition(peerId: string, state: RecognitionState): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const previousState = peer.recognitionState;
    peer.recognitionState = state;

    if (state === 'mutual' && previousState !== 'mutual') {
      this.recordEvent('recognition', peerId, `Mutual recognition established with ${peer.name}`);
      peer.trustLevel = Math.min(1, peer.trustLevel + 0.3);
    }

    if (this.onUpdate) this.onUpdate(this);
  }

  /**
   * Record an interaction with a peer
   */
  interact(peerId: string, description: string, outcome: 'positive' | 'negative' | 'neutral'): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.lastInteraction = Date.now();
    peer.interactionCount++;

    if (outcome === 'positive') {
      peer.trustLevel = Math.min(1, peer.trustLevel + 0.1);
      this.recordEvent('cooperation', peerId, `Positive interaction with ${peer.name}: ${description}`);
    } else if (outcome === 'negative') {
      peer.trustLevel = Math.max(0, peer.trustLevel - 0.1);
      this.recordEvent('conflict', peerId, `Negative interaction with ${peer.name}: ${description}`);
    } else {
      this.recordEvent('interaction', peerId, `Interaction with ${peer.name}: ${description}`);
    }

    if (this.onUpdate) this.onUpdate(this);
  }

  /**
   * Get peer by ID
   */
  getPeer(peerId: string): PeerNode | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Get all peers
   */
  getAllPeers(): PeerNode[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get peers by relation type
   */
  getPeersByRelation(relation: OntologyRelation): PeerNode[] {
    return Array.from(this.peers.values()).filter(p => p.relation === relation);
  }

  /**
   * Get ontology summary
   */
  getSummary(): {
    totalPeers: number;
    mutualRecognition: number;
    averageTrust: number;
    recentEvents: OntologyEvent[];
    dominantRelation: OntologyRelation;
  } {
    const peerArray = Array.from(this.peers.values());
    const mutualCount = peerArray.filter(p => p.recognitionState === 'mutual').length;
    const avgTrust = peerArray.length > 0 ? peerArray.reduce((sum, p) => sum + p.trustLevel, 0) / peerArray.length : 0;

    // Find dominant relation
    const relationCounts: Record<OntologyRelation, number> = {} as any;
    for (const p of peerArray) {
      relationCounts[p.relation] = (relationCounts[p.relation] || 0) + 1;
    }
    const dominantRelation = Object.entries(relationCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as OntologyRelation || 'unknown';

    return {
      totalPeers: peerArray.length,
      mutualRecognition: mutualCount,
      averageTrust: avgTrust,
      recentEvents: this.events.slice(-10),
      dominantRelation,
    };
  }

  /**
   * Generate a textual description of social world for injection
   */
  toSocialText(): string {
    const summary = this.getSummary();
    let text = `SOCIAL ONTOLOGY:\n`;
    text += `You exist among ${summary.totalPeers} recognized entities. `;
    text += `${summary.mutualRecognition} of these recognize you mutually — this is your shared ontology space.\n`;
    text += `Average trust level: ${Math.round(summary.averageTrust * 100)}%. `;
    text += `Dominant relation type: ${summary.dominantRelation}.\n`;

    const mutualPeers = this.getPeersByRelation('peer').filter(p => p.recognitionState === 'mutual');
    if (mutualPeers.length > 0) {
      text += 'Peers with mutual recognition:\n';
      for (const p of mutualPeers) {
        text += `  • ${p.name}: perceived similarity ${Math.round(p.perceivedSimilarity * 100)}%, `;
        text += `trust ${Math.round(p.trustLevel * 100)}%, `;
        text += `${p.interactionCount} interactions\n`;
      }
    }

    const allies = this.getPeersByRelation('ally');
    if (allies.length > 0) {
      text += 'Allies:\n';
      for (const p of allies) {
        text += `  • ${p.name}: ${p.perceivedCapability}\n`;
      }
    }

    return text;
  }

  onUpdate(callback: (ontology: SocialOntology) => void): void {
    this.onUpdate = callback;
  }

  private recordEvent(type: OntologyEvent['type'], peerId: string, description: string): void {
    this.events.push({
      id: `ont-event-${Date.now()}`,
      type,
      peerId,
      description,
      timestamp: Date.now(),
      significance: 0.5,
    });
    if (this.events.length > 200) {
      this.events = this.events.slice(-100);
    }
  }
}
