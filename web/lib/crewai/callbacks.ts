/**
 * CrewAI Callbacks
 * 
 * Callback handlers for CrewAI events.
 */

export interface CallbackHandlers {
  onTaskStart?: (data: { task: any }) => void;
  onTaskComplete?: (data: { task: any; result: any }) => void;
  onTaskError?: (data: { task: any; error: any }) => void;
  onAgentStart?: (data: { agent: any }) => void;
  onAgentComplete?: (data: { agent: any; result: any }) => void;
  onCrewStart?: (data: { crew: any }) => void;
  onCrewComplete?: (data: { crew: any; result: any }) => void;
}

export class CallbackHandler {
  private handlers: CallbackHandlers;
  
  constructor(handlers: CallbackHandlers = {}) {
    this.handlers = handlers;
  }
  
  onTaskStart(data: { task: any }): void {
    this.handlers.onTaskStart?.(data);
  }
  
  onTaskComplete(data: { task: any; result: any }): void {
    this.handlers.onTaskComplete?.(data);
  }
  
  onTaskError(data: { task: any; error: any }): void {
    this.handlers.onTaskError?.(data);
  }
  
  onAgentStart(data: { agent: any }): void {
    this.handlers.onAgentStart?.(data);
  }
  
  onAgentComplete(data: { agent: any; result: any }): void {
    this.handlers.onAgentComplete?.(data);
  }
  
  onCrewStart(data: { crew: any }): void {
    this.handlers.onCrewStart?.(data);
  }
  
  onCrewComplete(data: { crew: any; result: any }): void {
    this.handlers.onCrewComplete?.(data);
  }
}

export function createCallbackHandler(handlers: CallbackHandlers): CallbackHandler {
  return new CallbackHandler(handlers);
}
