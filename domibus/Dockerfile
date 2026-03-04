# Domibus AS4 Gateway
#
# Builds from the official EC eDelivery WAR distribution.
# Replaces the private tanzari/domibus Docker Hub image.
#
# Build:
#   docker build -t domibus:5.1.9 domibus/
#   docker build --build-arg DOMIBUS_VERSION=5.2.0 -t domibus:5.2.0 domibus/
#
# Volume mounts (same paths as before):
#   /usr/local/tomcat/conf/domibus   - configuration directory
#   /usr/local/tomcat/domibus/data   - runtime data directory

FROM tomcat:9-jre17

ARG DOMIBUS_VERSION=5.1.9
ARG MYSQL_CONNECTOR_VERSION=8.0.33

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Remove default Tomcat webapps
RUN rm -rf /usr/local/tomcat/webapps/*

# Download and deploy the official Domibus WAR
RUN curl -fSL \
    "https://ec.europa.eu/digital-building-blocks/artifact/repository/eDelivery/eu/domibus/domibus-MSH-tomcat-distribution/${DOMIBUS_VERSION}/domibus-MSH-tomcat-distribution-${DOMIBUS_VERSION}.war" \
    -o /usr/local/tomcat/webapps/domibus.war

# Download MySQL JDBC driver into Tomcat's lib (not bundled in the WAR)
RUN curl -fSL \
    "https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/${MYSQL_CONNECTOR_VERSION}/mysql-connector-j-${MYSQL_CONNECTOR_VERSION}.jar" \
    -o /usr/local/tomcat/lib/mysql-connector-j.jar

# Create the runtime data directory
RUN mkdir -p /usr/local/tomcat/domibus/data

EXPOSE 8080
