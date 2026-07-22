# Stage 1: Build
FROM rust:1.75-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml Cargo.lock* ./

# Create dummy main.rs for dependency caching
RUN mkdir -p src && echo "fn main() {}" > src/main.rs

# Build dependencies (cached layer)
RUN cargo build --release && rm -rf src

# Copy actual source
COPY src/ src/

# Build release binary
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/terminal-proxy /app/terminal-proxy

# Create non-root user
RUN useradd -m -u 1000 proxy && chown -R proxy:proxy /app
USER proxy

# Environment defaults
ENV RUST_LOG=info
ENV TERMINAL_PROXY_WORKERS=4
ENV TERMINAL_PROXY_MAX_CONNECTIONS=10000
ENV TERMINAL_PROXY_IDLE_TIMEOUT_MS=900000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://localhost:9090/metrics"] || exit 1

EXPOSE 8080 9090

ENTRYPOINT ["/app/terminal-proxy"]