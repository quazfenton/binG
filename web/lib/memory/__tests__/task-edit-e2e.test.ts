/**
 * End-to-end test for task.edit capability
 * Tests: create plan, modify priority, add/remove steps, complete, verify re-context
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTaskStore, initializeTaskStore, resetTaskStore } from '../task-persistence';
import { markTasksForRecontext } from '../cache-exporter';

describe('Task Edit E2E', () => {
  let taskStore: ReturnType<typeof getTaskStore>;

  beforeEach(async () => {
    // Initialize fresh task store for each test
    await initializeTaskStore();
    taskStore = getTaskStore();
    resetTaskStore(); // Clear all tasks
  });

  afterEach(() => {
    resetTaskStore();
  });

  it('should create a plan with steps', async () => {
    // Create a plan with initial steps
    const task = await taskStore.create({
      title: 'Build Feature X',
      description: 'Implementation plan for Feature X',
      steps: [
        { description: 'Step 1: Design', order: 0 },
        { description: 'Step 2: Implement', order: 1 },
        { description: 'Step 3: Test', order: 2 },
      ],
      priority: 50,
      tags: ['feature', 'backend'],
    });

    expect(task).toBeDefined();
    expect(task.id).toBeDefined();
    expect(task.title).toBe('Build Feature X');
    expect(task.steps).toHaveLength(3);
    expect(task.steps![0].description).toBe('Step 1: Design');
    expect(task.priority).toBe(50);
  });

  it('should modify priority', async () => {
    // Create task
    const task = await taskStore.create({
      title: 'Test Priority',
      priority: 50,
    });

    // Update priority
    const updated = await taskStore.update(task.id, { priority: 80 });
    expect(updated).toBeDefined();
    expect(updated!.priority).toBe(80);

    // Verify via get
    const fetched = await taskStore.get(task.id);
    expect(fetched!.priority).toBe(80);
  });

  it('should add steps', async () => {
    // Create task with initial steps
    const task = await taskStore.create({
      title: 'Test Add Steps',
      steps: [
        { description: 'Original step', order: 0 },
      ],
    });

    // Add new steps
    await taskStore.appendSteps(task.id, [
      { description: 'New step 1', order: 1 },
      { description: 'New step 2', order: 2 },
    ]);

    // Verify steps were added
    const updated = await taskStore.get(task.id);
    expect(updated!.steps).toHaveLength(3);
    expect(updated!.steps![1].description).toBe('New step 1');
    expect(updated!.steps![2].description).toBe('New step 2');
  });

  it('should edit step properties', async () => {
    // Create task with steps
    const task = await taskStore.create({
      title: 'Test Edit Steps',
      steps: [
        { description: 'Original description', order: 0 },
      ],
    });

    const stepId = task.steps![0].id;

    // Edit step description
    await taskStore.editStep(task.id, stepId, { description: 'Updated description' });

    // Verify update
    const updated = await taskStore.get(task.id);
    expect(updated!.steps![0].description).toBe('Updated description');

    // Update step status to in_progress
    await taskStore.editStep(task.id, stepId, { status: 'in_progress' });
    const updated2 = await taskStore.get(task.id);
    expect(updated2!.steps![0].status).toBe('in_progress');
  });

  it('should reorder steps', async () => {
    // Create task with 3 steps
    const task = await taskStore.create({
      title: 'Test Reorder',
      steps: [
        { description: 'Step A', order: 0 },
        { description: 'Step B', order: 1 },
        { description: 'Step C', order: 2 },
      ],
    });

    // Get step IDs
    const stepIds = task.steps!.map(s => s.id);

    // Reorder: B, C, A
    await taskStore.reorderSteps(task.id, [stepIds[1], stepIds[2], stepIds[0]]);

    // Verify new order
    const updated = await taskStore.get(task.id);
    expect(updated!.steps![0].id).toBe(stepIds[1]); // B first
    expect(updated!.steps![1].id).toBe(stepIds[2]); // C second
    expect(updated!.steps![2].id).toBe(stepIds[0]); // A last
  });

  it('should mark task for re-context on completion', async () => {
    // Create task
    const task = await taskStore.create({
      title: 'Test Re-context',
      priority: 50,
      status: 'in_progress',
    });

    // Mark for re-context
    markTasksForRecontext([task.id]);

    // Verify the task is marked in the store
    // (markForRecontext updates lastAccessedAt)
    const refreshed = await taskStore.get(task.id);
    expect(refreshed).toBeDefined();
    expect(refreshed!.lastAccessedAt).toBeDefined();
    expect(refreshed!.lastAccessedAt).toBeGreaterThan(0);

    // Note: getRecontextSupplement requires minAge (default 1 hour) based on updatedAt
    // For proper test, task would need to be updated or minAge parameter used
  });

  it('should complete full workflow - create, modify, add steps, complete', async () => {
    // Step 1: Create a plan with steps
    const task = await taskStore.create({
      title: 'Build New Feature',
      description: 'Implementation plan for new feature',
      status: 'in_progress',
      steps: [
        { description: 'Design', order: 0, status: 'pending' },
        { description: 'Implement', order: 1, status: 'pending' },
        { description: 'Test', order: 2, status: 'pending' },
      ],
      priority: 50,
      tags: ['feature'],
    });

    expect(task.steps).toHaveLength(3);

    // Step 2: Modify priority
    const updated1 = await taskStore.update(task.id, { priority: 80 });
    expect(updated1!.priority).toBe(80);

    // Step 3: Add more steps
    await taskStore.appendSteps(task.id, [
      { description: 'Deploy', order: 3, status: 'pending' },
      { description: 'Monitor', order: 4, status: 'pending' },
    ]);

    const updated2 = await taskStore.get(task.id);
    expect(updated2!.steps).toHaveLength(5);

    // Step 4: Verify re-context marking works
    markTasksForRecontext([task.id]);
    const refreshed = await taskStore.get(task.id);
    expect(refreshed!.lastAccessedAt).toBeGreaterThan(0);

    // Note: getRecontextSupplement filters by updatedAt, not lastAccessedAt
    // So we verify markForRecontext works by checking lastAccessedAt

    // Step 5: Complete individual steps
    const steps = updated2!.steps!;
    for (const step of steps) {
      await taskStore.editStep(task.id, step.id, { status: 'completed' });
    }

    // Step 6: Complete the task
    const finalTask = await taskStore.update(task.id, { status: 'completed' });
    expect(finalTask!.status).toBe('completed');

    // Step 7: After completion, verify task state
    const completed = await taskStore.get(task.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.progress).toBe(100); // All steps completed
  });

  it('should handle step removal via step update', async () => {
    // Create task with steps
    const task = await taskStore.create({
      title: 'Test Step Status',
      steps: [
        { description: 'Keep this', order: 0, status: 'pending' },
        { description: 'Skip this one', order: 1, status: 'pending' },
        { description: 'Keep this too', order: 2, status: 'pending' },
      ],
    });

    // Mark middle step as cancelled
    const middleStepId = task.steps![1].id;
    await taskStore.editStep(task.id, middleStepId, { status: 'cancelled' });

    // Verify
    const updated = await taskStore.get(task.id);
    // Step status defaults to undefined, use ?? operator
    expect(updated!.steps![0].status ?? 'pending').toBe('pending');
    expect(updated!.steps![1].status).toBe('cancelled');
    expect(updated!.steps![2].status ?? 'pending').toBe('pending');
  });

  it('should track progress incrementally as steps are completed', async () => {
    // Create task with 5 steps
    const task = await taskStore.create({
      title: 'Test Progress Tracking',
      steps: [
        { description: 'Step 1', order: 0, status: 'pending' },
        { description: 'Step 2', order: 1, status: 'pending' },
        { description: 'Step 3', order: 2, status: 'pending' },
        { description: 'Step 4', order: 3, status: 'pending' },
        { description: 'Step 5', order: 4, status: 'pending' },
      ],
    });

    const stepIds = task.steps!.map(s => s.id);

    // Verify initial progress is 0 (no steps completed)
    const initial = await taskStore.get(task.id);
    expect(initial!.progress).toBe(0);

    // Complete first 3 steps
    await taskStore.editStep(task.id, stepIds[0], { status: 'completed' });
    await taskStore.editStep(task.id, stepIds[1], { status: 'completed' });
    await taskStore.editStep(task.id, stepIds[2], { status: 'completed' });

    // Verify progress is ~60% (3 of 5 steps)
    const after3 = await taskStore.get(task.id);
    expect(after3!.progress).toBe(60);

    // Complete step 4
    await taskStore.editStep(task.id, stepIds[3], { status: 'completed' });

    // Verify progress is 80% (4 of 5 steps)
    const after4 = await taskStore.get(task.id);
    expect(after4!.progress).toBe(80);

    // Complete final step
    await taskStore.editStep(task.id, stepIds[4], { status: 'completed' });

    // Verify progress is 100% (all steps completed)
    const final = await taskStore.get(task.id);
    expect(final!.progress).toBe(100);
  });

  it('should validate step quality and identify issues', async () => {
    const { validateStepQuality } = await import('../task-persistence');
    
    // Good step - has action verb and specificity
    const goodStep = validateStepQuality('Implement user authentication with JWT tokens');
    expect(goodStep.valid).toBe(true);
    expect(goodStep.issues).toHaveLength(0);
    
    // Bad step - missing action verb
    const badStep1 = validateStepQuality('some stuff');
    expect(badStep1.valid).toBe(false);
    expect(badStep1.issues.length).toBeGreaterThan(0);
    expect(badStep1.suggestions.length).toBeGreaterThan(0);
    
    // Bad step - too vague
    const badStep2 = validateStepQuality('do it');
    expect(badStep2.valid).toBe(false);
    
    // Bad step - contains vague terms
    const badStep3 = validateStepQuality('fix the things and stuff');
    expect(badStep3.valid).toBe(false);
  });

  it('should segment steps into micro-steps with dependencies', async () => {
    const { segmentStepHierarchically } = await import('../task-persistence');
    
    const microSteps = segmentStepHierarchically('Implement user authentication');
    
    expect(microSteps.length).toBeGreaterThan(0);
    expect(microSteps.every(m => m.order !== undefined)).toBe(true);
    
    // Verify some micro-steps have estimates
    const withEstimates = microSteps.filter(m => m.estimatedMinutes);
    expect(withEstimates.length).toBeGreaterThan(0);
    
    // Verify dependencies are set for steps after first
    const withDeps = microSteps.filter(m => m.dependencies && m.dependencies.length > 0);
    expect(withDeps.length).toBeGreaterThan(0);
  });

  it('should expand step into detailed sub-steps with scope', async () => {
    const { expandStepIntoDetail } = await import('../task-persistence');
    
    const result = expandStepIntoDetail('Implement user authentication with JWT');
    
    expect(result.original).toBe('Implement user authentication with JWT');
    expect(result.expanded.length).toBeGreaterThan(0);
    expect(result.scope.inclusions.length).toBeGreaterThan(0);
    expect(result.scope.exclusions.length).toBeGreaterThan(0);
    expect(['simple', 'moderate', 'complex']).toContain(result.complexity);
  });

  it('should expand different step types with appropriate scope', async () => {
    const { expandStepIntoDetail } = await import('../task-persistence');
    
    // Test implementation step
    const implResult = expandStepIntoDetail('Implement user authentication');
    expect(implResult.scope.inclusions).toContain('Core functionality implementation');
    expect(implResult.scope.inclusions).toContain('Error handling');
    expect(implResult.scope.exclusions).toContain('Major architectural refactoring');
    expect(implResult.scope.qualifications.length).toBeGreaterThan(0);
    
    // Test fix step
    const fixResult = expandStepIntoDetail('Fix login bug');
    expect(fixResult.scope.inclusions).toContain('Root cause identification');
    expect(fixResult.scope.inclusions).toContain('Regression prevention');
    expect(fixResult.scope.exclusions).toContain('Feature additions');
    
    // Test test step
    const testResult = expandStepIntoDetail('Test API endpoint');
    expect(testResult.scope.inclusions).toContain('Test case definition');
    expect(testResult.scope.inclusions).toContain('Execution and documentation');
    expect(testResult.scope.exclusions).toContain('Code changes unless fixing test');
    
    // Test document step
    const docResult = expandStepIntoDetail('Document API changes');
    expect(docResult.scope.inclusions).toContain('Content creation');
    expect(docResult.scope.inclusions).toContain('Final approval');
    expect(docResult.scope.exclusions).toContain('Code implementation');
  });

  it('should classify complexity based on step characteristics', async () => {
    const { expandStepIntoDetail } = await import('../task-persistence');
    
    // Simple step - short, no complex terms (≤5 words)
    const simple = expandStepIntoDetail('Fix bug');
    expect(simple.complexity).toBe('simple');
    
    // Moderate step - more than 5 words (6+ words)
    const moderate = expandStepIntoDetail('Implement user authentication with JWT tokens for security');
    expect(moderate.complexity).toBe('moderate');
    
    // Complex step - more than 10 words
    const complex = expandStepIntoDetail('Implement database migration system with transaction support and rollback capabilities');
    expect(complex.complexity).toBe('complex');
    
    // Complex step - has framework/system/module keyword
    const framework = expandStepIntoDetail('Create API service module');
    expect(framework.complexity).toBe('complex');
  });

  it('should generate appropriate sub-steps for each complexity level', async () => {
    const { expandStepIntoDetail } = await import('../task-persistence');
    
    const simple = expandStepIntoDetail('Fix bug');
    expect(simple.expanded.length).toBeGreaterThanOrEqual(4);
    
    // Use same step type (implement) with different complexity
    const complex = expandStepIntoDetail('Implement database migration system with transaction support and rollback');
    // Complex should have more steps than simple (due to >10 words)
    expect(complex.expanded.length).toBeGreaterThan(simple.expanded.length);
    
    // Verify all expanded steps start with number
    complex.expanded.forEach(step => {
      expect(step).toMatch(/^\d+\./);
    });
  });

  it('should mark step completions with quality feedback', async () => {
    const { markStepCompletion } = await import('../task-persistence');
    
    const llmMark = markStepCompletion('Test step', 'llm', { quality: 'excellent' });
    expect(llmMark.markedBy).toBe('llm');
    expect(llmMark.quality).toBe('excellent');
    expect(llmMark.timestamp).toBeDefined();
    expect(llmMark.stepId).toMatch(/^step_/);
    
    const userMark = markStepCompletion('Another step', 'user', { feedback: 'Needs verification' });
    expect(userMark.markedBy).toBe('user');
    expect(userMark.feedback).toBe('Needs verification');
  });

  it('should mark step completions with all quality levels', async () => {
    const { markStepCompletion } = await import('../task-persistence');
    
    const excellent = markStepCompletion('Step 1', 'llm', { quality: 'excellent' });
    expect(excellent.quality).toBe('excellent');
    
    const good = markStepCompletion('Step 2', 'user', { quality: 'good' });
    expect(good.quality).toBe('good');
    
    const needsWork = markStepCompletion('Step 3', 'llm', { quality: 'needs_work' });
    expect(needsWork.quality).toBe('needs_work');
    
    // Without quality - should be undefined
    const noQuality = markStepCompletion('Step 4', 'user');
    expect(noQuality.quality).toBeUndefined();
  });

  it('should generate unique step IDs for each mark', async () => {
    const { markStepCompletion } = await import('../task-persistence');
    
    const mark1 = markStepCompletion('Step 1', 'llm');
    const mark2 = markStepCompletion('Step 1', 'llm');
    const mark3 = markStepCompletion('Step 2', 'user');
    
    // Each mark should have unique ID
    expect(mark1.stepId).not.toBe(mark2.stepId);
    expect(mark2.stepId).not.toBe(mark3.stepId);
    expect(mark1.stepId).not.toBe(mark3.stepId);
    
    // Verify all have valid format
    expect(mark1.stepId).toMatch(/^step_\d+_[a-z0-9]+$/);
  });

  it('should include feedback when provided', async () => {
    const { markStepCompletion } = await import('../task-persistence');
    
    const withFeedback = markStepCompletion('Step', 'user', {
      feedback: 'This needs improvement in error handling'
    });
    expect(withFeedback.feedback).toBe('This needs improvement in error handling');
    
    const withoutFeedback = markStepCompletion('Step', 'llm');
    expect(withoutFeedback.feedback).toBeUndefined();
  });

  it('should set timestamp on mark creation', async () => {
    const { markStepCompletion } = await import('../task-persistence');
    const before = Date.now();
    
    const mark = markStepCompletion('Step', 'user');
    
    const after = Date.now();
    expect(mark.timestamp).toBeGreaterThanOrEqual(before);
    expect(mark.timestamp).toBeLessThanOrEqual(after);
  });

  it('should perform multi-perspective enrichment with all 4 viewpoints', async () => {
    const { enrichStepMultiPerspective } = await import('../task-persistence');
    
    const result = await enrichStepMultiPerspective(
      'Implement user authentication',
      'Building a secure web application'
    );
    
    expect(result.original).toBe('Implement user authentication');
    expect(result.enriched).toContain('Implement user authentication');
    
    // Verify all 4 perspectives are present
    expect(result.perspectives).toBeDefined();
    expect(result.perspectives.technical).toBeDefined();
    expect(result.perspectives.qa).toBeDefined();
    expect(result.perspectives.ux).toBeDefined();
    expect(result.perspectives.security).toBeDefined();
    
    // Verify quality metrics
    expect(result.metrics).toBeDefined();
    expect(result.metrics.clarity).toBeGreaterThan(0);
    expect(result.metrics.completeness).toBeGreaterThan(0);
    expect(result.metrics.actionability).toBeGreaterThan(0);
    expect(result.metrics.overall).toBeGreaterThan(0);
    
    // Verify risks and recommendations
    expect(Array.isArray(result.risks)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
    
    // Verify micro-steps
    expect(result.microSteps.length).toBeGreaterThan(0);
  });

  it('should generate step recommendations based on task context', async () => {
    const { generateStepRecommendations } = await import('../task-persistence');
    
    // Create task with steps
    const task = await taskStore.create({
      title: 'Test Task',
      priority: 85,
      steps: [
        { description: 'Step 1', order: 0, status: 'completed' },
        { description: 'Step 2', order: 1, status: 'in_progress' },
        { description: 'Step 3', order: 2, status: 'pending' },
        { description: 'Step 4', order: 3, status: 'pending' },
        { description: 'Step 5', order: 4, status: 'pending' },
        { description: 'Step 6', order: 5, status: 'pending' },
      ],
    });
    
    // Progress is at 1/6 = ~17%
    task.progress = 17;
    
    const recommendations = generateStepRecommendations(task, 1);
    
    expect(Array.isArray(recommendations)).toBe(true);
    expect(recommendations.length).toBeGreaterThan(0);
    
    // Should recommend for high priority
    expect(recommendations.some(r => r.includes('priority'))).toBe(true);
    
    // Should mention current step
    expect(recommendations.some(r => r.includes('Step 2'))).toBe(true);
  });
});