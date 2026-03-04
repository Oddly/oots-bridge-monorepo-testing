# Upgrade Guide

This document describes how to upgrade component versions in the OOTS Bridge E2E testing environment.

## Quick Reference

| Component | Version File | Current Version | Release Notes |
|-----------|--------------|-----------------|---------------|
| Domibus | `versions.env` | 5.1.9 | [Domibus Releases](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Domibus) |
| MySQL | `versions.env` | 8.0.40 | [MySQL Releases](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/) |
| ActiveMQ Artemis | `versions.env` | 2.31.2 | [Artemis Releases](https://activemq.apache.org/components/artemis/download/) |
| Elasticsearch | `versions.env` | 8.15.0 | [Elastic Releases](https://www.elastic.co/downloads/past-releases#elasticsearch) |
| Kibana | `versions.env` | 8.15.0 | [Kibana Releases](https://www.elastic.co/downloads/past-releases#kibana) |
| Filebeat | `versions.env` | 8.15.0 | [Filebeat Releases](https://www.elastic.co/downloads/past-releases#filebeat) |
| nginx | `versions.env` | 1.27.3-alpine | [nginx Releases](https://nginx.org/en/CHANGES) |
| Node.js | `versions.env` | 22.12.0-alpine | [Node.js Releases](https://nodejs.org/en/about/releases/) |

## Version Management

All component versions are centralized in `versions.env`. This file is automatically loaded by the Taskfile before running any docker-compose commands.

```bash
# View current versions
cat versions.env

# Versions are used in docker-compose.e2e.yml as environment variable substitutions:
# The Domibus image is built locally from domibus/Dockerfile
```

## Upgrading Components

### General Upgrade Process

1. **Check compatibility** between components before upgrading
2. **Update `versions.env`** with the new version
3. **Clean and restart** the E2E stack
4. **Run all tests** to verify functionality
5. **Commit changes** if tests pass

```bash
# Example: Upgrade Elasticsearch from 8.15.0 to 8.16.0

# 1. Edit versions.env
sed -i 's/ELASTICSEARCH_VERSION=8.15.0/ELASTICSEARCH_VERSION=8.16.0/' versions.env
sed -i 's/KIBANA_VERSION=8.15.0/KIBANA_VERSION=8.16.0/' versions.env
sed -i 's/FILEBEAT_VERSION=8.15.0/FILEBEAT_VERSION=8.16.0/' versions.env

# 2. Clean existing volumes (IMPORTANT: preserves nothing)
task e2e:clean

# 3. Restart with new versions
task e2e:start

# 4. Run tests
task e2e:test

# 5. If tests pass, commit
git add versions.env
git commit -m "chore: upgrade Elasticsearch stack to 8.16.0"
```

## Component-Specific Instructions

### Upgrading Domibus

Domibus upgrades may require database schema changes.

**Before upgrading:**
1. Check [Domibus Release Notes](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Domibus) for breaking changes
2. Verify the new version's DDL is compatible

**Upgrade steps:**

```bash
# 1. Update version in versions.env
DOMIBUS_VERSION=5.2.0  # New version

# 2. Update SQL distribution version if changed
DOMIBUS_SQL_DISTRIBUTION_VERSION=1.17  # Check Maven for correct version
DOMIBUS_PLUGIN_DISTRIBUTION_VERSION=5.2.0

# 3. Download new DDL and plugin
rm -f domibus/sql/mysql-*.ddl
rm -f domibus/conf/plugins/lib/domibus-*.jar
./scripts/setup-e2e.sh

# 4. Rebuild the Domibus Docker image with the new version
docker build --build-arg DOMIBUS_VERSION=5.2.0 -t domibus:5.2.0 domibus/

# 5. Update SQL file references in docker-compose.e2e.yml if DDL filename changed
# (Usually: mysql-X.Y.Z.ddl format)

# 6. Clean and restart
task e2e:clean
task e2e:start
task e2e:test
```

**Known Domibus upgrade issues:**
- Schema changes may require fresh database (use `task e2e:clean`)
- Check PMode compatibility if AS4 message format changes
- Verify WS Plugin API hasn't changed

### Upgrading MySQL

MySQL upgrades are generally safe for minor versions (8.0.x → 8.0.y).

**For major version upgrades (8.0 → 8.4):**
1. Test locally with a fresh database first
2. Check Domibus compatibility with new MySQL version
3. Review [MySQL upgrade checker](https://dev.mysql.com/doc/mysql-shell/8.0/en/mysql-shell-utilities-upgrade.html)

```bash
# Update version
sed -i 's/MYSQL_VERSION=8.0.40/MYSQL_VERSION=8.0.41/' versions.env

# Clean and restart (data will be lost)
task e2e:clean
task e2e:start
```

### Upgrading Elasticsearch Stack

Elasticsearch, Kibana, and Filebeat should be upgraded together to matching versions.

```bash
# Update all three to same version
NEW_VERSION=8.16.0
sed -i "s/ELASTICSEARCH_VERSION=.*/ELASTICSEARCH_VERSION=$NEW_VERSION/" versions.env
sed -i "s/KIBANA_VERSION=.*/KIBANA_VERSION=$NEW_VERSION/" versions.env
sed -i "s/FILEBEAT_VERSION=.*/FILEBEAT_VERSION=$NEW_VERSION/" versions.env

# Clean and restart
task e2e:clean
task e2e:start
```

**After upgrading:**
- Re-import Kibana dashboards if format changed: `task e2e:setup-kibana`
- Verify index templates still work: check `elasticsearch/oots-logs-template.json`

### Upgrading nginx

nginx upgrades are typically safe.

```bash
sed -i 's/NGINX_VERSION=.*/NGINX_VERSION=1.28-alpine/' versions.env
docker compose -f docker-compose.e2e.yml pull bridge-proxy
docker compose -f docker-compose.e2e.yml up -d bridge-proxy
```

### Upgrading Node.js (Mock Services)

Node.js version affects the mock EMREX provider.

```bash
# Update version
sed -i 's/NODE_VERSION=.*/NODE_VERSION=22.13.0-alpine3.21/' versions.env

# Rebuild mock image
docker compose -f docker-compose.e2e.yml build mock-emrex
docker compose -f docker-compose.e2e.yml up -d mock-emrex
```

## Compatibility Matrix

Known working version combinations:

| Domibus | MySQL | ActiveMQ | Elasticsearch | Node.js |
|---------|-------|----------|---------------|---------|
| 5.1.9 | 8.0.x | 2.31.x | 8.15.x | 22.x |
| 5.1.8 | 8.0.x | 2.31.x | 8.14.x | 22.x |

## Troubleshooting Upgrades

### Services won't start after upgrade

```bash
# Check container logs
docker compose -f docker-compose.e2e.yml logs domibus-blue

# Verify versions are being used
docker compose -f docker-compose.e2e.yml config | grep image:

# Full clean restart
task e2e:clean
task e2e:start
```

### Tests fail after upgrade

```bash
# Run individual test to isolate issue
task e2e:test:path -- 1

# Check Elasticsearch for log issues
curl http://localhost:9200/_cat/indices

# View Bridge logs
task e2e:logs:bridge:app
```

### Domibus fails to connect to MySQL

```bash
# Check MySQL health
docker logs mysql-blue

# Verify schema exists
docker exec mysql-blue mysql -uedelivery -pedelivery domibus -e "SHOW TABLES"

# May need fresh schema for major Domibus upgrades
task e2e:clean
task e2e:start
```

## Rolling Back

To roll back to a previous version:

```bash
# 1. Restore versions.env from git
git checkout HEAD~1 -- versions.env

# 2. Clean and restart
task e2e:clean
task e2e:start
```

## Automated Version Checks

The test suite validates that all expected log events are produced. If an upgrade breaks logging:

```bash
# Run full test suite
task e2e:test

# Check for missing log events in output
# Expected: "Total: 14 passed, 0 failed"
```

## Adding New Test Scenarios for New Features

When upgrading introduces new features to test:

1. Add new behavior mode to `mocks/mock-emrex-provider.ts`
2. Add test path to `scripts/path-coverage-tests.ts`
3. Update documentation in this file and README.md
4. Run full test suite to verify

See `mocks/mock-emrex-provider.test.ts` for behavior mode testing patterns.
