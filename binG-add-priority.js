const fs = require('fs');

try {
  // Update capabilities.ts - add priority validation
  let capabilitiesContent = fs.readFileSync('web/lib/tools/capabilities.ts', 'utf8');

  // Update TASK_CREATE_CAPABILITY priority field to add min/max validation
  capabilitiesContent = capabilitiesContent.replace(
    /priority: z\\.number\\(\\)\\.optional\\(\\),/g,
    'priority: z.number().min(0).max(100).optional(),'
  );

  // Update TASK_EDIT_CAPABILITY priority field to add min/max validation  
  capabilitiesContent = capabilitiesContent.replace(
    /priority: z\\.number\\(\\.optional\\(\\),/g,
    'priority: z.number().min(0).max(100).optional().describe(\\'Priority (0-100, higher = more important)\\'),'
  );

  // Write updated capabilities
  fs.writeFileSync('web/lib/tools/capabilities.ts', capabilitiesContent);
  console.log('Capabilities updated with priority validation');

  // Update router.ts - add markTasksForRecontext wiring in TaskProvider
  let routerContent = fs.readFileSync('web/lib/tools/router.ts', 'utf8');

  // Find the task.edit case and add markTasksForRecontext call after successful update
  const taskEditMatch = routerContent.match(/case 'task\\.edit':\\s*\\{[^}]+const task = await this\\.taskStore\\.update[^}]+task\\? \\{ id: task\\.id/);
  if (taskEditMatch) {
    // Find the right spot to insert markTasksForRecontext
    const insertPoint = 'task: task ? { id: task.id, title: task.title, steps: task.steps } : null,';
    const insertCode = `task: task ? { id: task.id, title: task.title, steps: task.steps } : null,
            };`
      .replace(insertCode, `task: task ? { id: task.id, title: task.title, steps: task.steps } : null,
            };
            
            // Mark task for re-context on completion or status change
            if (task && (updates.status === 'completed' || updates.status === 'failed')) {
              const { markTasksForRecontext } = await import('../memory/cache-exporter');
              markTasksForRecontext([input.taskId]);
            }`);
    
    routerContent = routerContent.replace(
      insertPoint,
      insertCode
    );
  }

  // Also add it to task.create after successful creation
  const taskCreateMatch = routerContent.match(/case 'task\\.create':\\s*\\{[^}]+return \\{[\\s\\S]*?\\}\\s*;\\s*\\}/);
  if (taskCreateMatch) {
    const insertAfter = 'return {';
    const insertCode = `return {
            success: true,
            output: {
              success: true,
              task: { id: task.id, title: task.title, status: task.status, steps: task.steps },
            },
          };`
      .replace(
        `return {
            success: true,
            output: {
              success: true,
              task: { id: task.id, title: task.title, status: task.status, steps: task.steps },
            },
          };`,
        `return {
            success: true,
            output: {
              success: true,
              task: { id: task.id, title: task.title, status: task.status, steps: task.steps },
            },
          };

          // Refresh re-context TTL for newly created tasks (they're pending work)
          if (task) {
            const { markTasksForRecontext } = await import('../memory/cache-exporter');
            markTasksForRecontext([task.id]);
          }`
      );
    
    routerContent = routerContent.replace(
      `return {
            success: true,
            output: {
              success: true,
              task: { id: task.id, title: task.title, status: task.status, steps: task.steps },
            },
          };`,
      `return {
            success: true,
            output: {
              success: true,
              task: { id: task.id, title: task.title, status: task.status, steps: task.steps },
            },
          };

          // Refresh re-context TTL for newly created tasks (they're pending work)
          if (task) {
            const { markTasksForRecontext } = await import('../memory/cache-exporter');
            markTasksForRecontext([task.id]);
          }`
    );
  }

  fs.writeFileSync('web/lib/tools/router.ts', routerContent);
  console.log('Router updated with markTasksForRecontext wiring');
  
} catch (err) {
  console.error('Failed to update files:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}