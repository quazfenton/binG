/**
 * Messaging Service Abstraction
 * 
 * Provides a unified interface for messaging.
 * In a real Matrix implementation, this would use the matrix-js-sdk.
 * For now, this abstracts the delivery to your chosen platform (Matrix/Email/Internal).
 */

export interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
}

export class MessagingService {
  /**
   * Generates a shortened username from an email address
   * e.g., user@example.com -> user_example
   */
  static generateShortUsername(email: string): string {
    const [name, domain] = email.split('@');
    const domainPrefix = domain.split('.')[0];
    return `${name}_${domainPrefix}`.toLowerCase();
  }

  /**
   * Connect to Matrix/Platform
   * Abstracts the identity bridging
   */
  static async connect(email: string) {
    const username = this.generateShortUsername(email);
    console.log(`[Messaging] Connecting identity for ${username}...`);
    // Implementation for Matrix or internal relay would go here
    return { username, status: 'connected' };
  }
}
