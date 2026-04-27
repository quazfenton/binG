/**
 * RTK CLI Commands
 * 
 * RTK-powered local command execution for CLI.
 * Provides token-optimized command execution for LLM consumption.
 * 
 * Features:
 * - Local command execution without server
 * - RTK command rewriting for token optimization
 * - RTK output filtering for LLM consumption (not terminal display)
 * - Token savings tracking
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { LocalBashExecutor, rewriteCommand, canRewrite, filterOutput, estimateTokens, type RTKStats } from './bash-executor-local';

// Create RTK-enabled bash executor for CLI
export const rtkExecutor = new LocalBashExecutor({
  workspaceRoot: process.env.WORKSPACE_ROOT || process.cwd(),
});

/**
 * Register RTK commands with the CLI program
 */
export function registerRTKCommands(program: Command): void {
  // RTK Settings command
  program
    .command('rtk:status')
    .description('Show RTK token reduction status and statistics')
    .action(async () => {
      console.log(chalk.cyanBright('\n=== RTK Status ===\n'));
      console.log(`Workspace: ${rtkExecutor.getWorkspaceRoot() || process.cwd()}`);
      console.log(`RTK Enabled: ${chalk.green('Yes')}`);
      console.log(`RTK Version: 1.0.0`);
      console.log('');
    });

  // RTK Execute command - execute with RTK token reduction
  program
    .command('rtk:exec <command...>')
    .description('Execute a command with RTK token reduction for LLM consumption')
    .option('--no-rewrite', 'Disable RTK command rewriting')
    .option('--no-filter', 'Disable RTK output filtering')
    .option('--no-group', 'Disable grouping grep output by file')
    .option('--max-lines <n>', 'Maximum lines in output', parseInt, 100)
    .option('--max-chars <n>', 'Maximum characters in output', parseInt, 50000)
    .option('--track-savings', 'Track token savings')
    .option('--raw', 'Output raw (no RTK filtering) - for terminal display')
    .action(async (commandParts, options) => {
      const command = commandParts.join(' ');
      
      if (options.raw) {
        // Raw execution for terminal display - no RTK
        const spinner = ora(`Executing: ${command}`).start();
        
        const result = await rtkExecutor.executeRaw(command, {
          cwd: rtkExecutor.getWorkspaceRoot(),
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(result.output);
          console.log(chalk.gray(`\nExit code: ${result.exitCode}`));
        } else {
          console.log(chalk.red(`Error: ${result.error}`));
          console.log(chalk.gray(`Exit code: ${result.exitCode}`));
        }
        return;
      }
      
      // RTK execution for LLM consumption
      const spinner = ora(`RTK executing: ${command}`).start();
      
      const result = await rtkExecutor.execute(command, {
        cwd: rtkExecutor.getWorkspaceRoot(),
        rtkOptions: {
          rewriteCommand: options.rewrite !== false,
          filterForLLM: options.filter !== false,
          groupGrepOutput: options.group !== false,
          maxLines: options.maxLines,
          maxChars: options.maxChars,
          trackSavings: options.trackSavings,
        },
      });
      
      spinner.stop();
      
      // Show RTK metadata
      if (result.rtkStats) {
        console.log(chalk.cyan('\n[RTK] Token Savings:'));
        console.log(`  Original: ${result.rtkStats.originalTokens} tokens`);
        console.log(`  Filtered: ${result.rtkStats.filteredTokens} tokens`);
        console.log(`  Saved: ${result.rtkStats.savedTokens} tokens (${result.rtkStats.savingsPercent}%)`);
      }
      
      // Show output
      console.log('\n' + result.output);
      
      if (!result.success && result.error) {
        console.log(chalk.yellow(`\nErrors: ${result.error}`));
      }
      
      console.log(chalk.gray(`\nExit code: ${result.exitCode}`));
      if (result.duration) {
        console.log(chalk.gray(`Duration: ${result.duration}ms`));
      }
    });

  // RTK Rewrite command - show what a command would be rewritten to
  program
    .command('rtk:rewrite <command...>')
    .description('Show RTK rewrite for a command without executing')
    .action(async (commandParts) => {
      const command = commandParts.join(' ');
      
      if (canRewrite(command)) {
        const rewritten = rewriteCommand(command);
        console.log(chalk.cyanBright('\n=== RTK Command Rewrite ===\n'));
        console.log(`Original: ${command}`);
        console.log(`Rewritten: ${chalk.green(rewritten)}`);
        
        if (rewritten !== command) {
          console.log(chalk.gray('\nThe rewritten command will produce token-optimized output.'));
        }
      } else {
        console.log(chalk.yellow(`\nNo RTK rewrite available for: ${command}`));
        console.log(chalk.gray('This command is already token-efficient.'));
      }
    });

  // RTK Workspace command
  program
    .command('rtk:workspace [path]')
    .description('Set or show workspace root for RTK path validation')
    .action(async (path) => {
      if (path) {
        rtkExecutor.setWorkspaceRoot(path);
        console.log(chalk.green(`\nWorkspace set to: ${path}`));
      } else {
        console.log(chalk.cyanBright('\n=== RTK Workspace ===\n'));
        console.log(`Workspace: ${rtkExecutor.getWorkspaceRoot() || process.cwd()}`);
      }
    });

  // RTK Filter command - filter existing output
  program
    .command('rtk:filter [text...]')
    .description('Filter text through RTK output filter')
    .option('--stdin', 'Read from stdin instead of arguments')
    .option('--group', 'Group grep-style output by file')
    .action(async (textParts, options) => {
      let input = textParts.join(' ');
      
      if (options.stdin) {
        // Read from stdin
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        
        const lines: string[] = [];
        for await (const line of rl) {
          lines.push(line);
        }
        input = lines.join('\n');
      }
      
      if (!input.trim()) {
        console.log(chalk.red('No input provided'));
        return;
      }
      
      const filtered = filterOutput(input, '', { groupByFile: options.group });
      
      console.log(chalk.cyanBright('\n=== RTK Filtered Output ===\n'));
      console.log(filtered);
      
      const origTokens = Math.ceil(input.length / 4);
      const filteredTokens = Math.ceil(filtered.length / 4);
      const savings = origTokens - filteredTokens;
      
      console.log(chalk.gray(`\nToken savings: ${savings} (${Math.round((savings / origTokens) * 100)}%)`));
    });
}

export default registerRTKCommands;