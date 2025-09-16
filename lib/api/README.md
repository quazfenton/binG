# Enhanced API Client with Fallback System

This implementation provides a robust API client with comprehensive error handling, retry logic, fallback mechanisms, and circuit breaker patterns for improved application stability.

## Features

### 🔄 Retry Logic with Exponential Backoff
- Configurable retry attempts with multiple backoff strategies
- Intelligent retry decision based on error types and HTTP status codes
- Jitter support to prevent thundering herd problems

### 🔀 Fallback Endpoint Management
- Automatic failover to backup endpoints
- Health monitoring and endpoint prioritization
- Seamless switching between primary and fallback services

### ⚡ Circuit Breaker Pattern
- Prevents cascading failures by temporarily disabling problematic endpoints
- Automatic recovery with half-open state testing
- Configurable failure thresholds and recovery timeouts

### 🛡️ Comprehensive Error Handling
- User-friendly error messages with suggested actions
- Error categorization and severity levels
- Centralized error processing and logging

### 📊 Health Monitoring
- Real-time endpoint health tracking
- Performance metrics collection
- Automated health checks with configurable intervals

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enhanced API Client                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  Retry Logic    │  │ Circuit Breaker │  │ Health Check │ │
│  │                 │  │                 │  │              │ │
│  │ • Exponential   │  │ • Failure Count │  │ • Endpoint   │ │
│  │ • Linear        │  │ • Recovery Time │  │   Monitoring │ │
│  │ • Fixed         │  │ • State Machine │  │ • Metrics    │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Error Handler   │  │ Fallback System │  │ LLM Service  │ │
│  │                 │  │                 │  │              │ │
│  │ • Categorization│  │ • Primary/      │  │ • Provider   │ │
│  │ • User Messages │  │   Fallback      │  │   Fallback   │ │
│  │ • Notifications │  │ • Auto-switch   │  │ • Model      │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Usage Examples

### Basic API Request with Retry

```typescript
import { enhancedAPIClient } from './enhanced-api-client';

const response = await enhancedAPIClient.request({
  url: 'https://api.example.com/data',
  method: 'GET',
  retries: {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 10000,
    jitter: true,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504]
  },
  timeout: 30000,
  circuitBreaker: true
});
```

### Fallback Endpoints

```typescript
const primaryConfig = {
  url: 'https://primary-api.example.com/service',
  method: 'POST',
  data: { query: 'test' }
};

const fallbackConfigs = [
  { url: 'https://fallback1.example.com/service', method: 'POST', data: { query: 'test' } },
  { url: 'https://fallback2.example.com/service', method: 'POST', data: { query: 'test' } }
];

const response = await enhancedAPIClient.withFallback(primaryConfig, fallbackConfigs);
```

### Enhanced LLM Service

```typescript
import { enhancedLLMService } from './enhanced-llm-service';

const response = await enhancedLLMService.generateResponse({
  messages: [{ role: 'user', content: 'Hello!' }],
  provider: 'openrouter',
  model: 'deepseek/deepseek-r1-0528:free',
  fallbackProviders: ['chutes', 'anthropic'],
  retryOptions: {
    maxAttempts: 3,
    backoffStrategy: 'exponential'
  },
  enableCircuitBreaker: true
});
```

### Error Handling

```typescript
import { errorHandler } from './error-handler';

try {
  // API call
} catch (error) {
  const processedError = errorHandler.processError(error, {
    component: 'chat-api',
    operation: 'generateResponse',
    provider: 'openrouter'
  });

  console.log('User Message:', processedError.userMessage);
  console.log('Suggested Action:', processedError.suggestedAction);
  console.log('Is Retryable:', processedError.isRetryable);
}
```

### Health Monitoring

```typescript
// Start monitoring
enhancedAPIClient.startHealthMonitoring([
  'https://api.openrouter.ai/api/v1',
  'https://llm.chutes.ai/v1'
], 60000);

// Get health status
const health = enhancedAPIClient.getEndpointHealth();
const circuitBreakerStats = enhancedAPIClient.getCircuitBreakerStats();
```

## React Hooks

### useEnhancedAPI Hook

```typescript
import { useEnhancedAPI } from '../../hooks/use-enhanced-api';

function MyComponent() {
  const { data, loading, error, request, retry } = useEnhancedAPI({
    enableNotifications: true,
    enableRetry: true,
    maxRetries: 3
  });

  const handleRequest = async () => {
    await request({
      url: '/api/data',
      method: 'GET',
      enableCircuitBreaker: true
    });
  };

  return (
    <div>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
      <button onClick={handleRequest}>Make Request</button>
    </div>
  );
}
```

### useAPIHealth Hook

```typescript
import { useAPIHealth } from '../../hooks/use-enhanced-api';

function HealthDashboard() {
  const { health, loading, checkHealth, resetCircuitBreaker } = useAPIHealth();

  return (
    <div>
      <h2>API Health Status</h2>
      {health && (
        <div>
          <p>Status: {health.status}</p>
          <p>Available Providers: {health.providers.available.join(', ')}</p>
          <button onClick={() => resetCircuitBreaker()}>Reset All Circuit Breakers</button>
        </div>
      )}
    </div>
  );
}
```

## API Endpoints

### Health Check Endpoint

```
GET /api/health
GET /api/health?detailed=true
POST /api/health
```

**GET Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "providers": {
    "available": ["openrouter", "chutes", "anthropic"],
    "total": 5
  }
}
```

**POST Actions:**
- `reset-circuit-breaker`: Reset circuit breakers
- `clear-error-stats`: Clear error statistics
- `test-provider`: Test specific provider

## Configuration

### Circuit Breaker Configuration

```typescript
const config = {
  failureThreshold: 5,      // Open circuit after 5 failures
  recoveryTimeout: 30000,   // Try again after 30 seconds
  monitoringWindow: 60000   // Monitor failures over 60 seconds
};
```

### Retry Configuration

```typescript
const retryOptions = {
  maxAttempts: 3,
  backoffStrategy: 'exponential', // 'exponential' | 'linear' | 'fixed'
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: true,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504]
};
```

### Error Handler Configuration

```typescript
const errorConfig = {
  enableLogging: true,
  enableUserNotifications: true,
  enableRetryRecommendations: true,
  logLevel: 'error' // 'error' | 'warn' | 'info' | 'debug'
};
```

## Error Types and User Messages

| Error Code | User Message | Retryable | Suggested Action |
|------------|--------------|-----------|------------------|
| `AUTH_ERROR` | Authentication failed. Please check your API key configuration. | No | Verify your API keys in settings |
| `RATE_LIMIT_ERROR` | Too many requests. The system will automatically retry. | Yes | Please wait, switching to alternatives |
| `QUOTA_ERROR` | API quota exceeded. Switching to alternative provider. | Yes | Consider upgrading your API plan |
| `NETWORK_ERROR` | Connection issue detected. Checking alternatives. | Yes | Check your internet connection |
| `TIMEOUT_ERROR` | Request timed out. The system will retry. | Yes | The system will automatically retry |
| `MODEL_ERROR` | Model unavailable. Trying alternative models. | Yes | System will try compatible models |
| `SERVER_ERROR` | Service temporarily unavailable. | Yes | This is temporary, trying alternatives |
| `CIRCUIT_BREAKER_ERROR` | Service protection activated. | Yes | System disabled problematic service |

## Integration with Existing Code

The enhanced API client integrates seamlessly with the existing chat API:

1. **Chat Route Enhancement**: The `/api/chat` route now uses `enhancedLLMService` for automatic fallbacks
2. **Error Processing**: All errors are processed through the centralized error handler
3. **User Notifications**: Error responses include user-friendly messages and suggested actions
4. **Health Monitoring**: New `/api/health` endpoint provides system status

## Testing

Run the test suite to verify functionality:

```bash
npm test lib/api/__tests__/enhanced-api-client.test.ts
```

The test suite covers:
- Basic request functionality
- Error handling and user messages
- Retry logic with different strategies
- Fallback system behavior
- Circuit breaker functionality
- Health monitoring

## Performance Considerations

- **Memory Usage**: Circuit breaker and health monitoring use minimal memory
- **Network Overhead**: Health checks are lightweight and configurable
- **CPU Impact**: Retry logic and error processing have minimal CPU overhead
- **Scalability**: Designed to handle high-volume API requests efficiently

## Security Features

- **Input Validation**: All requests are validated before processing
- **Error Information**: Sensitive information is not exposed in error messages
- **Rate Limiting**: Built-in protection against excessive requests
- **Circuit Breaker**: Prevents abuse of failing services

## Monitoring and Observability

- **Error Statistics**: Track error frequency and patterns
- **Performance Metrics**: Monitor response times and success rates
- **Health Status**: Real-time endpoint health monitoring
- **Circuit Breaker Stats**: Track circuit breaker state changes

## Future Enhancements

- **Metrics Export**: Integration with monitoring systems (Prometheus, etc.)
- **Advanced Routing**: Intelligent provider selection based on performance
- **Caching Layer**: Response caching for improved performance
- **Load Balancing**: Distribute requests across multiple endpoints
- **A/B Testing**: Support for testing different providers/models