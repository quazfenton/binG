const readline = require('readline');
const { execSync } = require('child_process');

const commitsOutput = execSync('git log --pretty=format:"%h %ad %s" --date=short --decorate=no').toString();
const commits = commitsOutput.split('\n').filter(line => line.trim());

const formattedCommits = commits.map(commit => {
  const parts = commit.split(' ');
  const hash = parts[0];
  const date = parts[1];
  const message = parts.slice(2).join(' ');
  return `[R] ${hash} ${date} ${message}`;
});

let selectedIndex = 0;
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function displayList() {
  rl.output.write('\x1b[2J\x1b[0;0H');
  formattedCommits.forEach((line, index) => {
    if (index === selectedIndex) {
      rl.output.write(`> ${line}\n`);
    } else {
      rl.output.write(line + '\n');
    }
  });
  rl.output.write('\nUse ↑/↓ to navigate, Enter to select\n');
}

displayList();

rl.on('keypress', (key) => {
  if (key === '\u001b[A') {
    selectedIndex = Math.max(0, selectedIndex - 1);
    displayList();
  } else if (key === '\u001b[B') {
    selectedIndex = Math.min(formattedCommits.length - 1, selectedIndex + 1);
    displayList();
  } else if (key === '\r' || key === '\n') {
    const selectedCommit = formattedCommits[selectedIndex].split(' ')[1];
    try {
      execSync(`git reset --hard ${selectedCommit}`);
      rl.output.write(`\nRolled back to ${selectedCommit}\n`);
    } catch (err) {
      rl.output.write(`\nError rolling back: ${err.message}\n`);
    }
    rl.close();
  }
});