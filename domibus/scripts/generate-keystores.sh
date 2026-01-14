#!/bin/bash
# Generate test keystores for Domibus E2E testing (Blue and Red gateways)
# These are SELF-SIGNED and for TESTING ONLY

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLUE_KEYSTORE_DIR="$SCRIPT_DIR/../conf/keystores"
RED_KEYSTORE_DIR="$SCRIPT_DIR/../conf-red/keystores"
PASSWORD="test123"

mkdir -p "$BLUE_KEYSTORE_DIR"
mkdir -p "$RED_KEYSTORE_DIR"

echo "=========================================="
echo "Generating keystores for Blue Gateway"
echo "=========================================="
cd "$BLUE_KEYSTORE_DIR"

# Generate Blue Gateway keypair
echo "1. Generating blue_gw keypair..."
rm -f gateway_keystore.jks blue_gw.cer gateway_truststore.jks 2>/dev/null || true
keytool -genkeypair \
    -alias blue_gw \
    -keyalg RSA \
    -keysize 2048 \
    -validity 365 \
    -keystore gateway_keystore.jks \
    -storepass "$PASSWORD" \
    -keypass "$PASSWORD" \
    -dname "CN=Blue Gateway, OU=OOTS Testing, O=Test, L=Brussels, ST=Brussels, C=BE" \
    -ext "SAN=DNS:localhost,DNS:domibus-blue,IP:127.0.0.1"

# Export blue gateway certificate
echo "2. Exporting blue_gw certificate..."
keytool -exportcert \
    -alias blue_gw \
    -keystore gateway_keystore.jks \
    -storepass "$PASSWORD" \
    -file blue_gw.cer \
    -rfc

echo ""
echo "=========================================="
echo "Generating keystores for Red Gateway"
echo "=========================================="
cd "$RED_KEYSTORE_DIR"

# Generate Red Gateway keypair
echo "3. Generating red_gw keypair..."
rm -f gateway_keystore.jks red_gw.cer gateway_truststore.jks 2>/dev/null || true
keytool -genkeypair \
    -alias red_gw \
    -keyalg RSA \
    -keysize 2048 \
    -validity 365 \
    -keystore gateway_keystore.jks \
    -storepass "$PASSWORD" \
    -keypass "$PASSWORD" \
    -dname "CN=Red Gateway, OU=OOTS Testing, O=Test, L=Amsterdam, ST=NH, C=NL" \
    -ext "SAN=DNS:localhost,DNS:domibus-red,IP:127.0.0.1"

# Export red gateway certificate
echo "4. Exporting red_gw certificate..."
keytool -exportcert \
    -alias red_gw \
    -keystore gateway_keystore.jks \
    -storepass "$PASSWORD" \
    -file red_gw.cer \
    -rfc

echo ""
echo "=========================================="
echo "Creating truststores with cross-trust"
echo "=========================================="

# Create Blue truststore (trusts both blue and red)
echo "5. Creating Blue Gateway truststore..."
cd "$BLUE_KEYSTORE_DIR"
keytool -importcert \
    -alias blue_gw \
    -file blue_gw.cer \
    -keystore gateway_truststore.jks \
    -storepass "$PASSWORD" \
    -noprompt

keytool -importcert \
    -alias red_gw \
    -file "$RED_KEYSTORE_DIR/red_gw.cer" \
    -keystore gateway_truststore.jks \
    -storepass "$PASSWORD" \
    -noprompt

# Create Red truststore (trusts both blue and red)
echo "6. Creating Red Gateway truststore..."
cd "$RED_KEYSTORE_DIR"
keytool -importcert \
    -alias red_gw \
    -file red_gw.cer \
    -keystore gateway_truststore.jks \
    -storepass "$PASSWORD" \
    -noprompt

keytool -importcert \
    -alias blue_gw \
    -file "$BLUE_KEYSTORE_DIR/blue_gw.cer" \
    -keystore gateway_truststore.jks \
    -storepass "$PASSWORD" \
    -noprompt

echo ""
echo "=========================================="
echo "Keystores generated successfully!"
echo "=========================================="
echo ""
echo "Blue Gateway keystores: $BLUE_KEYSTORE_DIR"
ls -la "$BLUE_KEYSTORE_DIR"
echo ""
echo "Red Gateway keystores: $RED_KEYSTORE_DIR"
ls -la "$RED_KEYSTORE_DIR"
echo ""
echo "Password for all keystores: $PASSWORD"
echo ""
echo "Blue Gateway alias: blue_gw"
echo "Red Gateway alias: red_gw"
