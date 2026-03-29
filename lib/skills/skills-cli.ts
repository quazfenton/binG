/**
 * Skills CLI Commands
 *
 * Commands:
 * - npx skills add <name> - Add new skill
 * - npx skills list - List all skills
 * - npx skills show <name> - Show skill details
 * - npx skills weight <name> - Update skill weights
 * - npx skills export <name> - Export skill data
 * - npx skills import <file> - Import skill data
 * - npx skills test <name> - Test skill execution
 * - npx skills analytics <name> - Show skill analytics
 */

import { Command } from 'commander';
import { skillsManager } from './skills-manager';
import { promptEngineeringService } from './prompt-engineering';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Skills:CLI');

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command();

program
  .name('skills')
  .description('Skills management CLI for binG')
  .version('1.0.0');

// ============================================================================
// Add Command
// ============================================================================

program
  .command('add <name>')
  .description('Add a new skill')
  .requiredOption('-d, --description <description>', 'Skill description')
  .requiredOption('-p, --system-prompt <prompt>', 'System prompt content')
  .option('-t, --tags <tags>', 'Comma-separated tags', '')
  .option('-w, --workflows <workflows>', 'Comma-separated workflow names', '')
  .option('-o, --output <dir>', 'Output directory', '.agents/skills')
  .action(async (name, options) => {
    try {
      console.log(`\n📝 Adding new skill: ${name}\n`);

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
      const workflows = options.workflows ? options.workflows.split(',').map((w: string) => w.trim()) : [];

      const workflowObjects = workflows.map(name => ({
        name,
        description: `Workflow for ${name}`,
        trigger: `User wants to ${name}`,
        steps: [],
      }));

      const success = await skillsManager.addSkill({
        name,
        description: options.description,
        systemPrompt: options.systemPrompt,
        tags,
        workflows: workflowObjects,
      });

      if (success) {
        console.log(`\n✅ Skill "${name}" added successfully!`);
        console.log(`\nNext steps:`);
        console.log(`1. Edit the skill file: ${join(options.output, name, 'SKILL.md')}`);
        console.log(`2. Add workflow files in: ${join(options.output, name, 'workflows/')}`);
        console.log(`3. Test the skill: npx skills test ${name}\n`);
      } else {
        console.log(`\n❌ Failed to add skill "${name}"\n`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// List Command
// ============================================================================

program
  .command('list')
  .description('List all skills')
  .option('-o, --output <dir>', 'Skills directory', '.agents/skills')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      await skillsManager.loadAllSkills();
      const skills = skillsManager.getAllSkills();

      if (options.json) {
        console.log(JSON.stringify(skills.map(s => s.metadata), null, 2));
        return;
      }

      console.log(`\n📚 Available Skills (${skills.length})\n`);
      console.log('─'.repeat(80));

      for (const skill of skills) {
        const { name, description, tags, version } = skill.metadata;
        const { avgSuccessRate, trend, totalExecutions } = skill.reinforcement;

        console.log(`\n📦 ${name} v${version}`);
        console.log(`   ${description}`);
        console.log(`   Tags: ${tags.join(', ') || 'none'}`);
        console.log(`   Executions: ${totalExecutions}`);
        console.log(`   Success Rate: ${(avgSuccessRate * 100).toFixed(1)}%`);
        console.log(`   Trend: ${trend.toUpperCase()}`);
        console.log(`   Workflows: ${skill.workflows.length}`);
      }

      console.log('\n' + '─'.repeat(80));
      console.log(`\n💡 Use "npx skills show <name>" for detailed information\n`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Show Command
// ============================================================================

program
  .command('show <name>')
  .description('Show skill details')
  .option('-o, --output <dir>', 'Skills directory', '.agents/skills')
  .action(async (name) => {
    try {
      await skillsManager.loadAllSkills();
      const skill = skillsManager.getAllSkills().find(s => s.metadata.name === name);

      if (!skill) {
        console.log(`\n❌ Skill "${name}" not found\n`);
        process.exit(1);
      }

      console.log(`\n📦 Skill: ${skill.metadata.name}\n`);
      console.log('─'.repeat(80));

      console.log(`\n📝 Metadata:`);
      console.log(`   Name: ${skill.metadata.name}`);
      console.log(`   Description: ${skill.metadata.description}`);
      console.log(`   Version: ${skill.metadata.version}`);
      console.log(`   Tags: ${skill.metadata.tags.join(', ') || 'none'}`);
      console.log(`   Created: ${new Date(skill.metadata.createdAt).toLocaleDateString()}`);
      console.log(`   Updated: ${new Date(skill.metadata.updatedAt).toLocaleDateString()}`);

      console.log(`\n🎯 System Prompt:`);
      console.log(`   ${skill.systemPrompt.split('\n').slice(0, 5).join('\n   ')}...`);

      console.log(`\n🔄 Workflows (${skill.workflows.length}):`);
      for (const workflow of skill.workflows) {
        console.log(`   • ${workflow.name}`);
        console.log(`     Trigger: ${workflow.trigger}`);
        console.log(`     Steps: ${workflow.steps.length}`);
      }

      console.log(`\n📊 Reinforcement Data:`);
      console.log(`   Total Executions: ${skill.reinforcement.totalExecutions}`);
      console.log(`   Successful: ${skill.reinforcement.successfulExecutions}`);
      console.log(`   Failed: ${skill.reinforcement.failedExecutions}`);
      console.log(`   Success Rate: ${(skill.reinforcement.avgSuccessRate * 100).toFixed(1)}%`);
      console.log(`   Trend: ${skill.reinforcement.weights.trend.toUpperCase()}`);

      console.log(`\n⚖️ Weights:`);
      console.log(`   Overall: ${skill.reinforcement.weights.overall.toFixed(2)}`);
      console.log(`   By Agent Type:`);
      for (const [agentType, weight] of Object.entries(skill.reinforcement.weights.byAgentType)) {
        console.log(`     ${agentType}: ${weight.toFixed(2)}`);
      }
      console.log(`   By Workflow:`);
      for (const [workflow, weight] of Object.entries(skill.reinforcement.weights.byWorkflow)) {
        console.log(`     ${workflow}: ${weight.toFixed(2)}`);
      }

      console.log(`\n💡 Recent Feedback (${skill.reinforcement.recentFeedback.length}):`);
      const recent = skill.reinforcement.recentFeedback.slice(-5);
      for (const feedback of recent) {
        const icon = feedback.success ? '✅' : '❌';
        console.log(`   ${icon} ${feedback.agentType}/${feedback.workflowName || 'general'} - ${feedback.notes || 'No notes'}`);
      }

      console.log('\n' + '─'.repeat(80));
      console.log(`\n💡 Use "npx skills test ${name}" to test this skill\n`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Weight Command
// ============================================================================

program
  .command('weight <name>')
  .description('Update skill weights')
  .option('--agent-type <type>', 'Agent type (cli, cloud, nullclaw, terminaluse)')
  .option('--workflow <name>', 'Workflow name')
  .requiredOption('-v, --value <value>', 'New weight value', parseFloat)
  .option('-o, --output <dir>', 'Skills directory', '.agents/skills')
  .action(async (name, options) => {
    try {
      await skillsManager.loadAllSkills();
      const skill = skillsManager.getAllSkills().find(s => s.metadata.name === name);

      if (!skill) {
        console.log(`\n❌ Skill "${name}" not found\n`);
        process.exit(1);
      }

      if (options.agentType) {
        skill.reinforcement.weights.byAgentType[options.agentType] = options.value;
        console.log(`\n✅ Updated weight for ${options.agentType}: ${options.value.toFixed(2)}\n`);
      } else if (options.workflow) {
        skill.reinforcement.weights.byWorkflow[options.workflow] = options.value;
        console.log(`\n✅ Updated weight for ${options.workflow}: ${options.value.toFixed(2)}\n`);
      } else {
        skill.reinforcement.weights.overall = options.value;
        console.log(`\n✅ Updated overall weight: ${options.value.toFixed(2)}\n`);
      }

      skill.reinforcement.lastUpdated = Date.now();

      const skillPath = join(options.output, name);
      const reinforcementPath = join(skillPath, 'reinforcement.json');
      await writeFile(reinforcementPath, JSON.stringify(skill.reinforcement, null, 2));

      console.log(`💾 Saved to ${reinforcementPath}\n`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Export Command
// ============================================================================

program
  .command('export <name>')
  .description('Export skill data')
  .requiredOption('-o, --output <file>', 'Output file')
  .option('--include-reinforcement', 'Include reinforcement data', true)
  .option('--include-workflows', 'Include workflows', true)
  .option('-s, --skills-dir <dir>', 'Skills directory', '.agents/skills')
  .action(async (name, options) => {
    try {
      await skillsManager.loadAllSkills();
      const skill = skillsManager.getAllSkills().find(s => s.metadata.name === name);

      if (!skill) {
        console.log(`\n❌ Skill "${name}" not found\n`);
        process.exit(1);
      }

      const exportData: any = {
        metadata: skill.metadata,
        systemPrompt: skill.systemPrompt,
        subCapabilities: skill.subCapabilities,
      };

      if (options.includeWorkflows) {
        exportData.workflows = skill.workflows;
      }

      if (options.includeReinforcement) {
        exportData.reinforcement = skill.reinforcement;
      }

      await writeFile(options.output, JSON.stringify(exportData, null, 2));

      console.log(`\n✅ Exported skill "${name}" to ${options.output}\n`);
      console.log(`   Included:`);
      console.log(`   • Metadata`);
      console.log(`   • System Prompt`);
      console.log(`   • Sub-Capabilities`);
      if (options.includeWorkflows) console.log(`   • Workflows (${skill.workflows.length})`);
      if (options.includeReinforcement) console.log(`   • Reinforcement Data`);
      console.log('');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Import Command
// ============================================================================

program
  .command('import <file>')
  .description('Import skill data')
  .option('-o, --output <dir>', 'Skills directory', '.agents/skills')
  .action(async (file, options) => {
    try {
      const importData = JSON.parse(await readFile(file, 'utf-8'));

      const success = await skillsManager.addSkill({
        name: importData.metadata.name,
        description: importData.metadata.description,
        systemPrompt: importData.systemPrompt,
        tags: importData.metadata.tags,
        workflows: importData.workflows,
      });

      if (success && importData.reinforcement) {
        const skillPath = join(options.output, importData.metadata.name);
        const reinforcementPath = join(skillPath, 'reinforcement.json');
        await writeFile(reinforcementPath, JSON.stringify(importData.reinforcement, null, 2));
      }

      if (success) {
        console.log(`\n✅ Imported skill "${importData.metadata.name}"\n`);
      } else {
        console.log(`\n❌ Failed to import skill\n`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Test Command
// ============================================================================

program
  .command('test <name>')
  .description('Test skill execution')
  .option('--agent-type <type>', 'Agent type', 'cli')
  .option('--workflow <name>', 'Workflow name')
  .option('-o, --output <dir>', 'Skills directory', '.agents/skills')
  .action(async (name, options) => {
    try {
      await skillsManager.loadAllSkills();
      const skill = skillsManager.getAllSkills().find(s => s.metadata.name === name);

      if (!skill) {
        console.log(`\n❌ Skill "${name}" not found\n`);
        process.exit(1);
      }

      console.log(`\n🧪 Testing skill: ${name}\n`);
      console.log('─'.repeat(80));

      const workflowName = options.workflow || skill.workflows[0]?.name || 'general';

      console.log(`Agent Type: ${options.agentType}`);
      console.log(`Workflow: ${workflowName}`);
      console.log(`\nSimulating execution...\n`);

      const startTime = Date.now();

      await new Promise(resolve => setTimeout(resolve, 1000));

      const executionTime = Date.now() - startTime;
      const success = Math.random() > 0.3;

      await skillsManager.recordExecution(
        name,
        options.agentType,
        workflowName,
        success,
        executionTime,
        'Test execution'
      );

      console.log(`\n${success ? '✅' : '❌'} Execution ${success ? 'successful' : 'failed'}`);
      console.log(`   Execution Time: ${executionTime}ms`);
      console.log(`\n💾 Results saved to reinforcement data\n`);

      const updatedSkill = await skillsManager.loadSkill(name);
      if (updatedSkill) {
        console.log(`Updated Statistics:`);
        console.log(`   Total Executions: ${updatedSkill.reinforcement.totalExecutions}`);
        console.log(`   Success Rate: ${(updatedSkill.reinforcement.avgSuccessRate * 100).toFixed(1)}%`);
        console.log(`   Trend: ${updatedSkill.reinforcement.weights.trend.toUpperCase()}\n`);
      }
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Analytics Command
// ============================================================================

program
  .command('analytics <name>')
  .description('Show skill analytics')
  .option('-o, --output <dir>', 'Skills directory', '.agents/skills')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    try {
      await skillsManager.loadAllSkills();
      const skill = skillsManager.getAllSkills().find(s => s.metadata.name === name);

      if (!skill) {
        console.log(`\n❌ Skill "${name}" not found\n`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({
          metadata: skill.metadata,
          reinforcement: skill.reinforcement,
          workflows: skill.workflows.map(w => ({
            name: w.name,
            weight: skill.reinforcement.weights.byWorkflow[w.name] || 1.0,
          })),
        }, null, 2));
        return;
      }

      console.log(`\n📊 Analytics for: ${name}\n`);
      console.log('─'.repeat(80));

      console.log(`\n📈 Performance:`);
      console.log(`   Total Executions: ${skill.reinforcement.totalExecutions}`);
      console.log(`   Success Rate: ${(skill.reinforcement.avgSuccessRate * 100).toFixed(1)}%`);
      console.log(`   Trend: ${skill.reinforcement.weights.trend.toUpperCase()}`);

      console.log(`\n⚖️ Weight Analysis:`);
      console.log(`   Overall: ${skill.reinforcement.weights.overall.toFixed(2)}`);

      const trendIcon = skill.reinforcement.weights.trend === 'improving' ? '📈' :
                        skill.reinforcement.weights.trend === 'declining' ? '📉' : '➡️';
      console.log(`   ${trendIcon} Trend: ${skill.reinforcement.weights.trend}`);

      console.log(`\n🤖 By Agent Type:`);
      const sortedByAgentType = Object.entries(skill.reinforcement.weights.byAgentType)
        .sort(([, a], [, b]) => b - a);

      for (const [agentType, weight] of sortedByAgentType) {
        const bar = '█'.repeat(Math.floor(weight * 10));
        console.log(`   ${agentType.padEnd(12)} ${weight.toFixed(2)} ${bar}`);
      }

      console.log(`\n🔄 By Workflow:`);
      const sortedByWorkflow = Object.entries(skill.reinforcement.weights.byWorkflow)
        .sort(([, a], [, b]) => b - a);

      for (const [workflow, weight] of sortedByWorkflow) {
        const bar = '█'.repeat(Math.floor(weight * 10));
        console.log(`   ${workflow.padEnd(12)} ${weight.toFixed(2)} ${bar}`);
      }

      console.log(`\n💬 Recent Feedback:`);
      const recent = skill.reinforcement.recentFeedback.slice(-10);
      for (const feedback of recent) {
        const icon = feedback.success ? '✅' : '❌';
        const time = new Date(feedback.timestamp).toLocaleDateString();
        console.log(`   ${icon} ${time} - ${feedback.agentType}/${feedback.workflowName || 'general'}`);
        if (feedback.notes) console.log(`      "${feedback.notes}"`);
        if (feedback.correction) console.log(`      Correction: ${feedback.correction}`);
      }

      console.log('\n' + '─'.repeat(80));
      console.log(`\n💡 Use "npx skills weight ${name}" to adjust weights\n`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

// ============================================================================
// Export
// ============================================================================

export { program };
