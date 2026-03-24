const bcrypt = require('bcryptjs');

async function test() {
    const pw = 'Prasanna1234';
    const hash = await bcrypt.hash(pw, 10);
    console.log('New Hash:', hash);
    const match = await bcrypt.compare(pw, hash);
    console.log('Match with new hash:', match);

    const dbHash = '$2b$10$EZO.B2KZiWk6Y/mtq7sIrO5TKrqKPoSzTiKSxwdjHdImp7S4fyXUm';
    const matchDb = await bcrypt.compare(pw, dbHash);
    console.log('Match with DB hash:', matchDb);
}

test();
