/**
 * E2B Network Isolation
 * 
 * Provides network isolation and security for E2B sandboxes.
 * Controls outbound/inbound traffic and enforces network policies.
 * 
 * Features:
 * - Outbound traffic filtering
 * - Inbound traffic control
 * - Allowed hosts configuration
 * - Network policy enforcement
 */

/**
 * Network policy configuration
 */
export interface NetworkPolicy {
  /**
   * Policy name
   */
  name: string;
  
  /**
   * Allowed outbound hosts
   */
  allowedHosts?: string[];
  
  /**
   * Blocked outbound hosts
   */
  blockedHosts?: string[];
  
  /**
   * Allowed ports
   */
  allowedPorts?: number[];
  
  /**
   * Blocked ports
   */
  blockedPorts?: number[];
  
  /**
   * Allow all outbound traffic
   */
  allowAllOutbound?: boolean;
  
  /**
   * Allow all inbound traffic
   */
  allowAllInbound?: boolean;
  
  /**
   * Enable network monitoring
   */
  enableMonitoring?: boolean;
}

/**
 * Network traffic log entry
 */
export interface NetworkTrafficLog {
  /**
   * Timestamp
   */
  timestamp: number;
  
  /**
   * Sandbox ID
   */
  sandboxId: string;
  
  /**
   * Direction (outbound/inbound)
   */
  direction: 'outbound' | 'inbound';
  
  /**
   * Destination/source host
   */
  host: string;
  
  /**
   * Port
   */
  port: number;
  
  /**
   * Protocol
   */
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  
  /**
   * Bytes transferred
   */
  bytes: number;
  
  /**
   * Whether traffic was allowed
   */
  allowed: boolean;
  
  /**
   * Block reason if blocked
   */
  blockReason?: string;
}

/**
 * E2B Network Isolation Manager
 * 
 * Manages network isolation for sandboxes.
 */
export class E2BNetworkIsolation {
  private policies: Map<string, NetworkPolicy> = new Map();
  private trafficLogs: NetworkTrafficLog[] = [];
  private readonly MAX_LOGS = 10000;

  constructor() {
    // Add default policy
    this.addPolicy({
      name: 'default',
      allowAllOutbound: true,
      allowAllInbound: false,
      enableMonitoring: true,
    });
  }

  /**
   * Add network policy
   * 
   * @param policy - Network policy
   */
  addPolicy(policy: NetworkPolicy): void {
    this.policies.set(policy.name, policy);
  }

  /**
   * Get network policy
   * 
   * @param name - Policy name
   * @returns Network policy or null
   */
  getPolicy(name: string): NetworkPolicy | null {
    return this.policies.get(name) || null;
  }

  /**
   * Check if host is allowed
   * 
   * @param policy - Network policy
   * @param host - Host to check
   * @returns Whether host is allowed
   */
  isHostAllowed(policy: NetworkPolicy, host: string): boolean {
    // Check blocked hosts first
    if (policy.blockedHosts) {
      for (const blocked of policy.blockedHosts) {
        if (this.hostMatches(host, blocked)) {
          return false;
        }
      }
    }

    // If allow all is enabled, allow everything not blocked
    if (policy.allowAllOutbound) {
      return true;
    }

    // Check allowed hosts
    if (policy.allowedHosts) {
      for (const allowed of policy.allowedHosts) {
        if (this.hostMatches(host, allowed)) {
          return true;
        }
      }
      return false;
    }

    // Default deny if no allowed hosts specified
    return false;
  }

  /**
   * Check if port is allowed
   * 
   * @param policy - Network policy
   * @param port - Port to check
   * @returns Whether port is allowed
   */
  isPortAllowed(policy: NetworkPolicy, port: number): boolean {
    // Check blocked ports first
    if (policy.blockedPorts?.includes(port)) {
      return false;
    }

    // If no allowed ports specified, allow all not blocked
    if (!policy.allowedPorts || policy.allowedPorts.length === 0) {
      return true;
    }

    return policy.allowedPorts.includes(port);
  }

  /**
   * Log network traffic
   * 
   * @param log - Traffic log entry
   */
  logTraffic(log: NetworkTrafficLog): void {
    this.trafficLogs.push(log);
    
    // Enforce max logs
    if (this.trafficLogs.length > this.MAX_LOGS) {
      this.trafficLogs.shift();
    }
  }

  /**
   * Get traffic logs
   * 
   * @param options - Filter options
   * @returns Array of traffic logs
   */
  getTrafficLogs(options?: {
    sandboxId?: string;
    direction?: 'outbound' | 'inbound';
    allowed?: boolean;
    limit?: number;
    since?: number;
  }): NetworkTrafficLog[] {
    let filtered = [...this.trafficLogs];

    if (options?.sandboxId) {
      filtered = filtered.filter(l => l.sandboxId === options.sandboxId);
    }

    if (options?.direction) {
      filtered = filtered.filter(l => l.direction === options.direction);
    }

    if (options?.allowed !== undefined) {
      filtered = filtered.filter(l => l.allowed === options.allowed);
    }

    if (options?.since) {
      filtered = filtered.filter(l => l.timestamp >= options.since!);
    }

    const limit = options?.limit || 100;
    return filtered.slice(-limit);
  }

  /**
   * Get blocked traffic statistics
   * 
   * @param durationMs - Duration in ms
   * @returns Blocked traffic stats
   */
  getBlockedStats(durationMs: number = 24 * 60 * 60 * 1000): {
    totalBlocked: number;
    byHost: Record<string, number>;
    byPort: Record<string, number>;
    bySandbox: Record<string, number>;
  } {
    const cutoff = Date.now() - durationMs;
    const blocked = this.trafficLogs.filter(l => !l.allowed && l.timestamp >= cutoff);

    const byHost: Record<string, number> = {};
    const byPort: Record<string, number> = {};
    const bySandbox: Record<string, number> = {};

    for (const log of blocked) {
      byHost[log.host] = (byHost[log.host] || 0) + 1;
      byPort[log.port.toString()] = (byPort[log.port.toString()] || 0) + 1;
      bySandbox[log.sandboxId] = (bySandbox[log.sandboxId] || 0) + 1;
    }

    return {
      totalBlocked: blocked.length,
      byHost,
      byPort,
      bySandbox,
    };
  }

  /**
   * Create restrictive policy
   * 
   * @param name - Policy name
   * @param allowedHosts - Allowed hosts
   * @returns Network policy
   */
  createRestrictivePolicy(
    name: string,
    allowedHosts: string[]
  ): NetworkPolicy {
    return {
      name,
      allowedHosts,
      allowedPorts: [80, 443], // Only HTTP/HTTPS
      allowAllOutbound: false,
      allowAllInbound: false,
      enableMonitoring: true,
    };
  }

  /**
   * Create permissive policy
   * 
   * @param name - Policy name
   * @returns Network policy
   */
  createPermissivePolicy(name: string): NetworkPolicy {
    return {
      name,
      allowAllOutbound: true,
      allowAllInbound: false,
      blockedPorts: [22, 23, 3389], // Block SSH, Telnet, RDP
      enableMonitoring: true,
    };
  }

  /**
   * Check host matches pattern
   */
  private hostMatches(host: string, pattern: string): boolean {
    // Exact match
    if (host === pattern) {
      return true;
    }

    // Wildcard match (*.example.com)
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix);
    }

    // CIDR match (192.168.1.0/24)
    if (pattern.includes('/')) {
      const [base, bits] = pattern.split('/');
      const mask = parseInt(bits, 10);
      return this.ipInCidr(host, base, mask);
    }

    return false;
  }

  /**
   * Check if IP is in CIDR range
   */
  private ipInCidr(ip: string, base: string, bits: number): boolean {
    const ipNum = this.ipToNumber(ip);
    const baseNum = this.ipToNumber(base);
    const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
    
    return (ipNum & mask) === (baseNum & mask);
  }

  /**
   * Convert IP to number
   */
  private ipToNumber(ip: string): number {
    return ip.split('.').reduce((acc, octet) => {
      return (acc << 8) + parseInt(octet, 10);
    }, 0) >>> 0;
  }

  /**
   * Clear traffic logs
   * 
   * @param sandboxId - Optional sandbox ID filter
   */
  clearLogs(sandboxId?: string): void {
    if (sandboxId) {
      this.trafficLogs = this.trafficLogs.filter(l => l.sandboxId !== sandboxId);
    } else {
      this.trafficLogs = [];
    }
  }
}

// Singleton instance
export const e2bNetworkIsolation = new E2BNetworkIsolation();

/**
 * Create network isolation manager
 * 
 * @returns Network isolation manager
 */
export function createNetworkIsolation(): E2BNetworkIsolation {
  return new E2BNetworkIsolation();
}

/**
 * Pre-configured network policies
 */
export const NetworkPresets = {
  /**
   * Allow only essential services
   */
  essential: () => e2bNetworkIsolation.createRestrictivePolicy('essential', [
    'api.github.com',
    'raw.githubusercontent.com',
    'registry.npmjs.org',
    'pypi.org',
    'files.pythonhosted.org',
  ]),

  /**
   * Allow cloud services
   */
  cloudServices: () => e2bNetworkIsolation.createRestrictivePolicy('cloud-services', [
    '*.amazonaws.com',
    '*.googleapis.com',
    '*.azure.com',
    '*.cloudflare.com',
  ]),

  /**
   * Allow AI/ML services
   */
  aiServices: () => e2bNetworkIsolation.createRestrictivePolicy('ai-services', [
    'api.openai.com',
    'api.anthropic.com',
    '*.googleapis.com',
    'api.huggingface.co',
  ]),

  /**
   * Development policy (permissive)
   */
  development: () => e2bNetworkIsolation.createPermissivePolicy('development'),
};
