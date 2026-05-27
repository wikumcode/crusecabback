const { spawn } = require('child_process');
const archiver = require('archiver');

function parseDatabaseUrl(databaseUrl) {
    const normalized = databaseUrl.replace(/^postgresql:/i, 'postgres:');
    const url = new URL(normalized);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] || '');
    if (!database) {
        throw new Error('DATABASE_URL is missing a database name');
    }
    return {
        host: url.hostname,
        port: url.port || '5432',
        user: decodeURIComponent(url.username || ''),
        password: decodeURIComponent(url.password || ''),
        database,
    };
}

function dumpDatabaseToSqlBuffer(databaseUrl) {
    return new Promise((resolve, reject) => {
        let cfg;
        try {
            cfg = parseDatabaseUrl(databaseUrl);
        } catch (err) {
            reject(err);
            return;
        }

        const chunks = [];
        let stderr = '';

        const pgDump = spawn(
            'pg_dump',
            [
                '-h',
                cfg.host,
                '-p',
                cfg.port,
                '-U',
                cfg.user,
                '-d',
                cfg.database,
                '--no-owner',
                '--no-acl',
            ],
            {
                env: { ...process.env, PGPASSWORD: cfg.password },
            }
        );

        pgDump.stdout.on('data', (chunk) => chunks.push(chunk));
        pgDump.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        pgDump.on('error', () => {
            reject(
                new Error(
                    'pg_dump is not available on this server. Install the PostgreSQL client (postgresql-client).'
                )
            );
        });

        pgDump.on('close', (code) => {
            if (code === 0) {
                resolve({ sql: Buffer.concat(chunks), cfg });
                return;
            }
            const errText = stderr.trim() || `pg_dump failed with exit code ${code}`;
            if (/server version mismatch/i.test(errText)) {
                reject(
                    new Error(
                        `${errText} Install PostgreSQL client 16 on the server (e.g. apt install postgresql-client-16) so pg_dump matches your database version.`
                    )
                );
                return;
            }
            reject(new Error(errText));
        });
    });
}

function streamDatabaseBackupZip(res, databaseUrl) {
    return new Promise(async (resolve, reject) => {
        try {
            const { sql, cfg } = await dumpDatabaseToSqlBuffer(databaseUrl);
            const stamp = new Date().toISOString().slice(0, 10);
            const sqlFilename = `${cfg.database}-backup-${stamp}.sql`;
            const zipFilename = `rentix-backup-${cfg.database}-${stamp}.zip`;
            const readme = [
                'Rentix PostgreSQL backup',
                `Database: ${cfg.database}`,
                `Created (UTC): ${new Date().toISOString()}`,
                '',
                'Restore example:',
                `  createdb ${cfg.database}_restore`,
                `  psql -d ${cfg.database}_restore -f ${sqlFilename}`,
            ].join('\n');

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.on('error', reject);
            res.on('finish', resolve);
            res.on('close', resolve);

            archive.pipe(res);
            archive.append(sql, { name: sqlFilename });
            archive.append(readme, { name: 'README.txt' });
            await archive.finalize();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    parseDatabaseUrl,
    streamDatabaseBackupZip,
};
