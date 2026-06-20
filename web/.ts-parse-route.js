// TS-AST-aware brace-mismatch detector for route.ts
// Uses ts.createSourceFile (no CompilerHost needed) for clean AST diagnostics.
const ts = require('typescript');
const fs = require('fs');

const RT = './app/api/chat/route.ts';
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

// Show last statement for context
var last = sf.statements[sf.statements.length - 1];
if (last) {
  var startPos = last.getStart(sf);
  var lc = sf.getLineAndCharacterOfPosition(startPos);
  console.log('\nLast top-level statement at L' + (lc.line + 1) + ', kind: ' + ts.SyntaxKind[last.kind]);
}

// Probe: scan line-by-line braces using AST-aware brace counter
// (Strips strings + comments before counting.)
function stripStringsComments(line) {
  var s = line.replace(/\/\/.*$/, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  s = s.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  s = s.replace(/`[^`]*`/g, '``');
  return s;
}

console.log('\n--- Brace stack at each potentially suspicious boundary ---');
var anchorLines = [1140, 1145, 1150, 1155, 1160, 1170, 1180, 1200, 1210, 1350, 1357, 1394, 1700, 1705, 1712, 1713, 1738, 1800, 1900, 1909, 1955, 1961];
var src_lines = src.split('\n');
var maxAnchor = anchorLines[anchorLines.length - 1];
var anchorIndex = 0;
var stack = [];
for (var lineNum = 1; lineNum <= maxAnchor; lineNum++) {
  var ln = src_lines[lineNum - 1] || '';
  var code = stripStringsComments(ln);
  for (var j = 0; j < code.length; j++) {
    var c = code[j];
    if (c === '{') stack.push([lineNum, j + 1, ln.trim().slice(0, 80)]);
    else if (c === '}') {
      if (stack.length) stack.pop();
      else console.log('  UNMATCHED } at L' + lineNum + ',C' + (j + 1) + ': ' + ln.trim().slice(0, 80));
    }
  }
  if (anchorIndex < anchorLines.length && lineNum === anchorLines[anchorIndex]) {
    console.log('  L' + lineNum + ': stack depth = ' + stack.length);
    anchorIndex++;
  }
}

// Final dump: any unclosed innermost braces at L1970
console.log('\n--- Innermost 5 unclosed braces at L1970 ---');
var finalStack = [];
src_lines.forEach(function (ln, idx) {
  var i = idx + 1;
  if (i > 1970) return;
  var code = stripStringsComments(ln);
  for (var j = 0; j < code.length; j++) {
    var c = code[j];
    if (c === '{') finalStack.push([i, j + 1, ln.trim().slice(0, 80)]);
    else if (c === '}') {
      if (finalStack.length) finalStack.pop();
    }
  }
});
console.log('Total unclosed at L1970: ' + finalStack.length);
finalStack.slice(-5).forEach(function (e) {
  console.log('  L' + e[0] + ' C' + e[1] + ': ' + e[2]);
});
