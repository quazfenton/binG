# 🚀 Quick Start Guide: Advanced Mini-Apps Integration

## For Developers - Getting Started in 5 Minutes

### Prerequisites
- binG deployed at `chat.quazfenton.xyz`
- futuraa deployed at `www.quazfenton.xyz`
- Both repos cloned and dependencies installed

---

## 1️⃣ Test Plugins in binG (Development)

```bash
cd binG
npm run dev
```

Visit these URLs to test each plugin:
- http://localhost:3000/embed/github-advanced
- http://localhost:3000/embed/hf-spaces-pro
- http://localhost:3000/embed/devops
- http://localhost:3000/embed/sandbox
- http://localhost:3000/embed/api-pro
- http://localhost:3000/embed/data-workbench
- http://localhost:3000/embed/creative
- http://localhost:3000/embed/cloud-pro
- http://localhost:3000/embed/wiki
- http://localhost:3000/embed/prompts

---

## 2️⃣ Add Plugins to futuraa

Open `futuraa/src/components/ModularInterface.tsx` and add the new modules to the `modules` object:

```typescript
import { 
  // ... existing imports
  Server, Cloud, BookOpen, TrendingUp
} from 'lucide-react';

// Inside modules object, add:
const modules: Record<string, ModuleWindow> = {
  // ... existing modules (chat, notes, hfspaces, network, github)
  
  githubAdvanced: {
    id: 'github-advanced',
    title: 'GitHub Pro',
    icon: GitBranch,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/github-advanced" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="github-advanced"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="GitHub Pro"
      />
    ),
    position: { x: 150, y: 100 },
    size: { width: 1000, height: 700 },
    subdomain: 'chat'
  },
  
  hfSpacesPro: {
    id: 'hf-spaces-pro',
    title: 'HF Spaces Pro',
    icon: Sparkles,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/hf-spaces-pro" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="hf-spaces-pro"
        allow="clipboard-read; clipboard-write; microphone; camera"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="HF Spaces Pro"
      />
    ),
    position: { x: 180, y: 120 },
    size: { width: 1200, height: 800 },
    subdomain: 'chat'
  },
  
  devops: {
    id: 'devops',
    title: 'DevOps Center',
    icon: Server,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/devops" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="devops"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="DevOps Center"
      />
    ),
    position: { x: 200, y: 140 },
    size: { width: 1000, height: 700 },
    subdomain: 'chat'
  },
  
  sandbox: {
    id: 'sandbox',
    title: 'Code Sandbox',
    icon: Code,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/sandbox" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="sandbox"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Code Sandbox"
      />
    ),
    position: { x: 220, y: 160 },
    size: { width: 900, height: 650 },
    subdomain: 'chat'
  },
  
  apiPro: {
    id: 'api-pro',
    title: 'API Playground',
    icon: Globe,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/api-pro" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="api-pro"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="API Playground"
      />
    ),
    position: { x: 240, y: 180 },
    size: { width: 1000, height: 700 },
    subdomain: 'chat'
  },
  
  dataWorkbench: {
    id: 'data-workbench',
    title: 'Data Workbench',
    icon: TrendingUp,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/data-workbench" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="data-workbench"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Data Workbench"
      />
    ),
    position: { x: 260, y: 200 },
    size: { width: 1000, height: 700 },
    subdomain: 'chat'
  },
  
  creative: {
    id: 'creative',
    title: 'Creative Studio',
    icon: Sparkles,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/creative" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="creative"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Creative Studio"
      />
    ),
    position: { x: 280, y: 220 },
    size: { width: 900, height: 650 },
    subdomain: 'chat'
  },
  
  cloudPro: {
    id: 'cloud-pro',
    title: 'Cloud Storage',
    icon: Cloud,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/cloud-pro" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="cloud-pro"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Cloud Storage"
      />
    ),
    position: { x: 300, y: 240 },
    size: { width: 1000, height: 700 },
    subdomain: 'chat'
  },
  
  wiki: {
    id: 'wiki',
    title: 'Wiki',
    icon: BookOpen,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/wiki" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="wiki"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Wiki"
      />
    ),
    position: { x: 320, y: 260 },
    size: { width: 900, height: 700 },
    subdomain: 'chat'
  },
  
  prompts: {
    id: 'prompts',
    title: 'AI Prompts',
    icon: Brain,
    content: (
      <iframe 
        src="https://chat.quazfenton.xyz/embed/prompts" 
        className="w-full h-full border-0 rounded"
        loading="lazy"
        data-module="prompts"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="AI Prompts"
      />
    ),
    position: { x: 340, y: 280 },
    size: { width: 900, height: 700 },
    subdomain: 'chat'
  }
};
```

---

## 3️⃣ Update Navigation

Open `futuraa/src/components/FluidNavigation.tsx` and add items to the navigation sections array:

```typescript
const sections = [
  // ... existing sections
  {
    id: 'github-advanced',
    label: 'GitHub Pro',
    icon: GitBranch,
    description: 'Advanced repo analysis'
  },
  {
    id: 'hf-spaces-pro',
    label: 'HF Spaces Pro',
    icon: Sparkles,
    description: 'ML models & Gradio'
  },
  {
    id: 'devops',
    label: 'DevOps Center',
    icon: Server,
    description: 'Docker & CI/CD'
  },
  {
    id: 'sandbox',
    label: 'Code Sandbox',
    icon: Code,
    description: 'Multi-language execution'
  },
  {
    id: 'api-pro',
    label: 'API Playground',
    icon: Globe,
    description: 'REST & GraphQL'
  },
  {
    id: 'data-workbench',
    label: 'Data Workbench',
    icon: TrendingUp,
    description: 'CSV analysis & ML'
  },
  {
    id: 'creative',
    label: 'Creative Studio',
    icon: Sparkles,
    description: 'Image & video editing'
  },
  {
    id: 'cloud-pro',
    label: 'Cloud Storage',
    icon: Cloud,
    description: 'Multi-provider files'
  },
  {
    id: 'wiki',
    label: 'Wiki',
    icon: BookOpen,
    description: 'Knowledge base'
  },
  {
    id: 'prompts',
    label: 'AI Prompts',
    icon: Brain,
    description: 'Prompt library'
  }
];
```

---

## 4️⃣ Test Integration

```bash
cd futuraa
npm run dev
```

Visit http://localhost:5173 and:
1. Click dock buttons to open mini-apps
2. Drag windows around
3. Double-click to maximize
4. Test dock scrolling if >6 apps visible
5. Toggle light mode to test theming
6. Verify postAuthToIframes is ready for token passing

---

## 5️⃣ Deploy to Production

### Deploy binG:
```bash
cd binG
git add .
git commit -m "feat: add 10 advanced plugins with embed routes"
git push origin feature/plugins-advanced-embed
# Create PR and merge
```

### Deploy futuraa:
```bash
cd futuraa
git add .
git commit -m "feat: integrate 10 advanced mini-apps from binG"
git push origin feature/embed-bing-mini-apps
# Create PR and merge
```

---

## 6️⃣ API Endpoints to Create (Optional)

Some plugins need backend APIs:

### binG Backend APIs:
```
POST /api/execute - Code execution sandbox
POST /api/docker/containers - List containers
POST /api/docker/start/:id - Start container
POST /api/docker/stop/:id - Stop container
POST /api/docker/logs/:id - Get logs
POST /api/docker/exec - Execute command
POST /api/docker/compose - Deploy compose file
GET  /api/cloud/resources - List cloud resources
GET  /api/cicd/pipelines - List pipelines
POST /api/cicd/restart/:id - Restart pipeline
POST /api/huggingface/inference - LLM inference
POST /api/huggingface/audio - Audio generation
```

---

## 🔐 Auth Integration

When you implement login in futuraa, call:
```typescript
postAuthToIframes(token);
```

This broadcasts the token to all plugin iframes, and binG plugins will receive it and store it in `localStorage('token')`.

---

## 📊 Category Suggestions for Dock

Organize the 15 total mini-apps into categories:

### Developer (5)
- GitHub Pro
- Code Sandbox
- API Playground
- DevOps Center
- Network Builder

### AI & ML (3)
- LLM Chat (binG)
- HF Spaces Pro
- AI Prompts

### Data (2)
- Data Workbench
- GitHub Pro (metrics)

### Creative (2)
- Creative Studio
- HF Spaces Pro (image gen)

### Productivity (5)
- Wiki
- Notes
- Cloud Storage
- Music Player
- Journal

---

## 🐛 Troubleshooting

### Plugin not loading?
- Check console for CORS errors
- Ensure binG is deployed and accessible
- Verify iframe sandbox permissions
- Check CSP headers

### Blank iframe?
- Test the embed route directly in binG
- Check browser console for errors
- Verify data-module attribute exists

### Auth not working?
- Verify postAuthToIframes is called after login
- Check iframe contentWindow is accessible
- Confirm binG listens for 'bing:auth' message

---

## 📚 Additional Resources

- See `IMPLEMENTATION_COMPLETE.md` for full feature list
- See `ADVANCED_MINIAPPS_PROPOSAL.md` for original plan
- See `Docs/Confluence_Integration_AuthBridge.md` for auth details
- See `futuraa/PR_BODY.md` and `binG/PR_BODY.md` for PR descriptions

---

## ✅ Checklist

- [ ] All 10 plugin files exist in binG/components/plugins/
- [ ] All 10 embed routes exist in binG/app/embed/
- [ ] All 10 modules added to futuraa ModularInterface
- [ ] All 10 items added to FluidNavigation
- [ ] Dock scrolling works with many apps
- [ ] Light mode toggle works
- [ ] Windows drag, resize, maximize properly
- [ ] Auth bridge ready (postAuthToIframes)
- [ ] Mobile responsive
- [ ] No console errors

---

## 🎉 You're Ready!

You now have a production-ready homepage with **15 fully functional mini-apps** that rival standalone tools. The cyber-aesthetic design and smooth interactions make it a unique productivity powerhouse.

**Questions?** Check the implementation docs or test each plugin individually first.

**Happy building! 🚀**
