# Real Domibus Setup for E2E Testing

## Overview

This directory contains configuration for running real Domibus AS4 gateways for production-like E2E testing.

## Quick Start

```bash
# 1. Generate keystores
task setup:keystores

# 2. Start MySQL databases (wait ~2 min for first start)
docker compose -f docker-compose.e2e.yml up -d mysql-blue mysql-red
sleep 120

# 3. Start Domibus gateways (first start takes ~3-5 min for schema init)
docker compose -f docker-compose.e2e.yml up -d domibus-blue domibus-red

# 4. Monitor Domibus startup
docker logs -f domibus-blue

# 5. Once healthy, start remaining services
docker compose -f docker-compose.e2e.yml up -d

# 6. Send a test request
task e2e:trigger
```

**Note**: The tanzari/domibus image uses Liquibase to auto-create the database schema on first startup. This requires an empty database and takes 3-5 minutes.

This starts:
- **Blue Domibus Gateway** (Evidence Provider side) - http://localhost:8180/domibus
- **Red Domibus Gateway** (Evidence Requester side) - http://localhost:8280/domibus
- **Mock EMREX Provider** - Simulates EMREX data provider
- **OOTS Bridge** - The bridge application under test
- **Elasticsearch** - Log storage
- **Kibana** - Log visualization at http://localhost:5601
- **Filebeat** - Log shipping

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Red Gateway   │────▶│   Blue Gateway  │────▶│     Bridge      │
│  (Requester)    │◀────│   (Provider)    │◀────│    Backend      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
       │                        │                       │
  ┌────┴────┐              ┌────┴────┐             ┌────┴────┐
  │MySQL Red│              │MySQL Blue│            │Mock EMREX│
  └─────────┘              └─────────┘             └─────────┘

                    Logs ──────▶ Elasticsearch ──────▶ Kibana
```

## Available Tasks

```bash
# Full E2E Stack
task e2e:start           # Start everything
task e2e:stop            # Stop everything
task e2e:clean           # Remove all volumes (fresh start)
task e2e:status          # Show service status
task e2e:trigger         # Send test request

# Logs
task e2e:logs            # All logs
task e2e:logs:blue       # Blue Gateway logs
task e2e:logs:red        # Red Gateway logs
task e2e:logs:bridge     # Bridge logs

# Setup
task setup:keystores     # Generate keystores
task setup:bridge-image  # Build bridge image

# Cleanup
task clean               # Clean everything
```

## Requirements

Setting up real Domibus requires several components:

### 1. PKI / Certificates
- Gateway keystore (JKS) with private key for signing
- Truststore with partner certificates
- Generated automatically by `task setup:keystores`

### 2. PMode Configuration
- Defines message exchange agreements between parties
- Pre-configured for blue/red gateway communication
- Automatically uploaded on stack start

### 3. Database Schema
- MySQL 8 with Domibus DDL schema
- Initialized automatically from `sql/mysql-5.1.ddl`

## Manual Setup (Development/Testing)

If you prefer step-by-step setup:

```bash
# 1. Generate test keystores
./scripts/generate-keystores.sh

# 2. Build bridge image (if not done)
task setup:bridge-image

# 3. Start the stack
docker compose -f docker-compose.e2e.yml up -d

# 4. Wait for services (2-3 minutes for first start)
docker compose -f docker-compose.e2e.yml logs -f

# 5. Setup Elasticsearch pipeline
./scripts/setup-elasticsearch.sh

# 6. Upload PModes
./scripts/upload-pmodes.sh

# 7. Access Admin Consoles
#    Blue: http://localhost:8180/domibus (admin/123456)
#    Red:  http://localhost:8280/domibus (admin/123456)
```

## Manual PMode Upload

If automatic upload fails, upload manually:

1. Open http://localhost:8180/domibus (Blue) or http://localhost:8280/domibus (Red)
2. Login as admin/123456
3. Go to PMode > Current
4. Upload the respective configuration:
   - Blue: `conf/pmode/pmode-configuration.xml`
   - Red: `conf-red/pmode/pmode-configuration.xml`

## Directory Structure

```
domibus/
├── conf/                       # Blue Gateway configuration
│   ├── domibus.properties      # Main config
│   ├── keystores/              # Blue keystores
│   │   ├── gateway_keystore.jks
│   │   └── gateway_truststore.jks
│   └── pmode/
│       └── pmode-configuration.xml
│
├── conf-red/                   # Red Gateway configuration
│   ├── domibus.properties
│   ├── keystores/
│   └── pmode/
│
├── sql/                        # Database initialization
│   ├── init-db-blue.sql
│   ├── init-db-red.sql
│   ├── mysql-5.1.ddl          # Schema DDL
│   └── mysql-5.1-data.ddl     # Initial data
│
└── scripts/
    └── generate-keystores.sh
```

## Troubleshooting

### Domibus won't start
- Check MySQL is healthy: `docker logs mysql-blue` or `docker logs mysql-red`
- Domibus needs MySQL ready before starting
- First startup takes 2-3 minutes for schema initialization

### MySQL 8 Authentication Error (caching_sha2_password)
If you see errors about `CachingSha2PasswordPlugin`, the MySQL user needs to use
`mysql_native_password` authentication. The `init-db-*.sql` scripts handle this.

### Database dialect not configured
Ensure `domibus.properties` has:
```properties
domibus.entityManagerFactory.jpaProperty.hibernate.dialect=org.hibernate.dialect.MySQL8Dialect
```

### Table 'domibus.TB_USER' doesn't exist
The database schema wasn't initialized. Check:
1. MySQL initialization logs: `docker logs mysql-blue`
2. Ensure DDL files are mounted correctly in docker-compose

### Messages not being processed
- Verify PMode is uploaded in Admin Console
- Check Domibus logs: `task e2e:logs:blue` or `task e2e:logs:red`
- Verify keystores are properly configured

### Bridge can't connect
- Ensure WS Plugin is enabled in domibus.properties
- Check DOMIBUS_ACCESS_POINT URL is correct
- Verify admin credentials

## Images

We use `tanzari/domibus:latest` instead of the official `edelivery/domibus-tomcat-mysql`
which requires authentication. The tanzari image has slightly different configuration
requirements - see `conf/domibus.properties` for the required settings.

## Admin Console Credentials

- Username: `admin`
- Password: `123456`

## Ports

| Service        | Port |
|----------------|------|
| Blue Domibus   | 8180 |
| Red Domibus    | 8280 |
| Bridge         | 3003 |
| Elasticsearch  | 9200 |
| Kibana         | 5601 |
| Mock EMREX     | 9081 |
