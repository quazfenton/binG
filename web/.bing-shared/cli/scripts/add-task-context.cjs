/**
 * Script to add task context injection to CLI chat loop
 */

const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'bin.ts');

if (!fs.existsSync(binPath)) {
  console.error('bin.ts not found');
  process.exit(1);
}

let content = fs.readFileSync(binPath, 'utf-8');

// Check if already added
if (content.includes('getTaskContextForChat')) {
  console.log('Task context already added');
  process.exit(0);
}

// 1. Add getTaskContextForChat function before chatLoop
const chatLoopIdx = content.indexOf('async function chatLoop(');
if (chatLoopIdx < 0) {
  console.error('Could not find chatLoop function');
  process.exit(1);
}

const taskContextFunc = `
// ============================================================================
// Task Context for CLI Chat - Re-context reminders
// ============================================================================

async function getTaskContextForChat(): Promise<string> {
  try {
    const result = await apiRequest('/memory/task/getUnfinished', {
      method: 'POST',
      data: { limit: 5 },
    }).catch(() => null);
    
    if (!result || !result.tasks?.length) return '';
    
    const tasks = result.tasks;
    const taskList = tasks.map((t) => {
      const progress = Math.round((t.progress || 0) * 100);
      const steps = t.steps || [];
      const completed = steps.filter((s) => s.status === 'completed').length;
      return '- ' + t.title + ' [' + t.status + '] ' + progress + '% (' + completed + '/' + steps.length + ')';
    }).join('\n');
    
    return '\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📋 PENDING TASKS (for re-context):\n' +
      taskList + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  } catch (err) {
    return '';
  }
}

`;

content = content.slice(0, chatLoopIdx) + taskContextFunc + content.slice(chatLoopIdx);

// 2. Add task context display at start of chatLoop (after the banner)
const bannerEnd = content.indexOf('const messages: any[] = [];', chatLoopIdx);
if (bannerEnd < 0) {
  console.error('Could not find messages array declaration');
  process.exit(1);
}

// Insert task context call right before messages array
const taskContextCall = `
  // Show pending tasks for re-context
  const taskContext = await getTaskContextForChat();
  if (taskContext) console.log(taskContext);

`;

const beforeMessages = content.lastIndexOf('\n', bannerEnd - 1) + 1;
content = content.slice(0, beforeMessages) + taskContextCall + content.slice(beforeMessages);

fs.writeFileSync(binPath, content);
console.log('✓ Added task context injection to CLI');