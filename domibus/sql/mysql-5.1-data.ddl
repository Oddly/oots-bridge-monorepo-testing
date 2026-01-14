--  *********************************************************************
--  Update Database Script
--  *********************************************************************
--  Change Log: src/main/resources/db/releases/5.1/5.1-changelog-data.xml
--  Ran at: 11/16/23, 4:22 PM
--  Against: null@offline:mysql?changeLogFile=/Users/dragusa/work/cefgit/domibus-sql/domibus-msh-sql-scripts/target/liquibase/changelog-1.0-data.mysql
--  Liquibase version: 4.17.0
--  *********************************************************************

--  Changeset src/main/resources/db/releases/5.1/5.1-changelog-data.xml::EDELIVERY-2144_1::thomas dussart
INSERT INTO TB_USER_ROLE (ID_PK, ROLE_NAME) VALUES ('197001010000000001', 'ROLE_ADMIN');

INSERT INTO TB_USER_ROLE (ID_PK, ROLE_NAME) VALUES ('197001010000000002', 'ROLE_USER');

--  Changeset src/main/resources/db/releases/5.1/5.1-changelog-data.xml::EDELIVERY-7368::ionperpegel
INSERT INTO TB_D_MSH_ROLE (ID_PK, `ROLE`) VALUES ('197001010000000001', 'SENDING');

INSERT INTO TB_D_MSH_ROLE (ID_PK, `ROLE`) VALUES ('197001010000000002', 'RECEIVING');

--  Changeset src/main/resources/db/releases/5.1/5.1-changelog-data.xml::EDELIVERY-7836-insert::idragusa
INSERT INTO TB_USER_MESSAGE (ID_PK, MSH_ROLE_ID_FK) VALUES ('19700101', '197001010000000001');

--  Changeset src/main/resources/db/releases/5.1/5.1-changelog-data.xml::EDELIVERY-8503_2::ion perpegel
INSERT INTO TB_LOCK (ID_PK, LOCK_KEY) VALUES ('197001010000000001', 'bootstrap-synchronization.lock');

--  Changeset src/main/resources/db/releases/5.1/5.1-changelog-data.xml::EDELIVERY-9451::ion perpegel
INSERT INTO TB_LOCK (ID_PK, LOCK_KEY) VALUES ('197001010000000002', 'scheduler-synchronization.lock');

--  Changeset src/main/resources/db/releases/5.1/5.1-changelog-data.xml::insert_last_pk_in_TB_EARCHIVE_START::gautifr
INSERT INTO TB_EARCHIVE_START (ID_PK, LAST_PK_USER_MESSAGE, `DESCRIPTION`) VALUES ('1', '000101000000000000', 'START ID_PK FOR CONTINUOUS EXPORT');

INSERT INTO TB_EARCHIVE_START (ID_PK, LAST_PK_USER_MESSAGE, `DESCRIPTION`) VALUES ('2', '000101000000000000', 'START ID_PK FOR SANITY EXPORT');

--  Changeset src/main/resources/db/releases/5.1/../../common/changelog-version-inserts.xml::EDELIVERY-7668-mysql::Catalin Enache
INSERT INTO TB_VERSION (VERSION, BUILD_TIME, CREATION_TIME) VALUES ('5.1', '2023-11-16 14:22', (UTC_TIMESTAMP))
            ON DUPLICATE KEY UPDATE BUILD_TIME='2023-11-16 14:22', CREATION_TIME = (UTC_TIMESTAMP);
