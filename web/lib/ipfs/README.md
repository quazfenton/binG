# IPFS Module Configuration

## Environment Variables

```bash
# Enable IPFS module
IPFS_ENABLED=true

# Provider configuration
IPFS_PROVIDER=pinata                    # pinata | web3storage | custom
IPFS_API_KEY=your_api_key              # Provider API key
IPFS_SECRET_KEY=your_secret_key        # Provider secret (for Pinata)

# Gateway configuration
IPFS_GATEWAY_URL=https://ipfs.io       # Default gateway for downloads

# Cluster configuration (optional, for distributed seeding)
IPFS_CLUSTER_URL=http://localhost:9094
IPFS_CLUSTER_SECRET=cluster_secret

# Limits
IPFS_MAX_FILE_SIZE=104857600           # 100MB default max file size
```

## Provider Setup

### Pinata (Recommended)

1. Create account at https://pinata.cloud
2. Generate API key from dashboard
3. Set environment variables:
   ```
   IPFS_PROVIDER=pinata
   IPFS_API_KEY=your_pinata_api_key
   IPFS_SECRET_KEY=your_pinata_secret
   ```

### web3.storage

1. Create account at https://web3.storage
2. Generate API token
3. Set environment variables:
   ```
   IPFS_PROVIDER=web3storage
   IPFS_API_KEY=your_web3_token
   ```

### Custom IPFS Node

1. Have a running IPFS daemon with API endpoint
2. Set environment variables:
   ```
   IPFS_PROVIDER=custom
   IPFS_GATEWAY_URL=http://your-ipfs-node:5001
   ```

## Usage Types & Seeding Policies

| Usage Type | Auto-Seed | Pin Duration | Max Size | Providers |
|------------|-----------|--------------|----------|-----------|
| package-cache | Yes | 1 week | 50MB | pinata |
| model-weights | Yes | Permanent | 5GB | pinata, web3storage |
| user-files | No (opt-in) | 30 days | 100MB | pinata |
| snapshots | Yes | Permanent | 10GB | pinata, filecoin |
| edge-cache | Yes | 1 day | 50MB | pinata |
| all | No | 1 week | 100MB | pinata |

## Usage Examples

### Basic Upload

```typescript
import { getIPFSClient } from '@/lib/ipfs/client';

const client = getIPFSClient();

// Upload a file
const result = await client.upload(
  fileData,
  'my-document.pdf',
  { pin: true }
);

console.log(result.cid);        // QmXyz...
console.log(result.gatewayUrl); // https://ipfs.io/ipfs/QmXyz...
```

### Download Content

```typescript
const data = await client.download('QmXyz...');
// Returns Buffer of the content
```

### Automatic Seeding for Packages

```typescript
import { getSeederService } from '@/lib/ipfs/client';

const seeder = getSeederService();

// Seed a package cache file (respects policy)
const result = await seeder.seed(
  packageTarball,
  'lodash-4.17.21.tgz',
  'package-cache'
);
```

### Custom Seeding Policy

```typescript
import { getSeederService, DEFAULT_SEEDING_POLICIES } from '@/lib/ipfs/client';

const seeder = getSeederService({
  policies: {
    'package-cache': {
      ...DEFAULT_SEEDING_POLICIES['package-cache'],
      autoSeed: true,
      pinDuration: 720, // 30 days
    }
  }
});
```

### Check Pin Status

```typescript
const status = await client.status('QmXyz...');
console.log(status.pinned);      // true
console.log(status.pinCount);    // 2
console.log(status.seedProviders); // ['pinata', 'filecoin']
```

## Integration with Package Cache

For edge optimization and package caching:

```typescript
import { getSeederService } from '@/lib/ipfs/client';

const seeder = getSeederService();

// When caching a package
async function cachePackage(pkg: Package) {
  const tarball = await fetchPackageTarball(pkg);
  
  // Seed to IPFS for distributed caching
  const result = await seeder.seed(
    tarball,
    `${pkg.name}-${pkg.version}.tgz`,
    'package-cache'
  );
  
  if (result) {
    // Store the IPFS CID alongside the package metadata
    await storePackageCID(pkg.id, result.cid);
  }
}
```

## Error Handling

```typescript
import { getIPFSClient } from '@/lib/ipfs/client';

const client = getIPFSClient();

try {
  const result = await client.upload(data, 'file.bin', { pin: true });
} catch (error) {
  if (error.message === 'IPFS is not enabled or configured') {
    // Handle unconfigured state gracefully
    console.log('IPFS not available, using local storage');
  } else {
    throw error;
  }
}
```

## Health Check

```typescript
const client = getIPFSClient();

if (client.isEnabled()) {
  console.log('IPFS module is ready');
} else {
  console.log('IPFS module is disabled or not configured');
}
```