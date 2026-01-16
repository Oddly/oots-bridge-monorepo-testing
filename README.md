# OOTS Bridge E2E Testing

End-to-end testing environment for the OOTS Bridge, featuring dual Domibus AS4 gateways, mock EMREX provider, and structured log validation via Elasticsearch.

## Prerequisites

### macOS (Homebrew)

```bash
brew install docker docker-compose node go-task
brew install --cask docker
```

Start Docker Desktop, then verify:
```bash
docker --version
node --version
task --version
```

### Linux (Debian/Ubuntu)

```bash
# Docker
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker $USER  # Log out and back in

# Node.js (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Task
sudo sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
```

### Linux (Fedora/RHEL)

```bash
# Docker
sudo dnf install -y docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER  # Log out and back in

# Node.js
sudo dnf install -y nodejs

# Task
sudo sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
```

### Linux (Arch)

```bash
# Docker
sudo pacman -S docker docker-compose nodejs npm
sudo systemctl enable --now docker
sudo usermod -aG docker $USER  # Log out and back in

# Task
sudo pacman -S go-task
# Or: yay -S go-task-bin
```

## Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd oots-bridge-monorepo-testing

# Install Node dependencies
npm install

# Start the full E2E stack (generates keystores, starts all services)
task e2e:start

# Run path coverage tests
task e2e:path-tests

# Run a single test path
task e2e:path-tests -- --path=1
```

## Available Tasks

```bash
task                     # Show all available tasks
task e2e:start           # Start complete E2E stack
task e2e:stop            # Stop all services
task e2e:clean           # Stop and remove all volumes (fresh start)
task e2e:status          # Show container status
task e2e:logs            # Follow all logs
task e2e:path-tests      # Run all path coverage tests
task e2e:validate        # Validate logs in Elasticsearch
```

## Services

When the stack is running, these services are available:

| Service | URL | Credentials |
|---------|-----|-------------|
| Blue Gateway (Provider) | http://localhost:8180/domibus | admin / 123456 |
| Red Gateway (Requester) | http://localhost:8280/domibus | admin / 123456 |
| Kibana | http://localhost:5601 | - |
| Elasticsearch | http://localhost:9200 | - |
| Bridge | http://localhost:3003 | - |
| Mock EMREX | http://localhost:9081 | - |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Runner (Host)                        │
│                    scripts/path-coverage-tests.ts                │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Network (oots-e2e)                    │
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │  Red Gateway │ ───▶ │ Blue Gateway │ ───▶ │    Bridge    │   │
│  │  (Requester) │      │  (Provider)  │      │              │   │
│  │  :8280       │      │  :8180       │      │  :3003       │   │
│  └──────────────┘      └──────────────┘      └──────┬───────┘   │
│         │                     │                     │           │
│         ▼                     ▼                     ▼           │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │  MySQL Red   │      │  MySQL Blue  │      │  Mock EMREX  │   │
│  └──────────────┘      └──────────────┘      │  :9081       │   │
│                                              └──────────────┘   │
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │   Filebeat   │ ───▶ │Elasticsearch │ ◀─── │   Kibana     │   │
│  │              │      │  :9200       │      │  :5601       │   │
│  └──────────────┘      └──────────────┘      └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Path Coverage Tests

The test suite validates structured logging across different execution paths:

| Path | Name | Description | Status |
|------|------|-------------|--------|
| 1 | Happy Path (Preview Required) | Initial request → PreviewRequired response | ✓ |
| 2 | Happy Path (Evidence Delivered) | Request with PreviewLocation → Evidence delivered | ✓ |
| 3 | No Preview Support | Direct error when preview not supported | ✓ |
| 4 | Request XML Validation Error | Malformed request XML | ✓ |
| 5 | Request Schematron Error | Request fails schematron validation | ✓ |
| 6 | EMREX User Cancellation | User cancels → NCP_CANCEL → Error response | ✓ |
| 7 | EMREX Provider Error | Provider error → NCP_ERROR → Error response | ✓ |
| 8 | EMREX No Results | No records found → NCP_NO_RESULTS | ✓ |
| 9 | EMREX Invalid GZIP | Bad compression → Decode error | ✓ |
| 10 | EMREX Invalid XML | Schema validation failure | ✓ |
| 11 | EMREX Identity Mismatch | Wrong person data → Identity error | ✓ |
| 12 | Session Timeout | User doesn't complete flow | ✓ |

Each test:
1. Configures mock EMREX behavior
2. Submits OOTS QueryRequest via Domibus
3. Waits for log ingestion
4. Validates expected logs in Elasticsearch

## Troubleshooting

### Services not starting
```bash
task e2e:status          # Check what's running
docker logs domibus-blue # Check specific container
task e2e:clean           # Fresh start
task e2e:start
```

### Domibus unhealthy after startup
This can happen if MySQL isn't fully initialized. The e2e:start task auto-restarts unhealthy Domibus containers (up to 2 times).

### Tests failing with "no logs found"
- Wait longer for Filebeat to ship logs (increase wait time)
- Check Filebeat logs: `docker logs filebeat-e2e`
- Verify Elasticsearch index: `curl localhost:9200/oots-logs-*/_count`
