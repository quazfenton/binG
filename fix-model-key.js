const fs = require('fs');
let content = fs.readFileSync('web/components/interaction-panel.tsx', 'utf8');

// The old problematic code - using the exact characters from the file
const oldCode = `{provider.models.map((model: string) => (
                  <SelectItem key={model} value={\u0060\u0024{provider.id}:\u0024{model}\u0060}>
                    {model}
                  </SelectItem>
                ))}`;

// The new fixed code
const newCode = `{provider.models.map((model: ModelConfig | string) => {
                  const modelId = typeof model === 'string' ? model : model.id;
                  return (
                    <SelectItem key={\u0060\u0024{provider.id}:\u0024{modelId}\u0060} value={\u0060\u0024{provider.id}:\u0024{modelId}\u0060}>
                      {modelId}
                    </SelectItem>
                  );
                })}`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('web/components/interaction-panel.tsx', content);
  console.log('Fixed! React key collision resolved.');
} else {
  // Try without template literals
  const idx = content.indexOf('provider.models.map((model: string) =>');
  if (idx > -1) {
    const section = content.substring(idx, idx + 200);
    console.log('Found section:', JSON.stringify(section));
    
    // Replace using regex on the actual section
    const regex = /{provider\\.models\\.map\\(\\(model: string\\) => \\(\n\\s+<SelectItem key=\\{model\\} value=`\\$\\{provider\\.id\\}:\\$\\{model\\}`>\n\\s+\\{model\\}\n\\s+<\\/SelectItem>\\n\\s+\\)\\)}/;
    
    const replacement = `{provider.models.map((model: ModelConfig | string) => {
                  const modelId = typeof model === 'string' ? model : model.id;
                  return (
                    <SelectItem key={\u0060\u0024{provider.id}:\u0024{modelId}\u0060} value={\u0060\u0024{provider.id}:\u0024{modelId}\u0060}>
                      {modelId}
                    </SelectItem>
                  );
                })}`;
    
    content = content.replace(regex, replacement);
    fs.writeFileSync('web/components/interaction-panel.tsx', content);
    console.log('Fixed with regex!');
  } else {
    console.log('Could not find the pattern.');
  }
}