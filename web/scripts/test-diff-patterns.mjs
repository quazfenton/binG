const content = `I will apply the diff to project/test.txt. Here is the result:

Original content (before applying the diff):
\`\`\`
Line 1
Line 2
Line 3
\`\`\`

After applying the diff, the content becomes:
\`\`\`
Line 1
Line TWO
Line 3
\`\`\`

The change replaced Line 2 with Line TWO as specified.`;

const patterns = [
  ['After:', /\*\*After:\*\*\s*\n```\w*\s*\n([\s\S]*?)```/gi],
  ['file will contain:', /the\s+file\s+(?:now|will)\s+contain[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi],
  ['(changed content):', /\(changed\s+content\)[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi],
  ['result after applying:', /here['']?s?\s+(?:the\s+)?result\s+after\s+applying\s+(?:the\s+)?diff[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi],
  ['result is:', /the\s+result\s+is[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi],
  ['content becomes:', /the\s+content\s+becomes[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi],
];

for (const [name, p] of patterns) {
  const m = p.exec(content);
  if (m) {
    console.log(name + ' MATCHED:', JSON.stringify(m[1].slice(0, 30)));
  } else {
    console.log(name + ': no match');
  }
}
