#!/bin/bash
# Configure Domibus users and roles after startup
# This script resets the admin password and adds necessary roles
#
# Usage: ./scripts/configure-domibus.sh
#
# Requires: python3 with bcrypt module installed
#   pip install bcrypt

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

ADMIN_PASSWORD="${ADMIN_PASSWORD:-123456}"

echo "=========================================="
echo "Domibus Post-Startup Configuration"
echo "=========================================="
echo ""

# Generate bcrypt hash for the password
generate_bcrypt_hash() {
    local password="$1"
    python3 -c "
import bcrypt
password = b'${password}'
salt = bcrypt.gensalt(rounds=10)
hashed = bcrypt.hashpw(password, salt).decode()
# Convert \$2b to \$2a for Java compatibility
print(hashed.replace('\$2b', '\$2a'))
" 2>/dev/null
}

# Wait for MySQL to be ready
wait_for_mysql() {
    local container="$1"
    local max_attempts=30
    local attempt=1

    echo "Waiting for $container to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if docker exec "$container" mysqladmin ping -h localhost -u edelivery -pedelivery &>/dev/null; then
            echo "  $container is ready"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts..."
        sleep 2
        ((attempt++))
    done

    echo "ERROR: $container is not responding"
    return 1
}

# Configure a single Domibus instance
configure_domibus() {
    local mysql_container="$1"
    local gateway_name="$2"

    echo ""
    echo "Configuring $gateway_name Gateway..."

    # Wait for MySQL
    wait_for_mysql "$mysql_container"

    # Generate password hash
    echo "  Generating password hash..."
    local password_hash
    password_hash=$(generate_bcrypt_hash "$ADMIN_PASSWORD")

    if [ -z "$password_hash" ]; then
        echo "  ERROR: Failed to generate password hash"
        echo "  Make sure python3 and bcrypt are installed: pip install bcrypt"
        return 1
    fi

    # Reset admin password and disable default password flag (prevents forced password change on first login)
    echo "  Resetting admin password..."
    docker exec "$mysql_container" mysql -u edelivery -pedelivery domibus -e \
        "UPDATE TB_USER SET USER_PASSWORD='$password_hash', DEFAULT_PASSWORD=0 WHERE USER_NAME='admin';" 2>/dev/null

    # Add ROLE_AP_ADMIN to admin user (required for PMode upload)
    echo "  Adding ROLE_AP_ADMIN to admin user..."
    docker exec "$mysql_container" mysql -u edelivery -pedelivery domibus -e "
        INSERT IGNORE INTO TB_USER_ROLES (USER_ID, ROLE_ID)
        SELECT u.ID_PK, r.ID_PK
        FROM TB_USER u, TB_USER_ROLE r
        WHERE u.USER_NAME='admin' AND r.ROLE_NAME='ROLE_AP_ADMIN';" 2>/dev/null

    echo "  $gateway_name Gateway configured"
}

# Check if bcrypt is available
if ! python3 -c "import bcrypt" &>/dev/null; then
    echo "ERROR: Python bcrypt module not found"
    echo "Install it with: pip install bcrypt"
    exit 1
fi

# Configure both gateways
configure_domibus "mysql-blue" "Blue"
configure_domibus "mysql-red" "Red"

echo ""
echo "=========================================="
echo "Configuration Complete!"
echo "=========================================="
echo ""
echo "Admin credentials: admin / $ADMIN_PASSWORD"
echo ""
echo "IMPORTANT: PModes must be uploaded manually via the Admin Console:"
echo "  Blue Gateway: http://localhost:8180/domibus"
echo "  Red Gateway:  http://localhost:8280/domibus"
echo ""
echo "To upload PMode:"
echo "  1. Login with admin / $ADMIN_PASSWORD"
echo "  2. Navigate to PMode > Current"
echo "  3. Click 'Upload' and select the PMode file"
echo ""
echo "PMode files to upload:"
echo "  Blue: $PROJECT_DIR/domibus/conf/pmode/pmode-configuration.xml"
echo "  Red:  $PROJECT_DIR/domibus/conf-red/pmode/pmode-configuration.xml"
echo ""
