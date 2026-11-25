param(
  [string]$HostName = "vps-unwh"
)

$ErrorActionPreference = "Stop"
$remoteRoot = "/home/administrator"

ssh $HostName "mkdir -p $remoteRoot/prisma/migrations/0001_init_unwhelm"
scp prisma/schema.prisma "$HostName`:$remoteRoot/prisma/schema.prisma"
scp prisma.config.ts "$HostName`:$remoteRoot/prisma.config.ts"
scp prisma/migrations/migration_lock.toml "$HostName`:$remoteRoot/prisma/migrations/migration_lock.toml"
scp prisma/migrations/0001_init_unwhelm/migration.sql "$HostName`:$remoteRoot/prisma/migrations/0001_init_unwhelm/migration.sql"

ssh $HostName "cd /tmp; set -a; . $remoteRoot/.env; npm exec --yes --package prisma@7.10.1 -- prisma migrate deploy --config $remoteRoot/prisma.config.ts"
