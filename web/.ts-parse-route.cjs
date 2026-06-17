// TS-AST-aware brace-mismatch detector for route.ts — CJS so require() works
const ts = require('typescript');
const fs = require('fs');

const RT = '/opt/bing/web/app/api/chat/route.ts';
const src = fs.readFileSync(RT, 'utf8');

const sf = ts.createSourceFile(
  'route.ts',
  src,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

// AST-aware parser diagnostics — same parser that powers `tsc --noEmit`.
const diags = (sf.parseDiagnostics || []);
console.log('Total parseDiagnostics: ' + diags.length);
diags.slice(0, 30).forEach(function (d, i) {
  if (d.file && d.start !== undefined) {
    var lc = d.file.getLineAndCharacterOfPosition(d.start);
    var line = lc.line + 1;
    var col = lc.character + 1;
    var len = d.length || 0;
    var msg = typeof d.messageText === 'string'
      ? d.messageText
      : d.messageText.messageText;
    var snippet = src.split('\n')[lc.line] || '';
    console.log(
      '  [' + i + '] cat=' + d.category + ' code=' + d.code +
      ' L' + line + ':C' + col + ' "' + msg + '" ' +
      '| snippet: ' + snippet.trim().slice(0, 100)
    );
  }
});

if (diags.length === 0) {
  console.log('  No parser AST errors.');
}

// AST-aware brace counter (strips strings + comments)
function stripStringsComments(line) {
  var s = line.replace(/\/\/.*$/, '');
  s = s.replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  s = s.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  s = s.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return s;
}

console.log('\n--- Brace stack at each anchor ---');
var anchorLines = [
  1200, 1300, 1350, 1357, 1358, 1394, 1400, 1475, 1480, 1500,
  1600, 1700, 1705, 1710, 1712, 1713, 1738, 1740, 1744, 1800,
  1850, 1900, 1901, 1909, 1955, 1958, 1961, 1962, 1965, 1970,
];
var srcLines = src.split('\n');
var stack = [];
anchorLines.forEach(function (i) {
  var ln = srcLines[i - 1] || '';
  var code = stripStringsComments(ln);
  for (var j = 0; j < code.length; j++) {
    var c = code[j];
    if (c === '{') stack.push([i, j + 1, ln.trim().slice(0, 80)]);
    else if (c === '}') {
      if (stack.length) stack.pop();
      else console.log('  UNMATCHED } at L' + i + ',C' + (j + 1) + ': ' + ln.trim().slice(0, 80));
    }
  }
  console.log('  L' + i + ': stack depth = ' + stack.length);
});

// Final dump at L1970
console.log('\n--- Innermost 5 unclosed braces at L1970 ---');
var finalStack = [];
srcLines.forEach(function (ln, idx) {
  var i = idx + 1;
  if (i > 1970) return;
  var code = stripStringsComments(ln);
  for (var j = 0; j < code.length; j++) {
    var c = code[j];
    if (c === '{') finalStack.push([i, j + 1, ln.trim().slice(0, 80)]);
    else if (c === '}') {
      if (finalStack.length) finalStack.pop();
      else console.log('  UNMATCHED } at L' + i + ',C' + (j + 1) + ': ' + ln.trim().slice(0, 80));
    }
  }
});
console.log('Total unclosed at L1970: ' + finalStack.length);
finalStack.slice(-5).forEach(function (e) {
  console.log('  L' + e[0] + ' C' + e[1] + ': ' + e[2]);
});

// Show last statement
var last = sf.statements[sf.statements.length - 1];
if (last) {
  var startPos = last.getStart(sf);
  var lc = sf.getLineAndCharacterOfPosition(startPos);
  console.log('\nLast top-level statement at L' + (lc.line + 1) + ', kind: ' + ts.SyntaxKind[last.kind]);
}
