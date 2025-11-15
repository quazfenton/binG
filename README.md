![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/quazfenton/binG?utm_source=oss&utm_medium=github&utm_campaign=quazfenton%2FbinG&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)
# binG - Advanced LLM Chat Interface

A spatial interface for AI interactions that combines traditional chat functionality with immersive  visualization, voice integration, and multi-provider LLM support.

![binG Interface](https://via.placeholder.com/)

## ✨ Features

### 🎯 Core Functionality
- **Multi-Provider LLM Support**: OpenAI, Anthropic, Google, Cohere, Together AI, Replicate, Portkey
- **Real-time Streaming**: Smooth text streaming with fade-in animations
- **Interface**: Traditional chat panel alongside immersive visualization
- **Voice Integration**: Text-to-speech and speech-to-text using Livekit
- **Chat History**: Persistent local storage with export functionality
- **Provider Selection**: Easy switching between AI models and providers
- **Free Models**: Access to DeepSeek R1, Gemini, OpenRouter, Grok, and Flux models via Portkey

### 🎨 Advanced UI/UX
- **Streaming Animations**: Typewriter effect with smooth character-by-character display
- **Mood-Responsive Interface**:  environment adapts to conversation tone
- **Copy & Download**: Individual message copying and code block extraction
- **Accessibility Controls**: Screen reader support, voice controls, text sizing
- **Error Handling**: Comprehensive error management with user-friendly messages

### 🔊 Voice Features
- **Text-to-Speech**: Automatic voice synthesis for AI responses
- **Speech-to-Text**: Voice input with real-time transcription
- **Voice Settings**: Customizable rate, pitch, volume, and voice selection
- **Livekit Integration**: Professional-grade voice processing

### 💾 Data Management
- **Local Storage**: Chat history persisted in browser
- **Export Options**: Download individual chats or complete history
- **Code Extraction**: Automatic code block detection and file generation
- **Session Management**: Resume conversations across browser sessions

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- pnpm (recommended) or npm
- API keys for your preferred LLM providers

### Installation

1. **Clone and setup**
   ```bash
   cd binG
   pnpm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

3. **Add your API keys** (see [API Configuration](#api-configuration))

4. **Start development server**
   ```bash
   pnpm dev
   ```

5. **Open in browser**
   ```
   http://localhost:3000
   ```

## 🔑 API Configuration

### Required: At least one LLM provider API key

Edit `.env` file with your API keys:

#### OpenAI (Recommended)
```env
OPENAI_API_KEY=sk-your_openai_api_key_here
OPENAI_ORG_ID=org-your_openai_org_id_here  # Optional
```

#### Anthropic (Claude)
```env
ANTHROPIC_API_KEY=sk-ant-your_anthropic_api_key_here
```

#### Google (Gemini)
```env
GOOGLE_API_KEY=your_google_api_key_here
```

#### Cohere
```env
COHERE_API_KEY=your_cohere_api_key_here
```

#### Together AI
```env
TOGETHER_API_KEY=your_together_api_key_here
```

#### Replicate
```env
REPLICATE_API_TOKEN=r8_your_replicate_token_here
```

### Optional: Voice Integration (Livekit)
```env
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here
LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
NEXT_PUBLIC_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
```

### Optional: Portkey (AI Gateway with Free Models)
```env
PORTKEY_API_KEY=your_portkey_api_key_here
PORTKEY_VIRTUAL_KEY=your_portkey_virtual_key_here
```

**Available Free Models:**
- `chutes/deepseek-r1-0528:free` - DeepSeek R1 (Latest reasoning model)
- `chutes/gemini-1.5-flash:free` - Google Gemini 1.5 Flash
- `chutes/openrouter-auto:free` - OpenRouter Auto Selection
- `chutes/grok-beta:free` - Grok Beta
- `chutes/flux-dev:free` - Flux Dev (Image Generation)
- `chutes/flux-schnell:free` - Flux Schnell (Fast Image Generation)

## 🎮 Usage Guide

### Basic Chat
1. **Start Conversation**: Type in the input field and press Enter
2. **View Responses**: Messages appear in both 2D chat panel and  space
3. **Copy Messages**: Click copy button on any message
4. **Download Code**: Extract code blocks from AI responses

### Provider Management
1. **Switch Providers**: Use dropdown in chat panel header
2. **Select Models**: Choose specific model for selected provider
3. **Adjust Settings**: Temperature, max tokens, streaming options

### Voice Features
1. **Enable Voice**: Toggle voice button in chat panel or accessibility controls
2. **Voice Input**: Speak directly to send messages
3. **Voice Output**: AI responses are automatically spoken
4. **Voice Settings**: Adjust rate, pitch, volume in accessibility panel

###  Interface
1. **Navigation**: Click and drag to rotate, scroll to zoom
2. **Message Nodes**: Click on  shapes to expand message content
3. **Mood Visualization**: Environment color reflects conversation tone
4. **Thought Process**: Floating spheres show AI processing stages

### Chat History
1. **Auto-Save**: Conversations automatically saved locally
2. **Load Previous**: Use history button to browse past chats
3. **Export Options**: Download individual chats or complete history
4. **Delete Chats**: Remove unwanted conversation history

## 🛠️ Development

### Project Structure
```
binG/
├── app/
│   ├── api/chat/          # LLM API endpoints
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx          # Main page
├── components/
│   ├── ui/               # Reusable UI components
│   ├── chat-panel.tsx    # 2D chat interface
│   ├── conversation-interface.tsx  # Main interface
│   ├── conversation-space.tsx      #  visualization
│   └── ...
├── hooks/
│   ├── use-conversation.ts  # Chat logic and API calls
│   └── use-chat-history.ts  # History management
├── lib/
│   ├── api/
│   │   └── llm-providers.ts  # Multi-provider LLM service
│   └── voice/
│       └── voice-service.ts  # Voice integration
├── types/
│   └── index.ts          # TypeScript definitions
└── voice-assistant/      # Livekit integration (reference)
```

### Key Components

#### LLM Service (`lib/api/llm-providers.ts`)
- Multi-provider abstraction
- Streaming support
- Error handling
- Usage tracking

#### Voice Service (`lib/voice/voice-service.ts`)
- Web Speech API integration
- Livekit connectivity
- Voice settings management
- Event handling

#### Conversation Hook (`hooks/use-conversation.ts`)
- Message management
- API communication
- Streaming handling
- Settings persistence

### Adding New Providers

1. **Update LLM Service**
   ```typescript
   // Add to PROVIDERS constant
   newProvider: {
     id: 'newProvider',
     name: 'New Provider',
     models: ['model1', 'model2'],
     supportsStreaming: true,
     maxTokens: 4096,
     description: 'Description'
   }
   ```

2. **Implement API Methods**
   ```typescript
   private async callNewProvider(messages, model, temperature, maxTokens) {
     // Implementation
   }
   ```

3. **Add Environment Variables**
   ```env
   NEW_PROVIDER_API_KEY=your_key_here
   ```

## 🔧 Troubleshooting

### Common Issues

#### "No providers available"
- **Cause**: Missing or invalid API keys
- **Solution**: Check `.env` file and verify API key format
- **Debug**: Check browser console for specific error messages

#### "Failed to generate response"
- **Cause**: API rate limits, quota exceeded, or network issues
- **Solution**: Check API usage limits and network connectivity
- **Debug**: Look at Network tab in browser dev tools

#### Voice features not working
- **Cause**: Browser doesn't support Web Speech API or microphone permissions
- **Solution**: Use Chrome/Edge, grant microphone permissions
- **Debug**: Check browser compatibility and permissions

####  interface not loading
- **Cause**: WebGL not supported or graphics issues
- **Solution**: Use modern browser, update graphics drivers
- **Debug**: Check browser WebGL support

### Performance Optimization

#### Large Chat History
- **Issue**: Slow loading with many saved chats
- **Solution**: Clear old chat history regularly
- **Code**: Use "Download All History" then clear storage

#### Streaming Lag
- **Issue**: Slow text streaming animation
- **Solution**: Adjust `TYPING_SPEED` in `chat-panel.tsx`
- **Code**: Lower value = faster typing

## 🎯 Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_LLM_PROVIDER` | Default AI provider | `openai` |
| `DEFAULT_MODEL` | Default model | `gpt-4` |
| `DEFAULT_TEMPERATURE` | Response creativity | `0.7` |
| `DEFAULT_MAX_TOKENS` | Response length limit | `2000` |
| `ENABLE_VOICE_FEATURES` | Voice integration | `true` |
| `ENABLE_CHAT_HISTORY` | History persistence | `true` |

### Runtime Settings

Access via chat panel or accessibility controls:
- **Provider Selection**: Switch between available providers
- **Model Selection**: Choose specific models per provider
- **Voice Settings**: Rate, pitch, volume, language
- **UI Settings**: Text size, contrast, motion reduction

## 📱 Browser Compatibility

### Fully Supported
- **Chrome 90+**: All features including voice
- **Edge 90+**: All features including voice
- **Firefox 90+**: Limited voice support
- **Safari 14+**: Limited voice support

### Feature Support Matrix

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
|  Interface | ✅ | ✅ | ✅ | ✅ |
| Chat Interface | ✅ | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ | ✅ |
| Text-to-Speech | ✅ | ✅ | ⚠️ | ⚠️ |
| Speech-to-Text | ✅ | ✅ | ❌ | ❌ |
| Livekit Voice | ✅ | ✅ | ✅ | ✅ |

## 🤝 Contributing

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit changes**: `git commit -m 'Add amazing feature'`
4. **Push to branch**: `git push origin feature/amazing-feature`
5. **Open Pull Request**

### Development Guidelines
- Follow TypeScript best practices
- Add proper error handling
- Include accessibility features
- Test across browsers
- Update documentation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Livekit**: Voice integration infrastructure
- **Three.js**:  visualization engine
- **Radix UI**: Accessible component library
- **Framer Motion**: Animation library
- **OpenAI, Anthropic, Google**: AI model providers

## 🔗 Links

- **Live Demo**: [Coming Soon]
- **Documentation**: [Wiki](https://github.com/yourusername/binG/wiki)
- **Issues**: [GitHub Issues](https://github.com/yourusername/binG/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/binG/discussions)

---

**Built with ❤️ by the binG team**

*A revolutionary approach to AI interaction that bridges the gap between traditional chat interfaces and immersive  experiences.*
