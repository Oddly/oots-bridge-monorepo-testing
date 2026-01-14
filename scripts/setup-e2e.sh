#!/bin/bash
# E2E Testing Environment Setup Script
#
# This script automates all the setup steps needed to run the OOTS E2E testing environment.
# It downloads the correct Domibus DDL, WS plugin, and configures all components.
#
# Usage: ./scripts/setup-e2e.sh [OPTIONS]
#
# Options:
#   --skip-ddl    Skip downloading DDL (if already present)
#   --skip-plugin Skip downloading WS plugin (if already present)
#   --clean       Force clean setup (removes existing files)
#
# Requirements:
#   - Docker and Docker Compose
#   - curl, unzip
#   - Bridge image built as oots-bridge:latest

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
DOMIBUS_DIR="$PROJECT_DIR/domibus"
SQL_DIR="$DOMIBUS_DIR/sql"
CONF_DIR="$DOMIBUS_DIR/conf"
CONF_RED_DIR="$DOMIBUS_DIR/conf-red"
PLUGINS_DIR="$DOMIBUS_DIR/plugins"

# Versions
DOMIBUS_VERSION="5.1.9"
SQL_DISTRIBUTION_VERSION="1.16"
PLUGIN_DISTRIBUTION_VERSION="5.1.9"

# URLs
DDL_BASE_URL="https://ec.europa.eu/digital-building-blocks/artifact/repository/eDelivery/eu/domibus/domibus-msh-sql-distribution"
PLUGIN_BASE_URL="https://ec.europa.eu/digital-building-blocks/artifact/repository/eDelivery/eu/domibus/domibus-msh-distribution"

# Parse arguments
SKIP_DDL=false
SKIP_PLUGIN=false
CLEAN=false

for arg in "$@"; do
    case $arg in
        --skip-ddl)
            SKIP_DDL=true
            ;;
        --skip-plugin)
            SKIP_PLUGIN=true
            ;;
        --clean)
            CLEAN=true
            ;;
    esac
done

echo "=========================================="
echo "OOTS E2E Environment Setup"
echo "=========================================="
echo "Domibus Version: $DOMIBUS_VERSION"
echo "Project Directory: $PROJECT_DIR"
echo ""

# Clean if requested
if [ "$CLEAN" = true ]; then
    echo "Cleaning existing files..."
    rm -f "$SQL_DIR/mysql-$DOMIBUS_VERSION"*.ddl
    rm -rf "$CONF_DIR/plugins" "$CONF_RED_DIR/plugins"
    rm -rf "$PLUGINS_DIR"/*
fi

# ============================================================================
# Step 1: Download and install DDL files
# ============================================================================
if [ "$SKIP_DDL" = false ] || [ ! -f "$SQL_DIR/mysql-$DOMIBUS_VERSION.ddl" ]; then
    echo "Step 1: Downloading Domibus DDL..."

    TEMP_DIR=$(mktemp -d)
    DDL_URL="$DDL_BASE_URL/$SQL_DISTRIBUTION_VERSION/domibus-msh-sql-distribution-$SQL_DISTRIBUTION_VERSION.zip"

    echo "  Downloading from: $DDL_URL"
    curl -L -o "$TEMP_DIR/ddl.zip" "$DDL_URL"

    # Verify download
    if ! file "$TEMP_DIR/ddl.zip" | grep -q "Zip archive"; then
        echo "  ERROR: Download failed - not a valid zip file"
        cat "$TEMP_DIR/ddl.zip"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    echo "  Extracting..."
    unzip -q "$TEMP_DIR/ddl.zip" -d "$TEMP_DIR"

    # Copy DDL files
    DDL_SOURCE="$TEMP_DIR/sql-scripts/$DOMIBUS_VERSION/mysql"
    if [ ! -d "$DDL_SOURCE" ]; then
        echo "  ERROR: DDL for version $DOMIBUS_VERSION not found"
        echo "  Available versions:"
        ls "$TEMP_DIR/sql-scripts/" 2>/dev/null || echo "  None found"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    mkdir -p "$SQL_DIR"
    cp "$DDL_SOURCE/mysql-$DOMIBUS_VERSION.ddl" "$SQL_DIR/"
    cp "$DDL_SOURCE/mysql-$DOMIBUS_VERSION-data.ddl" "$SQL_DIR/"

    # Clean up temp (fix read-only permissions first)
    chmod -R u+w "$TEMP_DIR" 2>/dev/null || true
    rm -rf "$TEMP_DIR"

    echo "  DDL files installed:"
    ls -la "$SQL_DIR/mysql-$DOMIBUS_VERSION"*.ddl
else
    echo "Step 1: DDL files already present (skipping)"
fi

# ============================================================================
# Step 2: Create additional data SQL (ROLE_AP_ADMIN for super user)
# ============================================================================
echo ""
echo "Step 2: Creating additional data SQL..."

cat > "$SQL_DIR/04-additional-data.sql" << 'EOF'
-- Additional data needed for Domibus super user
-- ROLE_AP_ADMIN is required for the super user to be created

INSERT IGNORE INTO TB_USER_ROLE (ID_PK, ROLE_NAME) VALUES ('197001010000000003', 'ROLE_AP_ADMIN');
EOF

echo "  Created: $SQL_DIR/04-additional-data.sql"

# ============================================================================
# Step 3: Download and install WS Plugin
# ============================================================================
if [ "$SKIP_PLUGIN" = false ] || [ ! -f "$PLUGINS_DIR/lib/domibus-default-ws-plugin-$PLUGIN_DISTRIBUTION_VERSION.jar" ]; then
    echo ""
    echo "Step 3: Downloading WS Plugin..."

    TEMP_DIR=$(mktemp -d)
    PLUGIN_URL="$PLUGIN_BASE_URL/$PLUGIN_DISTRIBUTION_VERSION/domibus-msh-distribution-$PLUGIN_DISTRIBUTION_VERSION-default-ws-plugin.zip"

    echo "  Downloading from: $PLUGIN_URL"
    curl -L -o "$TEMP_DIR/plugin.zip" "$PLUGIN_URL"

    # Verify download
    if ! file "$TEMP_DIR/plugin.zip" | grep -q "Zip archive"; then
        echo "  ERROR: Download failed - not a valid zip file"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    echo "  Extracting..."
    unzip -q "$TEMP_DIR/plugin.zip" -d "$TEMP_DIR"

    # Copy plugin files
    mkdir -p "$PLUGINS_DIR"
    cp -r "$TEMP_DIR/conf/domibus/plugins"/* "$PLUGINS_DIR/"

    # Also copy to conf directories (they're mounted to Domibus)
    mkdir -p "$CONF_DIR/plugins" "$CONF_RED_DIR/plugins"
    cp -r "$PLUGINS_DIR"/* "$CONF_DIR/plugins/"
    cp -r "$PLUGINS_DIR"/* "$CONF_RED_DIR/plugins/"

    rm -rf "$TEMP_DIR"

    echo "  WS Plugin installed:"
    ls -la "$PLUGINS_DIR/lib/"
else
    echo "Step 3: WS Plugin already present (skipping)"
fi

# ============================================================================
# Step 4: Verify domibus.properties configuration
# ============================================================================
echo ""
echo "Step 4: Verifying Domibus configuration..."

# Check for single-tenant mode (no domibus.database.general.schema)
for conf_file in "$CONF_DIR/domibus.properties" "$CONF_RED_DIR/domibus.properties"; do
    if grep -q "^domibus.database.general.schema=" "$conf_file" 2>/dev/null; then
        echo "  WARNING: $conf_file has multi-tenancy enabled"
        echo "  Comment out domibus.database.general.schema for single-tenant mode"
    else
        echo "  OK: $(basename $(dirname $conf_file))/domibus.properties - single-tenant mode"
    fi
done

# ============================================================================
# Step 5: Check Bridge image
# ============================================================================
echo ""
echo "Step 5: Checking Bridge image..."

if docker image inspect oots-bridge:latest >/dev/null 2>&1; then
    echo "  OK: oots-bridge:latest image found"
else
    echo "  WARNING: oots-bridge:latest image not found"
    echo "  Build it with: docker build -t oots-bridge:latest -f apps/bridge/backend/Dockerfile ."
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Start the environment: docker compose -f docker-compose.e2e.yml up -d"
echo "  2. Wait for all services to be healthy"
echo "  3. Access Kibana at: http://localhost:5601"
echo "  4. Access Domibus Blue at: http://localhost:8180/domibus (admin/123456)"
echo "  5. Access Domibus Red at: http://localhost:8280/domibus (admin/123456)"
echo "  6. Access Bridge at: http://localhost:3003"
echo ""
