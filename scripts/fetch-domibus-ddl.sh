#!/bin/bash
# Fetch Domibus DDL scripts from official eDelivery distribution
#
# Usage: ./scripts/fetch-domibus-ddl.sh [DOMIBUS_VERSION] [SQL_DISTRIBUTION_VERSION]
#
# Arguments:
#   DOMIBUS_VERSION          - Domibus version (e.g., 5.1.9). Default: 5.1.9
#   SQL_DISTRIBUTION_VERSION - SQL distribution version. Default: latest (auto-detected)
#
# The script downloads the official DDL from:
# https://ec.europa.eu/digital-building-blocks/artifact/repository/eDelivery/eu/domibus/domibus-msh-sql-distribution/

set -e

DOMIBUS_VERSION="${1:-5.1.9}"
SQL_DISTRIBUTION_VERSION="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/../domibus/sql"
TEMP_DIR="/tmp/domibus-sql-download"

# Base URL for eDelivery artifacts
BASE_URL="https://ec.europa.eu/digital-building-blocks/artifact/repository/eDelivery/eu/domibus/domibus-msh-sql-distribution"

echo "=== Domibus DDL Fetcher ==="
echo "Domibus version: $DOMIBUS_VERSION"

# Auto-detect latest SQL distribution version if not specified
if [ -z "$SQL_DISTRIBUTION_VERSION" ]; then
    echo "Detecting latest SQL distribution version..."
    # Try common recent versions (1.16, 1.15, etc)
    for version in 1.16 1.15 1.14 1.13 1.12; do
        URL="$BASE_URL/$version/domibus-msh-sql-distribution-$version.zip"
        if curl -s --head "$URL" | head -1 | grep -q "200"; then
            SQL_DISTRIBUTION_VERSION="$version"
            echo "Found version: $SQL_DISTRIBUTION_VERSION"
            break
        fi
    done
    if [ -z "$SQL_DISTRIBUTION_VERSION" ]; then
        echo "Error: Could not auto-detect SQL distribution version"
        exit 1
    fi
fi

echo "SQL distribution version: $SQL_DISTRIBUTION_VERSION"

# Download URL
DOWNLOAD_URL="$BASE_URL/$SQL_DISTRIBUTION_VERSION/domibus-msh-sql-distribution-$SQL_DISTRIBUTION_VERSION.zip"
ZIP_FILE="$TEMP_DIR/domibus-sql.zip"

# Clean up and create temp directory
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Download
echo "Downloading from: $DOWNLOAD_URL"
if ! curl -L -o "$ZIP_FILE" "$DOWNLOAD_URL"; then
    echo "Error: Failed to download DDL distribution"
    exit 1
fi

# Verify it's a valid zip
if ! file "$ZIP_FILE" | grep -q "Zip archive"; then
    echo "Error: Downloaded file is not a valid zip archive"
    cat "$ZIP_FILE"
    exit 1
fi

# Extract
echo "Extracting..."
unzip -q "$ZIP_FILE" -d "$TEMP_DIR"

# Find the MySQL DDL files for the specified version
MYSQL_DIR="$TEMP_DIR/sql-scripts/$DOMIBUS_VERSION/mysql"
if [ ! -d "$MYSQL_DIR" ]; then
    echo "Error: Domibus version $DOMIBUS_VERSION not found in distribution"
    echo "Available versions:"
    ls "$TEMP_DIR/sql-scripts/" | grep "^5\." | sort -V
    exit 1
fi

# Copy DDL files
echo "Copying DDL files to $SQL_DIR..."
mkdir -p "$SQL_DIR"

DDL_FILE="$MYSQL_DIR/mysql-$DOMIBUS_VERSION.ddl"
DATA_FILE="$MYSQL_DIR/mysql-$DOMIBUS_VERSION-data.ddl"

if [ -f "$DDL_FILE" ]; then
    cp "$DDL_FILE" "$SQL_DIR/"
    echo "  - $(basename $DDL_FILE)"
else
    echo "Warning: $DDL_FILE not found"
fi

if [ -f "$DATA_FILE" ]; then
    cp "$DATA_FILE" "$SQL_DIR/"
    echo "  - $(basename $DATA_FILE)"
else
    echo "Warning: $DATA_FILE not found"
fi

# Optionally copy multi-tenancy files
MT_DDL="$MYSQL_DIR/mysql-$DOMIBUS_VERSION-multi-tenancy.ddl"
MT_DATA="$MYSQL_DIR/mysql-$DOMIBUS_VERSION-multi-tenancy-data.ddl"

if [ -f "$MT_DDL" ]; then
    cp "$MT_DDL" "$SQL_DIR/"
    echo "  - $(basename $MT_DDL)"
fi

if [ -f "$MT_DATA" ]; then
    cp "$MT_DATA" "$SQL_DIR/"
    echo "  - $(basename $MT_DATA)"
fi

# Clean up (zip contents are read-only, so fix permissions first)
chmod -R u+w "$TEMP_DIR" 2>/dev/null || true
rm -rf "$TEMP_DIR" 2>/dev/null || true

echo ""
echo "=== DDL files installed successfully ==="
ls -la "$SQL_DIR/"*.ddl 2>/dev/null || echo "No DDL files found"
