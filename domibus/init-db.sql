-- Domibus database initialization
-- Fix MySQL 8 authentication for older JDBC drivers

-- Recreate user with mysql_native_password for compatibility
DROP USER IF EXISTS 'edelivery'@'%';
CREATE USER 'edelivery'@'%' IDENTIFIED WITH mysql_native_password BY 'edelivery';
GRANT ALL PRIVILEGES ON domibus.* TO 'edelivery'@'%';
FLUSH PRIVILEGES;
